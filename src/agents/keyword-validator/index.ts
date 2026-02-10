/**
 * Keyword Validation Agent - Verify search demand for derivative products
 * Uses Google Autocomplete API (free) to estimate relative search demand
 * Filters out derivatives with no search demand or excessive competition
 */

import { supabaseAdmin } from '../../db/supabase';
import { isDailyBudgetExceeded } from '../../ai/cost-tracker';
import { sleep } from '../../utils/helpers';
import { config } from '../../config';

interface AutocompleteResult {
  keyword: string;
  suggestions: string[];
  count: number;
}

/**
 * Get Google Autocomplete suggestions for a keyword (free, no API key needed)
 */
async function getAutocompleteSuggestions(keyword: string): Promise<AutocompleteResult> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(keyword)}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[KeywordValidator] Autocomplete failed for "${keyword}": ${response.status}`);
      return { keyword, suggestions: [], count: 0 };
    }

    const data = await response.json() as any;
    const suggestions = (data[1] || []) as string[];

    return {
      keyword,
      suggestions,
      count: suggestions.length,
    };
  } catch (error) {
    console.error(`[KeywordValidator] Autocomplete error for "${keyword}":`, error);
    return { keyword, suggestions: [], count: 0 };
  }
}

/**
 * Estimate search volume based on autocomplete presence and suggestion count
 * - Keyword appears in autocomplete = meaningful search volume
 * - More suggestions = higher demand
 * - Keyword matches exactly = strong signal
 */
function estimateSearchVolume(results: AutocompleteResult[]): {
  volume: 'high' | 'medium' | 'low' | 'none';
  totalSuggestions: number;
  exactMatches: number;
} {
  let totalSuggestions = 0;
  let exactMatches = 0;

  for (const r of results) {
    totalSuggestions += r.count;
    // Check if any suggestion closely matches the keyword
    const keywordLower = r.keyword.toLowerCase();
    for (const s of r.suggestions) {
      if (s.toLowerCase().includes(keywordLower) || keywordLower.includes(s.toLowerCase())) {
        exactMatches++;
      }
    }
  }

  // Heuristic:
  // - Total suggestions across all keywords >= 15 → high
  // - Total suggestions >= 8 → medium
  // - Total suggestions >= 3 → low
  // - Less → none (no real demand)
  let volume: 'high' | 'medium' | 'low' | 'none';
  if (totalSuggestions >= 15) volume = 'high';
  else if (totalSuggestions >= 8) volume = 'medium';
  else if (totalSuggestions >= 3) volume = 'low';
  else volume = 'none';

  return { volume, totalSuggestions, exactMatches };
}

/**
 * Estimate keyword difficulty based on autocomplete competition
 */
function estimateDifficulty(results: AutocompleteResult[], competitionLevel: string): 'easy' | 'moderate' | 'hard' | 'unknown' {
  // Combine autocomplete data with existing competition level from competitive check
  if (competitionLevel === 'high') return 'hard';
  if (competitionLevel === 'low') return 'easy';

  // If moderate competition, check autocomplete diversity
  const totalSuggestions = results.reduce((sum, r) => sum + r.count, 0);
  if (totalSuggestions >= 20) return 'moderate'; // Many variations = competitive niche
  if (totalSuggestions >= 5) return 'easy';      // Some demand, not saturated

  return 'unknown';
}

/**
 * Main keyword validation run
 */
export async function runKeywordValidation(): Promise<{
  validated: number;
  approved: number;
  rejected: number;
}> {
  console.log('[KeywordValidator] === Starting Keyword Validation ===');

  const { exceeded, spent, limit } = await isDailyBudgetExceeded();
  if (exceeded) {
    console.warn(`[KeywordValidator] Budget exceeded ($${spent.toFixed(2)}/$${limit}). Skipping.`);
    return { validated: 0, approved: 0, rejected: 0 };
  }

  // Get derived products that passed competitive check (not rejected, still in 'derived' status)
  // and haven't been keyword-validated yet
  const { data: derivatives } = await supabaseAdmin
    .from('derived_products')
    .select('*')
    .eq('status', 'derived')
    .neq('competition_level', 'unknown')  // Must have been through competitive check
    .order('score', { ascending: false })
    .limit(config.keywordValidator.maxPerRun);

  if (!derivatives || derivatives.length === 0) {
    console.log('[KeywordValidator] No derivatives to validate');
    return { validated: 0, approved: 0, rejected: 0 };
  }

  // Filter out ones that already have keyword validations
  const toValidate = [];
  for (const d of derivatives) {
    const { count } = await supabaseAdmin
      .from('keyword_validations')
      .select('id', { count: 'exact', head: true })
      .eq('derived_product_id', d.id);

    if (!count || count === 0) {
      toValidate.push(d);
    }
  }

  if (toValidate.length === 0) {
    console.log('[KeywordValidator] All derivatives already validated');
    return { validated: 0, approved: 0, rejected: 0 };
  }

  console.log(`[KeywordValidator] Validating ${toValidate.length} derivatives...`);

  let validated = 0;
  let approved = 0;
  let rejected = 0;

  for (const derivative of toValidate) {
    const keywords = derivative.target_keywords || [];
    if (keywords.length === 0) {
      console.log(`[KeywordValidator] Skipping "${derivative.title}" — no target keywords`);
      continue;
    }

    console.log(`[KeywordValidator] Validating: "${derivative.title}"`);

    // Check autocomplete for each target keyword
    const autocompleteResults: AutocompleteResult[] = [];
    for (const kw of keywords.slice(0, 4)) { // Max 4 keywords per derivative
      const result = await getAutocompleteSuggestions(kw);
      autocompleteResults.push(result);
      await sleep(300); // Rate limit autocomplete requests
    }

    const { volume, totalSuggestions, exactMatches } = estimateSearchVolume(autocompleteResults);
    const difficulty = estimateDifficulty(autocompleteResults, derivative.competition_level || 'unknown');

    validated++;

    // Save validation results for each keyword
    for (const result of autocompleteResults) {
      await supabaseAdmin.from('keyword_validations').insert({
        derived_product_id: derivative.id,
        keyword: result.keyword,
        autocomplete_count: result.count,
        autocomplete_suggestions: result.suggestions.slice(0, 10),
        search_volume_estimate: volume,
        keyword_difficulty: difficulty,
        data_source: 'google_autocomplete',
      });
    }

    // Decide: approve or reject
    const shouldReject = volume === 'none' || (volume === 'low' && difficulty === 'hard');

    if (shouldReject) {
      await supabaseAdmin.from('derived_products').update({
        status: 'rejected',
        rejection_reason: `Low search demand: ${volume} volume, ${totalSuggestions} total suggestions`,
        seo_data: {
          search_volume: volume,
          total_suggestions: totalSuggestions,
          exact_matches: exactMatches,
          keyword_difficulty: difficulty,
        },
        updated_at: new Date().toISOString(),
      }).eq('id', derivative.id);

      rejected++;
      console.log(`[KeywordValidator]   REJECTED: ${volume} volume (${totalSuggestions} suggestions)`);
    } else {
      // Move to 'validated' status — ready for product planning
      await supabaseAdmin.from('derived_products').update({
        status: 'validated',
        estimated_search_volume: volume,
        seo_data: {
          search_volume: volume,
          total_suggestions: totalSuggestions,
          exact_matches: exactMatches,
          keyword_difficulty: difficulty,
          all_suggestions: autocompleteResults.flatMap(r => r.suggestions).slice(0, 20),
        },
        updated_at: new Date().toISOString(),
      }).eq('id', derivative.id);

      approved++;
      console.log(`[KeywordValidator]   APPROVED: ${volume} volume, ${difficulty} difficulty (${totalSuggestions} suggestions)`);
    }

    await sleep(500);
  }

  console.log(`[KeywordValidator] === Keyword Validation Complete ===`);
  console.log(`[KeywordValidator] Validated: ${validated}, Approved: ${approved}, Rejected: ${rejected}`);

  return { validated, approved, rejected };
}

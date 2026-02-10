/**
 * Deriver Agent - Demand derivation from hot topics
 * Takes high-scoring opportunities and generates specific derivative product ideas
 * e.g., "Seedance launched" → tutorial site, comparison page, prompt guide
 */

import { supabaseAdmin } from '../../db/supabase';
import { aiGenerateJson } from '../../ai/client';
import { isDailyBudgetExceeded } from '../../ai/cost-tracker';
import { slugify, sleep } from '../../utils/helpers';
import { config } from '../../config';

interface DerivativeProduct {
  derivative_type: 'tutorial' | 'comparison' | 'directory' | 'tool' | 'prompt_guide' |
                   'template_gallery' | 'cheatsheet' | 'aggregator' | 'calculator' | 'landing_page';
  title: string;
  description: string;
  target_keywords: string[];
  product_form: 'website' | 'mini_program' | 'both';
  estimated_search_volume: 'high' | 'medium' | 'low';
  competition_level: 'low' | 'medium' | 'high';
  monetization_strategy: string[];
  build_effort: '2h' | '4h' | '1d' | '2d' | '3d';
  reasoning: string;
  score: number;
}

interface DerivationResponse {
  derivatives: DerivativeProduct[];
}

const VALID_BUILD_EFFORTS = ['2h', '4h', '1d', '2d', '3d'] as const;
const VALID_COMPETITION_LEVELS = ['low', 'medium', 'high', 'unknown'] as const;
const VALID_SEARCH_VOLUMES = ['high', 'medium', 'low', 'unknown'] as const;
const VALID_PRODUCT_FORMS = ['website', 'mini_program', 'both'] as const;

function normalizeBuildEffort(val: string): string {
  if (VALID_BUILD_EFFORTS.includes(val as any)) return val;
  // Map common AI variations
  const v = val.toLowerCase().trim();
  if (v.includes('hour') || v.includes('2h') || v === '< 2h' || v === '<2h') return '2h';
  if (v.includes('4h') || v === 'half day' || v === 'half-day') return '4h';
  if (v === '1 day' || v === '1day' || v === '1d' || v === '< 1d' || v === '<1d') return '1d';
  if (v === '2 days' || v === '2days' || v === '2d') return '2d';
  if (v === '3 days' || v === '3days' || v === '3d' || v.includes('week') || v.includes('5d') || v.includes('4d')) return '3d';
  return '1d'; // safe default
}

function normalizeCompetitionLevel(val: string): string {
  if (VALID_COMPETITION_LEVELS.includes(val as any)) return val;
  const v = val.toLowerCase().trim();
  if (v.includes('low') || v === 'easy') return 'low';
  if (v.includes('med') || v === 'moderate') return 'medium';
  if (v.includes('high') || v === 'hard' || v === 'difficult') return 'high';
  return 'unknown';
}

function normalizeSearchVolume(val: string): string {
  if (VALID_SEARCH_VOLUMES.includes(val as any)) return val;
  const v = val.toLowerCase().trim();
  if (v.includes('high')) return 'high';
  if (v.includes('med')) return 'medium';
  if (v.includes('low')) return 'low';
  return 'unknown';
}

function normalizeProductForm(val: string): string {
  if (VALID_PRODUCT_FORMS.includes(val as any)) return val;
  const v = val.toLowerCase().trim();
  if (v.includes('both')) return 'both';
  if (v.includes('mini') || v.includes('wechat')) return 'mini_program';
  return 'website';
}

const DERIVER_SYSTEM_PROMPT = `You are a product strategist for an indie developer who builds lightweight websites and WeChat mini-programs for ad and affiliate monetization.

Your job is to take a trending topic and identify SPECIFIC, ACTIONABLE derivative product ideas that:
1. Can be built in < 1 day using a template (Next.js static site, comparison table, tutorial page)
2. Target specific long-tail keywords that real users are searching for RIGHT NOW
3. Can be monetized via Google AdSense, affiliate links, or referral programs
4. Fill a GAP that existing search results don't cover well

Think like an SEO-savvy indie developer: what pages would you build to capture search traffic from this trend?`;

/**
 * Generate derivative product ideas from a single opportunity
 */
async function deriveFromOpportunity(opportunity: any): Promise<DerivativeProduct[]> {
  const painPoints = opportunity.seo_data?.user_pain_points ||
    opportunity.score_breakdown?.derivative_suggestions ||
    [];
  const derivativeSuggestions = opportunity.derivative_suggestions || [];

  const prompt = `Given this trending topic/opportunity, generate ${config.deriver.maxDerivativesPerTopic} DERIVATIVE PRODUCT ideas.

Opportunity:
- Title: ${opportunity.title}
- Description: ${opportunity.description}
- Category: ${opportunity.category}
- Target Keyword: ${opportunity.target_keyword}
- Secondary Keywords: ${(opportunity.secondary_keywords || []).join(', ')}
- Score: ${opportunity.score?.toFixed(1)}
- Window Remaining: ${opportunity.window_status}
- Competitors: ${JSON.stringify(opportunity.competitors || [])}
- Existing Derivative Suggestions: ${derivativeSuggestions.join(', ')}
- User Pain Points: ${Array.isArray(painPoints) ? painPoints.join(', ') : JSON.stringify(painPoints)}

Derivative types to consider:
- TUTORIAL: "How to use [X]" step-by-step guide — high dwell time, great for AdSense
- COMPARISON: "[X] vs [Y] vs [Z]" feature comparison table — high commercial intent, good for affiliate
- DIRECTORY: "Best [X] alternatives" or "Top [X] tools" — evergreen, good for affiliate links
- PROMPT_GUIDE: "Best prompts for [X]" (for AI tools) — high search volume for new AI tools
- TEMPLATE_GALLERY: "[X] templates/examples" showcase — good for affiliate/referral
- CHEATSHEET: "[X] cheatsheet" quick reference — high bookmark rate, return visits
- AGGREGATOR: "[X] news/updates" aggregation page — ongoing traffic, ad-friendly
- CALCULATOR: "[X] pricing calculator" or "[X] ROI calculator" — high utility, good CPC
- LANDING_PAGE: "[X] — what is it and how to start" — captures "what is" queries
- TOOL: Simple utility wrapping an API — high engagement, ad-friendly

For EACH derivative, you must specify:
- Specific target keywords (2-4 keywords people actually search for)
- Concrete monetization: which ad networks, which affiliate programs, what CPC/RPM range
- Why this is BETTER than what currently ranks on Google for these keywords
- How long it takes to build (be realistic)

Score each derivative 0-100 based on: search demand × ease of building × monetization potential × competition gap.

Respond with JSON:
{
  "derivatives": [
    {
      "derivative_type": "tutorial|comparison|directory|...",
      "title": "SEO-optimized page title",
      "description": "What this product does and why users need it",
      "target_keywords": ["keyword 1", "keyword 2", "keyword 3"],
      "product_form": "website|mini_program|both",
      "estimated_search_volume": "high|medium|low",
      "competition_level": "low|medium|high",
      "monetization_strategy": ["adsense", "affiliate:program_name", "referral:product_name"],
      "build_effort": "2h|4h|1d|2d|3d",
      "reasoning": "Why this derivative is worth building and how it's different from existing results",
      "score": 0-100
    }
  ]
}`;

  const result = await aiGenerateJson<DerivationResponse>(prompt, {
    system: DERIVER_SYSTEM_PROMPT,
    agentType: 'deriver',
    tier: 'quality',
    temperature: 0.6,
  });

  return result?.derivatives || [];
}

/**
 * Check if a derivative slug already exists or overlaps with existing ones
 */
async function isDuplicate(slug: string, keywords: string[]): Promise<boolean> {
  // Check exact slug match
  const { data: existing } = await supabaseAdmin
    .from('derived_products')
    .select('id, slug, target_keywords')
    .eq('slug', slug)
    .maybeSingle();

  if (existing) return true;

  // Check keyword overlap with recent derivatives (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentDerivatives } = await supabaseAdmin
    .from('derived_products')
    .select('id, slug, target_keywords')
    .gte('created_at', thirtyDaysAgo)
    .not('status', 'eq', 'rejected');

  if (recentDerivatives) {
    for (const d of recentDerivatives) {
      const existingKw = (d.target_keywords || []).map((k: string) => k.toLowerCase());
      const newKw = keywords.map(k => k.toLowerCase());
      const overlap = newKw.filter(k => existingKw.some((ek: string) =>
        ek.includes(k) || k.includes(ek)
      ));
      if (overlap.length >= Math.ceil(newKw.length * 0.5)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Main Deriver run
 */
export async function runDeriver(): Promise<{
  opportunities_processed: number;
  derivatives_created: number;
}> {
  console.log('[Deriver] === Starting Deriver Run ===');

  const { exceeded, spent, limit } = await isDailyBudgetExceeded();
  if (exceeded) {
    console.warn(`[Deriver] Budget exceeded ($${spent.toFixed(2)}/$${limit}). Skipping.`);
    return { opportunities_processed: 0, derivatives_created: 0 };
  }

  // Get opportunities that haven't been derived yet
  // Join check: opportunities with score >= minScore and no derived_products yet
  const { data: opportunities } = await supabaseAdmin
    .from('opportunities')
    .select('*')
    .eq('status', 'evaluated')
    .gte('score', config.deriver.minScore)
    .order('score', { ascending: false })
    .limit(config.deriver.maxPerRun);

  if (!opportunities || opportunities.length === 0) {
    console.log('[Deriver] No opportunities to derive from');
    return { opportunities_processed: 0, derivatives_created: 0 };
  }

  // Filter out opportunities that already have derivatives
  const oppsToProcess = [];
  for (const opp of opportunities) {
    const { count } = await supabaseAdmin
      .from('derived_products')
      .select('id', { count: 'exact', head: true })
      .eq('opportunity_id', opp.id);

    if (!count || count === 0) {
      oppsToProcess.push(opp);
    }
  }

  if (oppsToProcess.length === 0) {
    console.log('[Deriver] All eligible opportunities already have derivatives');
    return { opportunities_processed: 0, derivatives_created: 0 };
  }

  console.log(`[Deriver] Processing ${oppsToProcess.length} opportunities...`);

  let totalCreated = 0;

  for (const opp of oppsToProcess) {
    const { exceeded } = await isDailyBudgetExceeded();
    if (exceeded) {
      console.warn('[Deriver] Budget exceeded mid-run. Stopping.');
      break;
    }

    console.log(`[Deriver] Deriving from: "${opp.title}" (score: ${opp.score?.toFixed(1)})`);

    const derivatives = await deriveFromOpportunity(opp);

    if (!derivatives || derivatives.length === 0) {
      console.log(`[Deriver]   No derivatives generated`);
      continue;
    }

    let created = 0;
    for (const d of derivatives) {
      // Filter by minimum score
      if (d.score < config.deriver.minDerivativeScore) {
        console.log(`[Deriver]   Skipped (low score ${d.score}): ${d.title}`);
        continue;
      }

      const slug = slugify(d.title);

      // Check for duplicates
      if (await isDuplicate(slug, d.target_keywords || [])) {
        console.log(`[Deriver]   Skipped (duplicate): ${d.title}`);
        continue;
      }

      const normalizedBuildEffort = normalizeBuildEffort(d.build_effort || '1d');
      const normalizedCompetition = normalizeCompetitionLevel(d.competition_level || 'unknown');
      const normalizedVolume = normalizeSearchVolume(d.estimated_search_volume || 'unknown');
      const normalizedForm = normalizeProductForm(d.product_form || 'website');

      const { error } = await supabaseAdmin.from('derived_products').insert({
        opportunity_id: opp.id,
        signal_id: opp.signal_ids?.[0] || null,
        parent_topic: opp.title,
        derivative_type: d.derivative_type,
        title: d.title,
        slug,
        description: d.description,
        target_keywords: d.target_keywords || [],
        product_form: normalizedForm,
        estimated_search_volume: normalizedVolume,
        competition_level: normalizedCompetition,
        monetization_strategy: d.monetization_strategy || [],
        build_effort: normalizedBuildEffort,
        ai_reasoning: d.reasoning,
        score: d.score,
        score_breakdown: {
          search_demand: d.estimated_search_volume,
          competition: d.competition_level,
          build_effort: d.build_effort,
          monetization: d.monetization_strategy,
        },
        status: 'derived',
      });

      if (!error) {
        created++;
        const emoji = d.score >= 70 ? '🎯' : d.score >= 50 ? '📊' : '📝';
        console.log(`[Deriver]   ${emoji} ${d.derivative_type}: "${d.title}" (score: ${d.score})`);
        console.log(`[Deriver]     Keywords: ${d.target_keywords?.join(', ')}`);
        console.log(`[Deriver]     Monetization: ${d.monetization_strategy?.join(', ')}`);
      } else {
        console.error(`[Deriver]   Insert error for ${slug}:`, error.message);
      }
    }

    totalCreated += created;
    console.log(`[Deriver]   Created ${created} derivatives from "${opp.title}"`);

    await sleep(1000);
  }

  console.log(`[Deriver] === Deriver Run Complete ===`);
  console.log(`[Deriver] Processed: ${oppsToProcess.length}, Created: ${totalCreated}`);

  return {
    opportunities_processed: oppsToProcess.length,
    derivatives_created: totalCreated,
  };
}

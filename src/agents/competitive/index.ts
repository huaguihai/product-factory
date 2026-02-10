/**
 * Competitive Check Agent - SERP analysis for derivative products
 * Searches Google for target keywords and evaluates competition level
 * Uses Google Custom Search API or SerpAPI, falls back to AI estimation
 */

import { supabaseAdmin } from '../../db/supabase';
import { aiGenerateJson } from '../../ai/client';
import { isDailyBudgetExceeded } from '../../ai/cost-tracker';
import { sleep } from '../../utils/helpers';
import { config } from '../../config';

const BIG_DOMAINS = new Set([
  'wikipedia.org', 'youtube.com', 'reddit.com', 'github.com',
  'stackoverflow.com', 'medium.com', 'forbes.com', 'nytimes.com',
  'techcrunch.com', 'theverge.com', 'wired.com', 'cnet.com',
  'pcmag.com', 'tomsguide.com', 'zdnet.com', 'engadget.com',
  'arstechnica.com', 'mashable.com', 'lifehacker.com', 'howtogeek.com',
  'makeuseof.com', 'digitaltrends.com', 'tomshardware.com',
  'amazon.com', 'apple.com', 'microsoft.com', 'google.com',
  'docs.google.com', 'support.google.com', 'support.apple.com',
  'learn.microsoft.com', 'developer.mozilla.org',
  'linkedin.com', 'twitter.com', 'x.com', 'facebook.com',
  'quora.com', 'ign.com', 'bbc.com', 'cnn.com',
]);

interface SerpResult {
  title: string;
  url: string;
  domain: string;
  is_big_site: boolean;
}

interface CompetitiveAnalysis {
  difficulty: 'easy' | 'moderate' | 'hard' | 'very_hard';
  content_gap_found: boolean;
  analysis: string;
  recommendations: string[];
}

/**
 * Extract root domain from URL
 */
function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Get root domain (last 2 parts for .com, .org, etc.)
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    return hostname;
  } catch {
    return url;
  }
}

/**
 * Check if a domain is a "big site" that's hard to compete with
 */
function isBigSite(domain: string): boolean {
  return BIG_DOMAINS.has(domain);
}

/**
 * Fetch SERP results via Google Custom Search API
 */
async function fetchGoogleCSE(keyword: string): Promise<SerpResult[] | null> {
  const apiKey = config.competitive.googleCseKey;
  const cseId = config.competitive.googleCseId;

  if (!apiKey || !cseId) return null;

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(keyword)}&num=10`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[Competitive] Google CSE failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    const items = data.items || [];

    return items.map((item: any) => {
      const domain = extractDomain(item.link);
      return {
        title: item.title,
        url: item.link,
        domain,
        is_big_site: isBigSite(domain),
      };
    });
  } catch (error) {
    console.error('[Competitive] Google CSE error:', error);
    return null;
  }
}

/**
 * Fetch SERP results via SerpAPI
 */
async function fetchSerpAPI(keyword: string): Promise<SerpResult[] | null> {
  const apiKey = config.competitive.serpApiKey;
  if (!apiKey) return null;

  try {
    const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(keyword)}&engine=google&num=10`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[Competitive] SerpAPI failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    const results = data.organic_results || [];

    return results.map((r: any) => {
      const domain = extractDomain(r.link);
      return {
        title: r.title,
        url: r.link,
        domain,
        is_big_site: isBigSite(domain),
      };
    });
  } catch (error) {
    console.error('[Competitive] SerpAPI error:', error);
    return null;
  }
}

/**
 * AI-based competitive estimation (fallback when no search API is configured)
 */
async function aiEstimateCompetition(keyword: string, derivativeType: string): Promise<CompetitiveAnalysis | null> {
  const prompt = `You are an SEO expert. Estimate the competitive landscape for this search query.

Keyword: "${keyword}"
Product type: ${derivativeType}

Based on your knowledge of the web:
1. What kinds of sites currently rank for this keyword? (big authority sites, small blogs, tool sites, forums?)
2. Is there a content gap — something users want but existing results don't provide well?
3. Could a focused, well-built ${derivativeType} page rank on page 1 within 1-3 months?

Respond with JSON:
{
  "difficulty": "easy|moderate|hard|very_hard",
  "content_gap_found": true/false,
  "analysis": "Brief analysis of competitive landscape",
  "recommendations": ["actionable recommendation 1", "recommendation 2"]
}

Rules:
- "easy": Few quality results, mostly forums/old blogs. A new focused page can rank quickly.
- "moderate": Some quality content exists but there's room for a better, more focused page.
- "hard": Multiple strong competitors with well-optimized content.
- "very_hard": Dominated by authority sites (Wikipedia, official docs, major publications).`;

  return await aiGenerateJson<CompetitiveAnalysis>(prompt, {
    agentType: 'competitive',
    tier: 'fast',
    temperature: 0.3,
  });
}

/**
 * Analyze competition for a single derivative product
 */
async function checkCompetition(derivative: any): Promise<{
  serpResults: SerpResult[];
  bigCount: number;
  smallCount: number;
  analysis: CompetitiveAnalysis | null;
}> {
  const keyword = derivative.target_keywords?.[0] || derivative.title;

  // Try real SERP data first
  let serpResults = await fetchGoogleCSE(keyword);
  if (!serpResults) serpResults = await fetchSerpAPI(keyword);

  if (serpResults && serpResults.length > 0) {
    const bigCount = serpResults.filter(r => r.is_big_site).length;
    const smallCount = serpResults.filter(r => !r.is_big_site).length;

    // Use AI to analyze the SERP results
    const analysis = await aiEstimateCompetition(keyword, derivative.derivative_type);

    return { serpResults, bigCount, smallCount, analysis };
  }

  // Fallback: AI-only estimation
  const analysis = await aiEstimateCompetition(keyword, derivative.derivative_type);
  return {
    serpResults: [],
    bigCount: 0,
    smallCount: 0,
    analysis,
  };
}

/**
 * Main competitive check run
 */
export async function runCompetitiveCheck(): Promise<{
  checked: number;
  rejected: number;
}> {
  console.log('[Competitive] === Starting Competitive Check ===');

  const { exceeded, spent, limit } = await isDailyBudgetExceeded();
  if (exceeded) {
    console.warn(`[Competitive] Budget exceeded ($${spent.toFixed(2)}/$${limit}). Skipping.`);
    return { checked: 0, rejected: 0 };
  }

  // Get derived products that haven't been checked yet
  const { data: derivatives } = await supabaseAdmin
    .from('derived_products')
    .select('*')
    .eq('status', 'derived')
    .order('score', { ascending: false })
    .limit(config.competitive.maxChecksPerRun);

  if (!derivatives || derivatives.length === 0) {
    console.log('[Competitive] No derivatives to check');
    return { checked: 0, rejected: 0 };
  }

  // Filter out ones that already have competitive checks
  const toCheck = [];
  for (const d of derivatives) {
    const { count } = await supabaseAdmin
      .from('competitive_checks')
      .select('id', { count: 'exact', head: true })
      .eq('derived_product_id', d.id);

    if (!count || count === 0) {
      toCheck.push(d);
    }
  }

  if (toCheck.length === 0) {
    console.log('[Competitive] All derivatives already checked');
    return { checked: 0, rejected: 0 };
  }

  console.log(`[Competitive] Checking ${toCheck.length} derivatives...`);

  let checked = 0;
  let rejected = 0;

  for (const derivative of toCheck) {
    const { exceeded } = await isDailyBudgetExceeded();
    if (exceeded) {
      console.warn('[Competitive] Budget exceeded mid-run. Stopping.');
      break;
    }

    const keyword = derivative.target_keywords?.[0] || derivative.title;
    console.log(`[Competitive] Checking: "${keyword}" (${derivative.derivative_type})`);

    const result = await checkCompetition(derivative);
    checked++;

    const difficulty = result.analysis?.difficulty || 'unknown';
    const contentGap = result.analysis?.content_gap_found || false;

    // Save competitive check result
    await supabaseAdmin.from('competitive_checks').insert({
      derived_product_id: derivative.id,
      keyword,
      serp_results: result.serpResults,
      big_site_count: result.bigCount,
      small_site_count: result.smallCount,
      content_gap_found: contentGap,
      difficulty_assessment: difficulty !== 'unknown' ? difficulty : null,
      ai_analysis: result.analysis?.analysis || null,
    });

    // Determine if we should reject this derivative
    const shouldReject =
      difficulty === 'very_hard' ||
      (result.bigCount >= config.competitive.bigSiteDomainThreshold && !contentGap);

    if (shouldReject) {
      await supabaseAdmin.from('derived_products').update({
        status: 'rejected',
        rejection_reason: `Competition too high: ${difficulty}, ${result.bigCount} big sites in top 10`,
        competitive_data: {
          difficulty,
          big_site_count: result.bigCount,
          content_gap: contentGap,
        },
        updated_at: new Date().toISOString(),
      }).eq('id', derivative.id);

      rejected++;
      console.log(`[Competitive]   REJECTED: ${difficulty} competition, ${result.bigCount} big sites`);
    } else {
      // Update competitive data but keep status as 'derived' for keyword validation
      await supabaseAdmin.from('derived_products').update({
        competition_level: difficulty === 'easy' ? 'low' : difficulty === 'moderate' ? 'medium' : 'high',
        competitive_data: {
          difficulty,
          big_site_count: result.bigCount,
          small_site_count: result.smallCount,
          content_gap: contentGap,
          analysis: result.analysis?.analysis,
          recommendations: result.analysis?.recommendations,
        },
        updated_at: new Date().toISOString(),
      }).eq('id', derivative.id);

      console.log(`[Competitive]   PASSED: ${difficulty} (big: ${result.bigCount}, gap: ${contentGap})`);
    }

    await sleep(1500);
  }

  console.log(`[Competitive] === Competitive Check Complete ===`);
  console.log(`[Competitive] Checked: ${checked}, Rejected: ${rejected}`);

  return { checked, rejected };
}

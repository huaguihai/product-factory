/**
 * Scout Agent - Main loop
 * Orchestrates data source scraping with rotation and AI pre-filtering
 */

import { supabaseAdmin } from '../../db/supabase';
import { aiGenerateJson } from '../../ai/client';
import { isDailyBudgetExceeded } from '../../ai/cost-tracker';
import { scrapeGitHubTrending } from './sources/github-trending';
import { scrapeHackerNews } from './sources/hackernews';
import { scrapeProductHunt } from './sources/producthunt';
import { scrapeReddit } from './sources/reddit';

type SourceName = 'github_trending' | 'hackernews' | 'producthunt' | 'reddit';

const SOURCE_SCRAPERS: Record<SourceName, () => Promise<{ scraped: number; saved: number }>> = {
  github_trending: scrapeGitHubTrending,
  hackernews: scrapeHackerNews,
  producthunt: scrapeProductHunt,
  reddit: scrapeReddit,
};

// Rotate sources: each run picks 2 sources to avoid hitting all APIs at once
let sourceIndex = 0;
const SOURCE_ORDER: SourceName[] = ['github_trending', 'hackernews', 'producthunt', 'reddit'];

interface PreFilterResult {
  is_emerging: boolean;
  novelty_reason: string;
  category: string;
  potential_products: string[];
  urgency: 'high' | 'medium' | 'low';
}

/**
 * AI pre-filter: determine if a signal represents an emerging tech opportunity
 */
async function preFilterSignal(signal: { title: string; description: string; source: string; stars: number }): Promise<PreFilterResult | null> {
  const prompt = `Analyze this tech signal and determine if it represents an EMERGING technology opportunity.

"Emerging" means:
1. The project/product is NEW (< 30 days old ideally)
2. Growing fast (gaining traction)
3. NOT a mature/established tool (not image compression, not background removal, not generic tools)
4. Has clear user demand or solves a real problem

Signal:
- Title: ${signal.title}
- Description: ${signal.description}
- Source: ${signal.source}
- Traction: ${signal.stars} stars/votes

Respond in JSON:
{
  "is_emerging": boolean,
  "novelty_reason": "why this is or isn't emerging",
  "category": "ai_tool|dev_tool|saas|framework|protocol|other",
  "potential_products": ["tutorial site", "config generator", etc.],
  "urgency": "high|medium|low"
}

Be strict. Quality > quantity. If unsure, set is_emerging to false.`;

  return await aiGenerateJson<PreFilterResult>(prompt, {
    agentType: 'scout',
    tier: 'fast',
  });
}

/**
 * Run pre-filtering on all raw signals
 */
async function preFilterRawSignals(): Promise<{ filtered: number; kept: number }> {
  const { data: rawSignals } = await supabaseAdmin
    .from('signals')
    .select('*')
    .eq('status', 'raw')
    .order('created_at', { ascending: false })
    .limit(20);

  if (!rawSignals || rawSignals.length === 0) {
    console.log('[Scout] No raw signals to filter');
    return { filtered: 0, kept: 0 };
  }

  console.log(`[Scout] Pre-filtering ${rawSignals.length} raw signals...`);

  let kept = 0;
  for (const signal of rawSignals) {
    // Check budget before each AI call
    const { exceeded } = await isDailyBudgetExceeded();
    if (exceeded) {
      console.warn('[Scout] Daily budget exceeded, stopping pre-filter');
      break;
    }

    const result = await preFilterSignal({
      title: signal.title,
      description: signal.description || '',
      source: signal.source,
      stars: signal.stars || 0,
    });

    if (result?.is_emerging) {
      // Keep it — mark as analyzed and store AI assessment
      await supabaseAdmin.from('signals').update({
        status: 'analyzed',
        raw_data: {
          ...signal.raw_data,
          ai_assessment: result,
        },
        updated_at: new Date().toISOString(),
      }).eq('id', signal.id);
      kept++;
      console.log(`[Scout] ✓ KEPT: ${signal.title} — ${result.novelty_reason}`);
    } else {
      // Dismiss it
      await supabaseAdmin.from('signals').update({
        status: 'dismissed',
        raw_data: {
          ...signal.raw_data,
          ai_assessment: result,
          dismiss_reason: result?.novelty_reason || 'Not emerging',
        },
        updated_at: new Date().toISOString(),
      }).eq('id', signal.id);
      console.log(`[Scout] ✗ DISMISSED: ${signal.title}`);
    }

    // Small delay between AI calls
    await new Promise(r => setTimeout(r, 500));
  }

  return { filtered: rawSignals.length, kept };
}

/**
 * Main Scout Agent run
 */
export async function runScout(): Promise<{
  sources_scraped: string[];
  total_scraped: number;
  total_saved: number;
  filtered: number;
  kept: number;
}> {
  console.log('[Scout] === Starting Scout Run ===');

  // Check budget
  const { exceeded, spent, limit } = await isDailyBudgetExceeded();
  if (exceeded) {
    console.warn(`[Scout] Daily budget exceeded ($${spent.toFixed(2)}/$${limit}). Skipping.`);
    return { sources_scraped: [], total_scraped: 0, total_saved: 0, filtered: 0, kept: 0 };
  }

  // Pick 2 sources for this run (rotate)
  const sourcesToScrape: SourceName[] = [
    SOURCE_ORDER[sourceIndex % SOURCE_ORDER.length],
    SOURCE_ORDER[(sourceIndex + 1) % SOURCE_ORDER.length],
  ];
  sourceIndex = (sourceIndex + 2) % SOURCE_ORDER.length;

  let totalScraped = 0;
  let totalSaved = 0;

  for (const source of sourcesToScrape) {
    try {
      console.log(`[Scout] Scraping ${source}...`);
      const result = await SOURCE_SCRAPERS[source]();
      totalScraped += result.scraped;
      totalSaved += result.saved;
    } catch (error) {
      console.error(`[Scout] Error scraping ${source}:`, error);
    }
  }

  // Pre-filter raw signals with AI
  const filterResult = await preFilterRawSignals();

  console.log(`[Scout] === Scout Run Complete ===`);
  console.log(`[Scout] Sources: ${sourcesToScrape.join(', ')}`);
  console.log(`[Scout] Scraped: ${totalScraped}, Saved: ${totalSaved}`);
  console.log(`[Scout] Filtered: ${filterResult.filtered}, Kept: ${filterResult.kept}`);

  return {
    sources_scraped: sourcesToScrape,
    total_scraped: totalScraped,
    total_saved: totalSaved,
    ...filterResult,
  };
}

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
import { scrapeGoogleTrends } from './sources/google-trends';
import { scrapeTechMedia } from './sources/tech-media-rss';
import { scrapeTwitterTrends } from './sources/twitter-trends';
import { scrapeYouTubeSuggestions } from './sources/youtube-suggestions';
import { scrapeGooglePAA } from './sources/google-paa';
import { scrapeZhihu } from './sources/zhihu';
import { scrapeChromeWebStore } from './sources/chrome-webstore';
import { scrapeIndieHackers } from './sources/indiehackers';
import { scrapeGumroad } from './sources/gumroad';
import { scrapeExplodingTopics } from './sources/exploding-topics';
import { scrapeTechmeme } from './sources/techmeme';
import { scrapeBestBlogs } from './sources/bestblogs';
import { scrapeQuora } from './sources/quora';
import { scrape36Kr } from './sources/36kr';
import { scrapeWeibo } from './sources/weibo';
import { scrapeBilibili } from './sources/bilibili';
import { scrapeJuejin } from './sources/juejin';
import { scrapeXiaohongshu } from './sources/xiaohongshu';
import { scrapeDouyin } from './sources/douyin';
import { scrapeV2ex } from './sources/v2ex';

type SourceName = 'github_trending' | 'hackernews' | 'producthunt' | 'reddit' | 'google_trends' | 'tech_media' | 'twitter_trends' | 'youtube_suggestions' | 'google_paa' | 'zhihu' | 'chrome_webstore' | 'indiehackers' | 'gumroad' | 'exploding_topics' | 'techmeme' | 'bestblogs' | 'quora' | '36kr' | 'weibo' | 'bilibili' | 'juejin' | 'xiaohongshu' | 'douyin' | 'v2ex';

const SOURCE_SCRAPERS: Record<SourceName, () => Promise<{ scraped: number; saved: number }>> = {
  github_trending: scrapeGitHubTrending,
  hackernews: scrapeHackerNews,
  producthunt: scrapeProductHunt,
  reddit: scrapeReddit,
  google_trends: scrapeGoogleTrends,
  tech_media: scrapeTechMedia,
  twitter_trends: scrapeTwitterTrends,
  youtube_suggestions: scrapeYouTubeSuggestions,
  google_paa: scrapeGooglePAA,
  zhihu: scrapeZhihu,
  chrome_webstore: scrapeChromeWebStore,
  indiehackers: scrapeIndieHackers,
  gumroad: scrapeGumroad,
  exploding_topics: scrapeExplodingTopics,
  techmeme: scrapeTechmeme,
  bestblogs: scrapeBestBlogs,
  quora: scrapeQuora,
  '36kr': scrape36Kr,
  weibo: scrapeWeibo,
  bilibili: scrapeBilibili,
  juejin: scrapeJuejin,
  xiaohongshu: scrapeXiaohongshu,
  douyin: scrapeDouyin,
  v2ex: scrapeV2ex,
};

// Rotation sources
let devSourceIndex = 0;
const DEV_SOURCES: SourceName[] = ['github_trending', 'hackernews', 'producthunt', 'reddit', 'chrome_webstore', 'indiehackers', 'gumroad', 'quora', 'xiaohongshu'];
const ALWAYS_SOURCES: SourceName[] = ['google_trends', 'tech_media', 'twitter_trends', 'youtube_suggestions', 'google_paa', 'zhihu', 'exploding_topics', 'techmeme', 'bestblogs', '36kr', 'weibo', 'bilibili', 'juejin', 'douyin', 'v2ex'];

interface PreFilterResult {
  is_emerging: boolean;
  novelty_reason: string;
  category: string;
  target_audience: string;
  potential_products: string[];
  user_pain_points: string[];
  derivative_angles: string[];
  urgency: 'high' | 'medium' | 'low';
  longtail_potential: 'high' | 'medium' | 'low';
}

/**
 * AI pre-filter: determine if a signal represents an emerging tech opportunity
 */
async function preFilterSignal(signal: { title: string; description: string; source: string; stars: number }): Promise<PreFilterResult | null> {
  const prompt = `Analyze this signal and determine if it represents an EMERGING product opportunity worth building a website around (tutorial, tool, or resource site for AdSense monetization).

"Emerging" means:
1. The product/technology/trend is NEW or recently went viral (< 30 days)
2. Growing fast — gaining search interest, social buzz, or media coverage
3. NOT a mature/established category (not image compression, not background removal, not generic well-known tools)
4. Has a LARGE potential audience — ordinary people (not just developers) searching for how to use it, alternatives, tutorials, etc.

HIGH priority signals:
- New AI tools/apps that ordinary people want to try (e.g. new video generators, image editors, chatbots)
- Trending consumer products or services covered by major tech media
- Google Trends spikes for new product names or categories
- "How to use X" type demand for recently launched products

MEDIUM priority signals:
- Developer tools with crossover appeal (e.g. no-code platforms, AI coding tools)
- New open-source projects with large community interest (300+ stars, 100+ comments)

LOW priority (likely dismiss):
- Niche developer libraries or frameworks with < 1000 potential users
- Academic papers or research without consumer application
- Enterprise/B2B tools with no individual user market

Signal:
- Title: ${signal.title}
- Description: ${signal.description}
- Source: ${signal.source}
- Traction: ${signal.stars} stars/votes

Additionally, identify:
- User pain points: What specific things are people searching for or asking about? (e.g., "how to use Seedance", "Seedance vs Kling", "Seedance pricing", "Seedance alternatives")
- Derivative product angles: What lightweight products could address these needs? (e.g., tutorial site, comparison page, prompt guide, tool directory, pricing calculator)
- Long-tail potential: Will people still search for this in 3-6 months, or is it a one-week spike?

Respond in JSON:
{
  "is_emerging": boolean,
  "novelty_reason": "why this is or isn't emerging",
  "category": "ai_tool|consumer_app|dev_tool|saas|framework|trending_topic|other",
  "target_audience": "general_public|prosumer|developer|niche",
  "potential_products": ["tutorial site", "how-to guide", "comparison page", "tool directory", etc.],
  "user_pain_points": ["how to use X", "X vs Y comparison", "X pricing/free alternatives", etc.],
  "derivative_angles": ["tutorial", "comparison", "directory", "prompt_guide", "calculator", "cheatsheet", etc.],
  "urgency": "high|medium|low",
  "longtail_potential": "high|medium|low"
}

Prioritize signals with LARGE audiences. A trending AI video tool used by millions beats a niche Rust library used by hundreds.`;

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

  // Always scrape consumer-facing sources + rotate 1 dev source
  const sourcesToScrape: SourceName[] = [
    ...ALWAYS_SOURCES,
    DEV_SOURCES[devSourceIndex % DEV_SOURCES.length],
  ];
  devSourceIndex = (devSourceIndex + 1) % DEV_SOURCES.length;

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

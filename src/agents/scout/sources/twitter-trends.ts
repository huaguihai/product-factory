/**
 * Twitter/X Trends Scraper
 * Fetches trending topics from trends24.in (public Twitter trends aggregator)
 * Covers US, Global, and Japan trends
 * No API key required
 */

import * as cheerio from 'cheerio';
import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

interface TwitterTrend {
  name: string;
  searchUrl: string;
  tweetCount: string;
  geo: string;
  snapshotTime: string;
}

// Regions to scrape
const REGIONS: Array<{ name: string; slug: string; geo: string }> = [
  { name: 'United States', slug: 'united-states', geo: 'US' },
  { name: 'Worldwide', slug: '', geo: 'WW' },   // root page = worldwide
  { name: 'Japan', slug: 'japan', geo: 'JP' },
];

/**
 * Fetch and parse trends from trends24.in for a given region
 */
async function fetchTrends(region: { name: string; slug: string; geo: string }): Promise<TwitterTrend[]> {
  try {
    const url = region.slug
      ? `https://trends24.in/${region.slug}/`
      : 'https://trends24.in/';

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`[Twitter] ${region.name} fetch failed: ${response.status}`);
      return [];
    }

    const html = await response.text();
    return parseTrends(html, region.geo);
  } catch (error: any) {
    console.error(`[Twitter] ${region.name} error: ${error.message || error}`);
    return [];
  }
}

/**
 * Parse trends from trends24.in HTML
 * Structure: ol.trend-card__list > li > span.trend-name > a.trend-link
 * Time snapshots in h3 elements
 */
function parseTrends(html: string, geo: string): TwitterTrend[] {
  const $ = cheerio.load(html);
  const trends: TwitterTrend[] = [];
  const seen = new Set<string>();

  // Get the most recent snapshot's trends (first trend-card__list in the timeline)
  // Each h3 is a timestamp, followed by a list-container with the trends
  const lists = $('ol.trend-card__list');

  // Only take trends from the first 2 snapshots (most recent ~2 hours)
  const maxLists = Math.min(lists.length, 2);

  for (let i = 0; i < maxLists; i++) {
    const list = $(lists[i]);

    // Try to find the timestamp from a preceding h3
    let snapshotTime = '';
    const parentContainer = list.closest('.list-container').parent();
    const h3 = parentContainer.find('h3').first();
    if (h3.length) {
      snapshotTime = h3.text().trim();
    }

    list.find('li').each((_j, li) => {
      const link = $(li).find('a.trend-link');
      const name = link.text().trim();
      const href = link.attr('href') || '';

      // Get tweet count if available
      const countEl = $(li).find('.tweet-count');
      const tweetCount = countEl.attr('data-count') || countEl.text().trim() || '';

      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        trends.push({
          name,
          searchUrl: href || `https://twitter.com/search?q=${encodeURIComponent(name)}`,
          tweetCount,
          geo,
          snapshotTime,
        });
      }
    });
  }

  return trends;
}

// Tech/product-related keywords to prioritize
// These use word-boundary matching to avoid false positives (e.g. "ai" in "Jimmy Lai")
const TECH_KEYWORDS = [
  // AI & ML (longer forms to avoid partial matches)
  'chatgpt', 'openai', 'open ai', 'claude ai', 'gemini ai', 'gpt-4', 'gpt-5',
  'copilot', 'midjourney', 'stable diffusion', 'sora', 'dall-e', 'dalle',
  'deepseek', 'anthropic', 'perplexity',
  // Video/Image gen
  'seedance', 'kling ai', 'pika labs', 'runway ml', 'luma ai', 'hailuo',
  'ai video', 'ai image', 'ai photo', 'ai art', 'ai tool',
  'ai chatbot', 'ai assistant', 'ai model', 'ai agent',
  // Tech products
  'iphone', 'android', 'chatgpt ads', 'windows 12',
  'vision pro', 'pixel', 'samsung galaxy',
  // Platforms (specific events only)
  'discord age', 'tiktok ban', 'twitter down', 'youtube premium',
  'instagram update', 'whatsapp feature',
  // Specific tech terms
  'cryptocurrency', 'bitcoin', 'ethereum', 'blockchain',
  'data breach', 'cybersecurity', 'ransomware',
  'self-driving', 'electric vehicle',
  // AI tools for ordinary people
  'ai resume', 'ai headshot', 'ai writing', 'ai coding',
  'ai music', 'ai voice', 'text to video', 'text-to-image',
];

/**
 * Check if a trend is potentially tech/product related
 * We keep ALL trends for the database, but mark tech-related ones
 */
function isTechRelated(name: string): boolean {
  const lower = name.toLowerCase();
  return TECH_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Main scrape function
 */
export async function scrapeTwitterTrends(): Promise<{ scraped: number; saved: number }> {
  console.log('[Twitter] Starting trends scrape...');

  // Fetch all regions in parallel
  const results = await Promise.allSettled(
    REGIONS.map(region => fetchTrends(region))
  );

  // Collect all trends
  const allTrends: TwitterTrend[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      console.log(`[Twitter] ${REGIONS[i].name}: ${result.value.length} trends`);
      allTrends.push(...result.value);
    } else {
      console.error(`[Twitter] ${REGIONS[i].name}: failed`);
    }
  }

  // Global dedup
  const seen = new Set<string>();
  const deduped = allTrends.filter(t => {
    const key = t.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Prioritize: tech-related trends first, then top trends by position
  // We save tech-related trends + top 15 general trends (for broad signal coverage)
  const techTrends = deduped.filter(t => isTechRelated(t.name));
  const otherTrends = deduped.filter(t => !isTechRelated(t.name)).slice(0, 15);
  const trendsToSave = [...techTrends, ...otherTrends];

  console.log(`[Twitter] Total: ${deduped.length} unique trends, ${techTrends.length} tech-related, saving ${trendsToSave.length}`);

  let saved = 0;

  for (const trend of trendsToSave) {
    const hash = contentHash(trend.name, 'twitter_trends');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'twitter_trends')
      .eq('content_hash', hash)
      .maybeSingle();

    if (existing) continue;

    const sourceId = `tw_${trend.geo.toLowerCase()}_${trend.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 60)}`;

    const isTech = isTechRelated(trend.name);

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'twitter_trends',
      source_id: sourceId,
      source_url: trend.searchUrl,
      title: trend.name,
      description: `Trending on X/Twitter (${trend.geo})${trend.tweetCount ? ` — ${trend.tweetCount} tweets` : ''}${isTech ? ' [TECH]' : ''}`,
      stars: 0,
      comments_count: 0,
      source_created_at: new Date().toISOString(),
      content_hash: hash,
      raw_data: {
        geo: trend.geo,
        tweet_count: trend.tweetCount,
        snapshot_time: trend.snapshotTime,
        is_tech_related: isTech,
        search_url: trend.searchUrl,
      },
    });

    if (!error) {
      saved++;
      const tag = isTech ? '🔧' : '📊';
      console.log(`[Twitter] ${tag} Saved: "${trend.name}" (${trend.geo}${trend.tweetCount ? ', ' + trend.tweetCount : ''})`);
    }
  }

  console.log(`[Twitter] Done: ${trendsToSave.length} scraped, ${saved} saved`);
  return { scraped: trendsToSave.length, saved };
}

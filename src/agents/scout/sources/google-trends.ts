/**
 * Google Trends Scraper
 * Fetches daily trending searches and real-time trending topics
 * Focuses on technology & product-related trends that ordinary people search for
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

interface TrendingSearch {
  title: string;
  traffic: string;         // e.g. "200K+"
  trafficNumber: number;   // parsed numeric value
  relatedQueries: string[];
  articles: Array<{ title: string; url: string; source: string }>;
  image?: string;
}

/**
 * Fetch Google Trends daily trending searches via unofficial RSS/JSON endpoint
 * This endpoint returns the top 20 daily trending searches for a given region
 */
async function fetchDailyTrends(geo: string = 'US'): Promise<TrendingSearch[]> {
  try {
    // Google Trends daily trending searches RSS (returns JSON when requested)
    const url = `https://trends.google.com/trending/rss?geo=${geo}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ProductFactory/1.0)',
        'Accept': 'application/xml, text/xml',
      },
    });

    if (!response.ok) {
      console.error(`[GoogleTrends] Daily trends failed: ${response.status}`);
      return [];
    }

    const xml = await response.text();
    return parseTrendingRSS(xml);
  } catch (error) {
    console.error('[GoogleTrends] Daily trends error:', error);
    return [];
  }
}

/**
 * Parse the Google Trends RSS XML response
 */
function parseTrendingRSS(xml: string): TrendingSearch[] {
  const results: TrendingSearch[] = [];

  // Extract items from RSS XML
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const title = extractTag(itemXml, 'title');
    const traffic = extractTag(itemXml, 'ht:approx_traffic') || '0';
    const trafficNumber = parseTraffic(traffic);

    // Extract news items
    const articles: Array<{ title: string; url: string; source: string }> = [];
    const newsRegex = /<ht:news_item>([\s\S]*?)<\/ht:news_item>/g;
    let newsMatch;
    while ((newsMatch = newsRegex.exec(itemXml)) !== null) {
      const newsXml = newsMatch[1];
      articles.push({
        title: extractTag(newsXml, 'ht:news_item_title') || '',
        url: extractTag(newsXml, 'ht:news_item_url') || '',
        source: extractTag(newsXml, 'ht:news_item_source') || '',
      });
    }

    if (title) {
      results.push({
        title,
        traffic,
        trafficNumber,
        relatedQueries: [],
        articles,
      });
    }
  }

  return results;
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}>([\\s\\S]*?)</${tag}>`);
  const match = regex.exec(xml);
  return (match?.[1] || match?.[2] || '').trim();
}

function parseTraffic(traffic: string): number {
  const cleaned = traffic.replace(/[,+]/g, '').trim();
  if (cleaned.endsWith('K')) return parseFloat(cleaned) * 1000;
  if (cleaned.endsWith('M')) return parseFloat(cleaned) * 1000000;
  return parseInt(cleaned, 10) || 0;
}

/**
 * Fetch Google Trends real-time trending searches (tech category)
 * Category 5 = Science/Tech
 */
async function fetchRealtimeTrends(geo: string = 'US'): Promise<TrendingSearch[]> {
  try {
    const url = `https://trends.google.com/trending/rss?geo=${geo}&category=5`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ProductFactory/1.0)',
        'Accept': 'application/xml, text/xml',
      },
    });

    if (!response.ok) {
      console.error(`[GoogleTrends] Realtime trends failed: ${response.status}`);
      return [];
    }

    const xml = await response.text();
    return parseTrendingRSS(xml);
  } catch (error) {
    console.error('[GoogleTrends] Realtime trends error:', error);
    return [];
  }
}

/**
 * Main scrape function
 */
export async function scrapeGoogleTrends(): Promise<{ scraped: number; saved: number }> {
  console.log('[GoogleTrends] Starting scrape...');

  // Fetch both daily and realtime tech trends
  const [daily, realtime] = await Promise.all([
    fetchDailyTrends('US'),
    fetchRealtimeTrends('US'),
  ]);

  // Also fetch Japanese trends for JP market
  const [dailyJP] = await Promise.all([
    fetchDailyTrends('JP'),
  ]);

  // Combine and dedupe
  const seen = new Set<string>();
  const allTrends: (TrendingSearch & { geo: string })[] = [];

  for (const trend of daily) {
    const key = trend.title.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      allTrends.push({ ...trend, geo: 'US' });
    }
  }
  for (const trend of realtime) {
    const key = trend.title.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      allTrends.push({ ...trend, geo: 'US' });
    }
  }
  for (const trend of dailyJP) {
    const key = trend.title.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      allTrends.push({ ...trend, geo: 'JP' });
    }
  }

  // Filter: only keep trends with meaningful traffic (500+)
  const filtered = allTrends.filter(t => t.trafficNumber >= 500);
  console.log(`[GoogleTrends] Found ${allTrends.length} trends, ${filtered.length} with traffic >= 500`);

  let saved = 0;

  for (const trend of filtered) {
    const sourceId = `gtrends_${trend.geo.toLowerCase()}_${trend.title.toLowerCase().replace(/\s+/g, '_').slice(0, 80)}`;
    const hash = contentHash(trend.title, 'google_trends');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'google_trends')
      .eq('content_hash', hash)
      .maybeSingle();

    if (existing) continue;

    // Build description from related articles
    const articleSummary = trend.articles
      .slice(0, 3)
      .map(a => `${a.title} (${a.source})`)
      .join('; ');

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'google_trends',
      source_id: sourceId,
      source_url: `https://trends.google.com/trending?geo=${trend.geo}&q=${encodeURIComponent(trend.title)}`,
      title: trend.title,
      description: articleSummary || `Trending search: ${trend.title}`,
      stars: trend.trafficNumber,
      comments_count: trend.articles.length,
      source_created_at: new Date().toISOString(),
      content_hash: hash,
      raw_data: {
        traffic: trend.traffic,
        traffic_number: trend.trafficNumber,
        geo: trend.geo,
        articles: trend.articles,
        related_queries: trend.relatedQueries,
      },
    });

    if (!error) {
      saved++;
      console.log(`[GoogleTrends] Saved: "${trend.title}" (${trend.traffic}, ${trend.geo})`);
    }
  }

  console.log(`[GoogleTrends] Done: ${filtered.length} scraped, ${saved} saved`);
  return { scraped: filtered.length, saved };
}

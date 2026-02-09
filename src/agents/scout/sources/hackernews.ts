/**
 * HackerNews Scraper
 * Uses Algolia API to find new project launches and Show HN posts
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

interface HNItem {
  objectID: string;
  title: string;
  url: string;
  points: number;
  num_comments: number;
  created_at: string;
  author: string;
  story_text?: string;
}

/**
 * Search HN via Algolia API
 */
async function searchHN(
  query: string,
  tags: string = 'show_hn',
  limit: number = 30
): Promise<HNItem[]> {
  try {
    // Only get posts from last 14 days
    const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=${tags}&hitsPerPage=${limit}&numericFilters=created_at_i>${twoWeeksAgo}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'ProductFactory/1.0' },
    });

    if (!response.ok) {
      console.error(`[HN] Search failed: ${response.status}`);
      return [];
    }

    const data: any = await response.json();
    return (data.hits || []).map((hit: any) => ({
      objectID: hit.objectID,
      title: hit.title || hit.story_title || '',
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      points: hit.points || 0,
      num_comments: hit.num_comments || 0,
      created_at: hit.created_at,
      author: hit.author || 'unknown',
      story_text: hit.story_text || '',
    }));
  } catch (error) {
    console.error('[HN] Search error:', error);
    return [];
  }
}

/**
 * Fetch front page stories sorted by points
 */
async function fetchFrontPage(limit: number = 30): Promise<HNItem[]> {
  try {
    const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
    const url = `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${limit}&numericFilters=created_at_i>${twoWeeksAgo}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'ProductFactory/1.0' },
    });

    if (!response.ok) return [];
    const data: any = await response.json();

    return (data.hits || []).map((hit: any) => ({
      objectID: hit.objectID,
      title: hit.title || '',
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      points: hit.points || 0,
      num_comments: hit.num_comments || 0,
      created_at: hit.created_at,
      author: hit.author || 'unknown',
      story_text: hit.story_text || '',
    }));
  } catch (error) {
    console.error('[HN] Front page error:', error);
    return [];
  }
}

/**
 * Main scrape function
 */
export async function scrapeHackerNews(): Promise<{ scraped: number; saved: number }> {
  console.log('[HN] Starting scrape...');

  // Get Show HN posts (project launches)
  const showHN = await searchHN('', 'show_hn', 30);
  // Get front page tech posts
  const frontPage = await fetchFrontPage(20);

  // Combine and dedupe
  const seen = new Set<string>();
  const allItems: HNItem[] = [];
  for (const item of [...showHN, ...frontPage]) {
    if (!seen.has(item.objectID)) {
      seen.add(item.objectID);
      allItems.push(item);
    }
  }

  // Filter: score > 30 (meaningful traction)
  const filtered = allItems.filter(item => item.points >= 30);
  console.log(`[HN] Found ${allItems.length} items, ${filtered.length} with score >= 30`);

  let saved = 0;

  for (const item of filtered) {
    const hash = contentHash(item.title, 'hackernews');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'hackernews')
      .eq('source_id', item.objectID)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'hackernews',
      source_id: item.objectID,
      source_url: `https://news.ycombinator.com/item?id=${item.objectID}`,
      title: item.title,
      description: item.story_text?.slice(0, 500) || '',
      stars: item.points,
      comments_count: item.num_comments,
      source_created_at: item.created_at,
      content_hash: hash,
      raw_data: {
        url: item.url,
        author: item.author,
        points: item.points,
        num_comments: item.num_comments,
      },
    });

    if (!error) {
      saved++;
      console.log(`[HN] Saved: "${item.title.slice(0, 60)}" (${item.points} pts)`);
    }
  }

  console.log(`[HN] Done: ${filtered.length} scraped, ${saved} saved`);
  return { scraped: filtered.length, saved };
}

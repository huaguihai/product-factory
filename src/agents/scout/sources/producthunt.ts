/**
 * ProductHunt Scraper
 * Fetches recent product launches via web scraping (no API key needed)
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash, daysSince } from '../../../utils/helpers';

interface PHProduct {
  id: string;
  name: string;
  tagline: string;
  url: string;
  votesCount: number;
  commentsCount: number;
  launchedAt: string;
  topics: string[];
}

/**
 * Fetch recent products from ProductHunt using their public web API
 */
async function fetchRecentProducts(): Promise<PHProduct[]> {
  try {
    // Use the unofficial JSON endpoint that the PH homepage uses
    const response = await fetch('https://www.producthunt.com/frontend/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Origin': 'https://www.producthunt.com',
      },
      body: JSON.stringify({
        operationName: 'HomePage',
        variables: { cursor: null },
        query: `query HomePage($cursor: String) {
          posts(first: 20, after: $cursor, order: VOTES) {
            edges {
              node {
                id
                name
                tagline
                slug
                votesCount
                commentsCount
                createdAt
                topics {
                  edges {
                    node {
                      name
                    }
                  }
                }
              }
            }
          }
        }`,
      }),
    });

    if (!response.ok) {
      console.error(`[PH] GraphQL request failed: ${response.status}`);
      return [];
    }

    const data: any = await response.json();
    const edges = data?.data?.posts?.edges || [];

    return edges.map((edge: any) => {
      const node = edge.node;
      return {
        id: node.id,
        name: node.name,
        tagline: node.tagline || '',
        url: `https://www.producthunt.com/posts/${node.slug}`,
        votesCount: node.votesCount || 0,
        commentsCount: node.commentsCount || 0,
        launchedAt: node.createdAt,
        topics: (node.topics?.edges || []).map((t: any) => t.node?.name).filter(Boolean),
      };
    });
  } catch (error) {
    console.error('[PH] Fetch error:', error);
    return [];
  }
}

/**
 * Fallback: Scrape the RSS feed if GraphQL fails
 */
async function fetchFromRSS(): Promise<PHProduct[]> {
  try {
    const response = await fetch('https://www.producthunt.com/feed?category=undefined', {
      headers: { 'User-Agent': 'ProductFactory/1.0' },
    });

    if (!response.ok) return [];
    const text = await response.text();

    const products: PHProduct[] = [];
    // Simple XML parsing for RSS items
    const items = text.match(/<item>([\s\S]*?)<\/item>/g) || [];

    for (const item of items.slice(0, 20)) {
      const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || '';
      const link = item.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
      const description = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1] || '';

      if (title && link) {
        products.push({
          id: link.split('/').pop() || title,
          name: title,
          tagline: description.slice(0, 200),
          url: link,
          votesCount: 0,
          commentsCount: 0,
          launchedAt: pubDate,
          topics: [],
        });
      }
    }

    return products;
  } catch {
    return [];
  }
}

/**
 * Main scrape function
 */
export async function scrapeProductHunt(): Promise<{ scraped: number; saved: number }> {
  console.log('[PH] Starting scrape...');

  let products = await fetchRecentProducts();
  if (products.length === 0) {
    console.log('[PH] GraphQL failed, trying RSS...');
    products = await fetchFromRSS();
  }

  console.log(`[PH] Found ${products.length} products`);

  // Filter: only tech-related with decent traction
  const techTopics = ['developer tools', 'artificial intelligence', 'saas', 'open source',
    'productivity', 'api', 'no-code', 'design tools', 'devops', 'web app'];

  const filtered = products.filter(p => {
    // Keep if has tech topics or decent votes
    const hasTechTopic = p.topics.some(t => techTopics.includes(t.toLowerCase()));
    const hasVotes = p.votesCount >= 50;
    return hasTechTopic || hasVotes;
  });

  console.log(`[PH] ${filtered.length} products after filtering`);

  let saved = 0;

  for (const product of filtered) {
    const hash = contentHash(product.name, 'producthunt');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'producthunt')
      .eq('source_id', product.id)
      .maybeSingle();

    if (existing) continue;

    const daysOld = product.launchedAt ? daysSince(product.launchedAt) : 0;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'producthunt',
      source_id: product.id,
      source_url: product.url,
      title: product.name,
      description: product.tagline,
      stars: product.votesCount,
      comments_count: product.commentsCount,
      source_created_at: product.launchedAt || null,
      content_hash: hash,
      raw_data: {
        topics: product.topics,
        days_old: daysOld,
      },
    });

    if (!error) {
      saved++;
      console.log(`[PH] Saved: ${product.name} (${product.votesCount} votes, ${daysOld}d old)`);
    }
  }

  console.log(`[PH] Done: ${filtered.length} scraped, ${saved} saved`);
  return { scraped: filtered.length, saved };
}

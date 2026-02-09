/**
 * Tech Media RSS Scraper
 * Fetches latest articles from major tech publications
 * Focuses on new product launches, AI tools, and consumer tech
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

interface FeedItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  source: string;
}

// Tech media RSS feeds — prioritize consumer-facing tech coverage
const RSS_FEEDS: Array<{ name: string; url: string; category: string }> = [
  // Major tech media
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'general' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'general' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'general' },
  { name: 'Wired', url: 'https://www.wired.com/feed/rss', category: 'general' },

  // AI-focused
  { name: 'VentureBeat AI', url: 'https://venturebeat.com/category/ai/feed/', category: 'ai' },
  { name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/', category: 'ai' },

  // Product launches
  { name: 'Product Hunt', url: 'https://www.producthunt.com/feed', category: 'products' },

  // Dev + consumer crossover
  { name: 'TNW', url: 'https://thenextweb.com/feed', category: 'general' },
];

// Keywords that indicate a product launch or new tool (consumer-relevant)
const LAUNCH_KEYWORDS = [
  // Product launch signals
  'launch', 'launches', 'launched', 'releasing', 'released', 'announces',
  'announced', 'introduces', 'introducing', 'unveils', 'unveiled', 'debuts',
  'rolls out', 'rolling out', 'now available', 'just dropped', 'goes live',
  // Product types that interest ordinary people
  'ai tool', 'ai app', 'chatbot', 'image generator', 'video generator',
  'ai assistant', 'free alternative', 'open source alternative',
  'new app', 'new feature', 'new model', 'api', 'platform',
  // Specific hot areas
  'gpt', 'claude', 'gemini', 'midjourney', 'stable diffusion', 'sora',
  'copilot', 'ai video', 'ai image', 'ai music', 'ai voice',
  'text to', 'text-to', 'ai photo', 'ai writing', 'ai coding',
];

/**
 * Fetch and parse a single RSS feed
 */
async function fetchFeed(feed: { name: string; url: string; category: string }): Promise<FeedItem[]> {
  try {
    const response = await fetch(feed.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ProductFactory/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml',
      },
      signal: AbortSignal.timeout(10000), // 10s timeout per feed
    });

    if (!response.ok) {
      console.error(`[TechMedia] ${feed.name} fetch failed: ${response.status}`);
      return [];
    }

    const xml = await response.text();
    return parseRSS(xml, feed.name);
  } catch (error: any) {
    console.error(`[TechMedia] ${feed.name} error: ${error.message || error}`);
    return [];
  }
}

/**
 * Parse RSS/Atom XML into items
 * Handles both RSS 2.0 (<item>) and Atom (<entry>) formats
 */
function parseRSS(xml: string, sourceName: string): FeedItem[] {
  const items: FeedItem[] = [];

  // Try RSS 2.0 format first (<item>), then Atom (<entry>)
  const itemRegex = /<item>([\s\S]*?)<\/item>|<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1] || match[2];

    // RSS 2.0 fields
    let title = extractCDATA(itemXml, 'title');
    let link = extractCDATA(itemXml, 'link');
    let pubDate = extractCDATA(itemXml, 'pubDate') || extractCDATA(itemXml, 'published') || extractCDATA(itemXml, 'updated');
    let description = extractCDATA(itemXml, 'description') || extractCDATA(itemXml, 'summary') || extractCDATA(itemXml, 'content');

    // Atom: link might be in href attribute
    if (!link) {
      const linkMatch = /<link[^>]*href="([^"]*)"[^>]*\/?>/.exec(itemXml);
      if (linkMatch) link = linkMatch[1];
    }

    // Clean HTML from description
    if (description) {
      description = description
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
    }

    if (title && link) {
      items.push({
        title: title.trim(),
        link: link.trim(),
        pubDate: pubDate || new Date().toISOString(),
        description: description || '',
        source: sourceName,
      });
    }
  }

  return items;
}

function extractCDATA(xml: string, tag: string): string {
  // Match CDATA or plain content
  const regex = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`,
    'i'
  );
  const match = regex.exec(xml);
  return (match?.[1] || match?.[2] || '').trim();
}

/**
 * Check if an article is about a product launch or new tech tool
 */
function isProductLaunch(title: string, description: string): boolean {
  const text = `${title} ${description}`.toLowerCase();
  return LAUNCH_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * Filter to only recent articles (last 3 days)
 */
function isRecent(pubDate: string): boolean {
  try {
    const date = new Date(pubDate);
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return date.getTime() > threeDaysAgo;
  } catch {
    return true; // If we can't parse date, keep it
  }
}

/**
 * Main scrape function
 */
export async function scrapeTechMedia(): Promise<{ scraped: number; saved: number }> {
  console.log('[TechMedia] Starting scrape...');

  // Fetch all feeds in parallel (with individual timeouts)
  const feedResults = await Promise.allSettled(
    RSS_FEEDS.map(feed => fetchFeed(feed))
  );

  // Collect all items
  const allItems: FeedItem[] = [];
  for (let i = 0; i < feedResults.length; i++) {
    const result = feedResults[i];
    if (result.status === 'fulfilled') {
      console.log(`[TechMedia] ${RSS_FEEDS[i].name}: ${result.value.length} items`);
      allItems.push(...result.value);
    } else {
      console.error(`[TechMedia] ${RSS_FEEDS[i].name}: failed`);
    }
  }

  // Filter: recent + product launch related
  const filtered = allItems.filter(item =>
    isRecent(item.pubDate) && isProductLaunch(item.title, item.description)
  );

  // Dedupe by title similarity
  const seen = new Set<string>();
  const deduped = filtered.filter(item => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[TechMedia] Total: ${allItems.length} items, ${filtered.length} launch-related, ${deduped.length} after dedup`);

  let saved = 0;

  for (const item of deduped) {
    const hash = contentHash(item.title, 'tech_media');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'tech_media')
      .eq('content_hash', hash)
      .maybeSingle();

    if (existing) continue;

    const sourceId = `tm_${item.source.toLowerCase().replace(/\s+/g, '_')}_${hash.slice(0, 16)}`;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'tech_media',
      source_id: sourceId,
      source_url: item.link,
      title: item.title,
      description: item.description,
      stars: 0,  // RSS doesn't have traction metrics
      comments_count: 0,
      source_created_at: item.pubDate,
      content_hash: hash,
      raw_data: {
        media_source: item.source,
        pub_date: item.pubDate,
        full_description: item.description,
      },
    });

    if (!error) {
      saved++;
      console.log(`[TechMedia] Saved: [${item.source}] ${item.title.slice(0, 70)}`);
    }
  }

  console.log(`[TechMedia] Done: ${deduped.length} scraped, ${saved} saved`);
  return { scraped: deduped.length, saved };
}

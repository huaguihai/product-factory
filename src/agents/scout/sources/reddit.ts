/**
 * Reddit Scraper
 * Finds new tool/project launches and pain points from tech subreddits
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

const TARGET_SUBREDDITS = [
  'programming',
  'webdev',
  'selfhosted',
  'MachineLearning',
  'artificial',
  'opensource',
  'devops',
  'nextjs',
  'reactjs',
  'node',
];

// Keywords that indicate a new project/tool launch
const LAUNCH_KEYWORDS = [
  'i built',
  'i made',
  'i created',
  'just launched',
  'just released',
  'introducing',
  'show r/',
  'open source',
  'open-source',
  'launched today',
  'check out my',
  'side project',
  'new tool',
  'new library',
];

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  subreddit: string;
  score: number;
  num_comments: number;
  url: string;
  permalink: string;
  created_utc: number;
  author: string;
  link_flair_text: string | null;
}

/**
 * Fetch posts from a subreddit using Reddit's JSON API
 */
async function fetchSubreddit(
  subreddit: string,
  sort: 'hot' | 'new' | 'top' = 'hot',
  limit: number = 25
): Promise<RedditPost[]> {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&t=week`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[Reddit] Failed to fetch r/${subreddit}: ${response.status}`);
      return [];
    }

    const data: any = await response.json();
    return (data.data?.children || [])
      .filter((child: any) => child.kind === 't3')
      .map((child: any) => ({
        id: child.data.id,
        title: child.data.title,
        selftext: child.data.selftext || '',
        subreddit: child.data.subreddit,
        score: child.data.score,
        num_comments: child.data.num_comments,
        url: child.data.url,
        permalink: `https://reddit.com${child.data.permalink}`,
        created_utc: child.data.created_utc,
        author: child.data.author,
        link_flair_text: child.data.link_flair_text,
      }));
  } catch (error) {
    console.error(`[Reddit] Error fetching r/${subreddit}:`, error);
    return [];
  }
}

/**
 * Check if a post is likely a project/tool launch
 */
function isLaunchPost(post: RedditPost): boolean {
  const text = `${post.title} ${post.selftext}`.toLowerCase();
  return LAUNCH_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * Main scrape function
 */
export async function scrapeReddit(): Promise<{ scraped: number; saved: number }> {
  console.log('[Reddit] Starting scrape...');

  let totalScraped = 0;
  let saved = 0;

  for (const subreddit of TARGET_SUBREDDITS) {
    const posts = await fetchSubreddit(subreddit, 'hot', 25);
    totalScraped += posts.length;

    // Filter for launch-like posts with some traction
    const launches = posts.filter(p => isLaunchPost(p) && p.score >= 10);

    for (const post of launches) {
      const hash = contentHash(post.title, 'reddit');

      const { data: existing } = await supabaseAdmin
        .from('signals')
        .select('id')
        .eq('source', 'reddit')
        .eq('source_id', post.id)
        .maybeSingle();

      if (existing) continue;

      const createdAt = new Date(post.created_utc * 1000).toISOString();

      const { error } = await supabaseAdmin.from('signals').insert({
        source: 'reddit',
        source_id: post.id,
        source_url: post.permalink,
        title: post.title,
        description: post.selftext.slice(0, 500),
        stars: post.score,
        comments_count: post.num_comments,
        source_created_at: createdAt,
        content_hash: hash,
        raw_data: {
          subreddit: post.subreddit,
          author: post.author,
          flair: post.link_flair_text,
          external_url: post.url,
        },
      });

      if (!error) {
        saved++;
        console.log(`[Reddit] Saved: "${post.title.slice(0, 60)}" from r/${subreddit} (${post.score} pts)`);
      }
    }

    // Rate limit between subreddits
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`[Reddit] Done: ${totalScraped} scraped, ${saved} saved`);
  return { scraped: totalScraped, saved };
}

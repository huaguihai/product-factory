/**
 * IndieHackers Scraper
 * Monitors IndieHackers for successful indie products and validated ideas
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

interface IHPost {
  id: string;
  title: string;
  url: string;
  description: string;
  author: string;
  votes: number;
  comments: number;
  revenue?: string;
}

/**
 * Fetch IndieHackers popular posts via their feed/API
 */
async function fetchIHPosts(): Promise<IHPost[]> {
  const posts: IHPost[] = [];

  // IndieHackers doesn't have a public API, use Google suggestions
  // to find trending IH-related topics
  const seeds = [
    'indiehackers revenue',
    'indie hacker product launch',
    'solo developer making money',
    'micro saas revenue',
    'side project revenue',
    'indie maker profitable',
    'launched on product hunt revenue',
  ];

  const seen = new Set<string>();

  for (const seed of seeds) {
    try {
      const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(seed)}&hl=en`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });

      if (!response.ok) continue;
      const data = await response.json();
      const suggestions: string[] = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];

      for (const s of suggestions) {
        const norm = s.toLowerCase().trim();
        if (!seen.has(norm) && s.length > 10) {
          seen.add(norm);
          posts.push({
            id: `ih-${contentHash(s, 'indiehackers')}`,
            title: s,
            url: `https://www.google.com/search?q=${encodeURIComponent(s + ' site:indiehackers.com')}`,
            description: `独立开发者趋势: "${seed}"`,
            author: '',
            votes: 0,
            comments: 0,
          });
        }
      }
    } catch {
      // Skip
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // Also try HN for IH-related posts
  try {
    const hnUrl = 'https://hn.algolia.com/api/v1/search?query=indie%20hacker%20revenue&tags=story&hitsPerPage=10';
    const response = await fetch(hnUrl, {
      headers: { 'User-Agent': 'ProductFactory/1.0' },
    });

    if (response.ok) {
      const data: any = await response.json();
      for (const hit of (data.hits || [])) {
        const norm = (hit.title || '').toLowerCase().trim();
        if (!seen.has(norm) && hit.title) {
          seen.add(norm);
          posts.push({
            id: `ih-hn-${hit.objectID}`,
            title: hit.title,
            url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
            description: hit.story_text?.slice(0, 300) || '',
            author: hit.author || '',
            votes: hit.points || 0,
            comments: hit.num_comments || 0,
          });
        }
      }
    }
  } catch {
    // Skip
  }

  return posts;
}

/**
 * Score an IH post for opportunity value
 */
function scoreIHPost(post: IHPost): number {
  let score = 0;
  const t = post.title.toLowerCase();

  // Revenue/success signals
  if (t.includes('revenue') || t.includes('$') || t.includes('mrr')) score += 25;
  if (t.includes('profitable') || t.includes('making money')) score += 20;
  if (t.includes('launched') || t.includes('launch')) score += 15;
  if (t.includes('solo') || t.includes('indie') || t.includes('one person')) score += 10;

  // Product type signals
  if (t.includes('saas') || t.includes('tool') || t.includes('app')) score += 15;
  if (t.includes('template') || t.includes('directory') || t.includes('newsletter')) score += 15;
  if (t.includes('ai') || t.includes('chatgpt') || t.includes('automation')) score += 10;

  // Traction
  if (post.votes > 50) score += 20;
  else if (post.votes > 20) score += 10;

  return score;
}

export async function scrapeIndieHackers(): Promise<{ scraped: number; saved: number }> {
  console.log('[IH] 开始采集独立开发者趋势...');

  const posts = await fetchIHPosts();

  const scored = posts
    .map(p => ({ ...p, score: scoreIHPost(p) }))
    .filter(p => p.score >= 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  console.log(`[IH] 获取 ${posts.length} 条信息，${scored.length} 条通过过滤`);

  let saved = 0;
  for (const post of scored) {
    const hash = contentHash(post.title, 'indiehackers');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'indiehackers')
      .eq('source_id', post.id)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'indiehackers',
      source_id: post.id,
      source_url: post.url,
      title: post.title,
      description: post.description,
      stars: post.votes || post.score,
      comments_count: post.comments,
      content_hash: hash,
      raw_data: {
        author: post.author,
        revenue: post.revenue,
        type: 'indie_hacker_signal',
      },
    });

    if (!error) {
      saved++;
      if (saved <= 5) console.log(`[IH] 保存: "${post.title.slice(0, 50)}" (${post.score}分)`);
    }
  }

  console.log(`[IH] 完成: ${scored.length} 条采集, ${saved} 条保存`);
  return { scraped: scored.length, saved };
}

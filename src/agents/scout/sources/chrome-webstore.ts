/**
 * Chrome Web Store Scraper
 * Finds trending and newly published Chrome extensions as demand signals
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

interface CWSExtension {
  id: string;
  name: string;
  url: string;
  description: string;
  category: string;
  rating: number;
  ratingCount: number;
  userCount: string;
}

/**
 * Fetch featured/popular extensions from Chrome Web Store categories
 * Uses the public detail/search endpoints
 */
async function fetchCWSCategory(category: string): Promise<CWSExtension[]> {
  try {
    // Use Google search to find recently published popular extensions
    const query = `site:chromewebstore.google.com "${category}" extension`;
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}&hl=en`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    if (!response.ok) return [];

    const data = await response.json();
    const suggestions: string[] = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];

    return suggestions
      .filter(s => s.length > 10)
      .map((s, idx) => ({
        id: `cws-${category}-${idx}`,
        name: s.replace(/site:chromewebstore\.google\.com\s*/i, '').trim(),
        url: `https://chromewebstore.google.com/search/${encodeURIComponent(s)}`,
        description: `Chrome 扩展搜索趋势: ${s}`,
        category,
        rating: 0,
        ratingCount: 0,
        userCount: '',
      }));
  } catch {
    return [];
  }
}

/**
 * Search for trending extension-related queries
 */
async function fetchTrendingExtensions(): Promise<CWSExtension[]> {
  const seedQueries = [
    'new chrome extension 2026',
    'best chrome extension productivity',
    'chrome extension AI',
    'chrome extension developer tool',
    'chrome extension ad blocker',
    'chrome extension SEO',
    'chrome extension free alternative',
    'chrome extension workflow',
  ];

  const extensions: CWSExtension[] = [];
  const seen = new Set<string>();

  for (const seed of seedQueries) {
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
        if (!seen.has(norm) && s.length > 15) {
          seen.add(norm);
          extensions.push({
            id: `cws-trend-${contentHash(s, 'cws')}`,
            name: s,
            url: `https://www.google.com/search?q=${encodeURIComponent(s)}`,
            description: `Chrome 扩展趋势搜索: "${seed}"`,
            category: 'trending',
            rating: 0,
            ratingCount: 0,
            userCount: '',
          });
        }
      }
    } catch {
      // Skip on error
    }
    await new Promise(r => setTimeout(r, 200));
  }

  return extensions;
}

/**
 * Score an extension signal for product opportunity
 */
function scoreExtension(ext: CWSExtension): number {
  let score = 0;
  const name = ext.name.toLowerCase();

  // High-value signals
  if (name.includes('alternative') || name.includes('replace')) score += 25;
  if (name.includes('free') || name.includes('open source')) score += 15;
  if (name.includes('ai') || name.includes('chatgpt') || name.includes('gpt')) score += 20;
  if (name.includes('best') || name.includes('top')) score += 15;
  if (name.includes('new') || name.includes('2026') || name.includes('2025')) score += 10;
  if (name.includes('productivity') || name.includes('workflow')) score += 10;
  if (name.includes('seo') || name.includes('marketing')) score += 15;

  // Specificity
  if (name.split(' ').length >= 4) score += 10;

  return score;
}

export async function scrapeChromeWebStore(): Promise<{ scraped: number; saved: number }> {
  console.log('[CWS] 开始采集 Chrome 扩展趋势...');

  const extensions = await fetchTrendingExtensions();

  // Score and filter
  const scored = extensions
    .map(ext => ({ ...ext, score: scoreExtension(ext) }))
    .filter(ext => ext.score >= 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  console.log(`[CWS] 获取 ${extensions.length} 条趋势，${scored.length} 条通过评分过滤`);

  let saved = 0;
  for (const ext of scored) {
    const hash = contentHash(ext.name, 'chrome_webstore');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'chrome_webstore')
      .eq('source_id', ext.id)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'chrome_webstore',
      source_id: ext.id,
      source_url: ext.url,
      title: ext.name,
      description: ext.description,
      stars: ext.score,
      comments_count: ext.ratingCount,
      content_hash: hash,
      raw_data: {
        category: ext.category,
        user_count: ext.userCount,
        type: 'chrome_extension_trend',
      },
    });

    if (!error) {
      saved++;
      if (saved <= 5) console.log(`[CWS] 保存: "${ext.name}" (${ext.score}分)`);
    }
  }

  console.log(`[CWS] 完成: ${scored.length} 条采集, ${saved} 条保存`);
  return { scraped: scored.length, saved };
}

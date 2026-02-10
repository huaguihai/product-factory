/**
 * Gumroad Trending Products Scraper
 * Discovers trending digital products to validate what indie makers are selling
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

/**
 * Fetch Gumroad trending via Google autocomplete (Gumroad has no public API)
 */
async function fetchGumroadTrends(): Promise<Array<{ query: string; score: number }>> {
  const seeds = [
    'gumroad best selling', 'gumroad template',
    'gumroad digital product', 'gumroad notion template',
    'gumroad figma', 'gumroad course',
    'gumroad AI prompt', 'gumroad icon pack',
    'gumroad ebook', 'gumroad landing page',
    'gumroad SaaS boilerplate', 'gumroad resume template',
  ];

  const results: Array<{ query: string; seed: string; score: number }> = [];
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
          let score = 10;
          if (norm.includes('best selling') || norm.includes('popular')) score += 20;
          if (norm.includes('template') || norm.includes('kit')) score += 15;
          if (norm.includes('ai') || norm.includes('chatgpt')) score += 15;
          if (norm.includes('free') || norm.includes('$')) score += 10;
          if (norm.includes('notion') || norm.includes('figma') || norm.includes('react')) score += 10;
          results.push({ query: s, seed, score });
        }
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 200));
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 20);
}

export async function scrapeGumroad(): Promise<{ scraped: number; saved: number }> {
  console.log('[Gumroad] 开始采集数字产品趋势...');

  const items = await fetchGumroadTrends();
  console.log(`[Gumroad] 获取 ${items.length} 条趋势`);

  let saved = 0;
  for (const item of items) {
    const sourceId = `gumroad-${contentHash(item.query, 'gumroad')}`;
    const hash = contentHash(item.query, 'gumroad');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'gumroad')
      .eq('source_id', sourceId)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'gumroad',
      source_id: sourceId,
      source_url: `https://gumroad.com/discover?query=${encodeURIComponent(item.query.replace('gumroad ', ''))}`,
      title: item.query,
      description: `数字产品趋势信号，已有人在 Gumroad 变现`,
      stars: item.score,
      comments_count: 0,
      content_hash: hash,
      raw_data: { type: 'gumroad_trend', intent_score: item.score },
    });

    if (!error) {
      saved++;
      if (saved <= 5) console.log(`[Gumroad] 保存: "${item.query}" (${item.score}分)`);
    }
  }

  console.log(`[Gumroad] 完成: ${items.length} 条采集, ${saved} 条保存`);
  return { scraped: items.length, saved };
}

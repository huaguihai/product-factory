/**
 * 36Kr Hot List Scraper (36氪热榜)
 * Chinese tech/startup ecosystem trending news
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

async function fetch36KrHot(): Promise<Array<{ id: string; title: string; url: string; summary: string; heat: number }>> {
  // Try vvhan API
  try {
    const response = await fetch('https://api.vvhan.com/api/hotlist/36Ke', {
      headers: { 'User-Agent': 'ProductFactory/1.0' },
    });
    if (response.ok) {
      const data: any = await response.json();
      if (data.success && Array.isArray(data.data)) {
        return data.data.map((item: any, idx: number) => ({
          id: item.id || `36kr-${idx}`,
          title: item.title || '',
          url: item.url || item.mobilUrl || '',
          summary: item.desc || '',
          heat: parseInt(item.hot || '0', 10) || (50 - idx),
        }));
      }
    }
  } catch { /* try next */ }

  // Fallback: Google suggestions
  const results: Array<{ id: string; title: string; url: string; summary: string; heat: number }> = [];
  const seeds = ['36氪 热门', '36kr 融资', '36氪 AI', '36氪 创业'];

  for (const seed of seeds) {
    try {
      const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(seed)}&hl=zh-CN`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (!response.ok) continue;
      const data = await response.json();
      const suggestions: string[] = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
      for (const s of suggestions) {
        if (s.length > 5) {
          results.push({
            id: `36kr-g-${contentHash(s, '36kr')}`,
            title: s, url: `https://www.google.com/search?q=${encodeURIComponent(s)}`,
            summary: `36氪相关趋势`, heat: 10,
          });
        }
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

export async function scrape36Kr(): Promise<{ scraped: number; saved: number }> {
  console.log('[36Kr] 开始采集...');
  const items = await fetch36KrHot();
  console.log(`[36Kr] 获取 ${items.length} 条`);

  let saved = 0;
  for (const item of items) {
    if (!item.title) continue;
    const sourceId = `36kr-${item.id}`;
    const hash = contentHash(item.title, '36kr');

    const { data: existing } = await supabaseAdmin
      .from('signals').select('id').eq('source', '36kr').eq('source_id', sourceId).maybeSingle();
    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: '36kr', source_id: sourceId, source_url: item.url,
      title: item.title, description: item.summary.slice(0, 500),
      stars: item.heat, comments_count: 0, content_hash: hash,
      raw_data: { heat: item.heat, type: 'chinese_tech_news', market: 'china' },
    });

    if (!error) {
      saved++;
      if (saved <= 5) console.log(`[36Kr] 保存: "${item.title.slice(0, 40)}"`);
    }
  }

  console.log(`[36Kr] 完成: ${items.length} 条采集, ${saved} 条保存`);
  return { scraped: items.length, saved };
}

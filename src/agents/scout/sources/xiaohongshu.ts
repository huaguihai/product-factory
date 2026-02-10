/**
 * Xiaohongshu Trends Scraper (小红书)
 * Consumer trends and product recommendations from China's top lifestyle platform
 * Note: Xiaohongshu has strict anti-scraping, so we use Google suggestions as proxy
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

const SEED_QUERIES = [
  '小红书 推荐 工具', '小红书 效率 神器',
  '小红书 AI 工具', '小红书 副业 赚钱',
  '小红书 模板 推荐', '小红书 教程 干货',
  '小红书 自媒体 变现', '小红书 独立开发',
  '小红书 chrome 插件', '小红书 网站推荐',
  'xiaohongshu trending product', 'xiaohongshu recommendation tool',
];

async function fetchXHSTrends(): Promise<Array<{ query: string; seed: string; score: number }>> {
  const results: Array<{ query: string; seed: string; score: number }> = [];
  const seen = new Set<string>();

  for (const seed of SEED_QUERIES) {
    try {
      const lang = seed.match(/[\u4e00-\u9fff]/) ? 'zh-CN' : 'en';
      const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(seed)}&hl=${lang}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });

      if (!response.ok) continue;
      const data = await response.json();
      const suggestions: string[] = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];

      for (const s of suggestions) {
        const norm = s.toLowerCase().trim();
        if (!seen.has(norm) && s.length > 5) {
          seen.add(norm);
          let score = 10;
          if (norm.includes('推荐') || norm.includes('recommend')) score += 15;
          if (norm.includes('工具') || norm.includes('tool') || norm.includes('神器')) score += 15;
          if (norm.includes('赚钱') || norm.includes('变现') || norm.includes('副业')) score += 20;
          if (norm.includes('ai') || norm.includes('chatgpt')) score += 10;
          if (norm.includes('教程') || norm.includes('干货')) score += 10;
          if (norm.includes('模板') || norm.includes('template')) score += 10;
          results.push({ query: s, seed, score });
        }
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 200));
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 20);
}

export async function scrapeXiaohongshu(): Promise<{ scraped: number; saved: number }> {
  console.log('[小红书] 开始采集趋势...');

  const items = await fetchXHSTrends();
  const filtered = items.filter(i => i.score >= 20);
  console.log(`[小红书] 获取 ${items.length} 条，${filtered.length} 条通过过滤`);

  let saved = 0;
  for (const item of filtered) {
    const sourceId = `xhs-${contentHash(item.query, 'xiaohongshu')}`;
    const hash = contentHash(item.query, 'xiaohongshu');

    const { data: existing } = await supabaseAdmin
      .from('signals').select('id').eq('source', 'xiaohongshu').eq('source_id', sourceId).maybeSingle();
    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'xiaohongshu', source_id: sourceId,
      source_url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(item.query)}`,
      title: item.query,
      description: `小红书种草趋势，种子词: "${item.seed}"`,
      stars: item.score, comments_count: 0, content_hash: hash,
      raw_data: { seed_query: item.seed, intent_score: item.score, type: 'xiaohongshu_trend', market: 'china' },
    });

    if (!error) {
      saved++;
      if (saved <= 5) console.log(`[小红书] 保存: "${item.query}" (${item.score}分)`);
    }
  }

  console.log(`[小红书] 完成: ${filtered.length} 条采集, ${saved} 条保存`);
  return { scraped: filtered.length, saved };
}

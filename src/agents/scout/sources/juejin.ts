/**
 * Juejin Hot List Scraper (掘金热榜)
 * Chinese developer community trending articles and discussions
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

async function fetchJuejinHot(): Promise<Array<{ id: string; title: string; url: string; view: number; like: number; category: string }>> {
  // Try Juejin API
  try {
    const response = await fetch('https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot&limit=30', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({}),
    });

    if (response.ok) {
      const data: any = await response.json();
      if (data.err_no === 0 && Array.isArray(data.data)) {
        return data.data.map((item: any) => ({
          id: `juejin-${item.content?.content_id || item.article_id || ''}`,
          title: item.content?.title || item.title || '',
          url: `https://juejin.cn/post/${item.content?.content_id || item.article_id || ''}`,
          view: item.content_counter?.view || item.view_count || 0,
          like: item.content_counter?.like || item.digg_count || 0,
          category: item.category?.category_name || '',
        }));
      }
    }
  } catch { /* try fallback */ }

  // Fallback: vvhan API
  try {
    const response = await fetch('https://api.vvhan.com/api/hotlist/juejin', {
      headers: { 'User-Agent': 'ProductFactory/1.0' },
    });
    if (response.ok) {
      const data: any = await response.json();
      if (data.success && Array.isArray(data.data)) {
        return data.data.map((item: any, idx: number) => ({
          id: item.id || `juejin-${idx}`,
          title: item.title || '',
          url: item.url || item.mobilUrl || '',
          view: parseInt(item.hot || '0', 10) || 0,
          like: 0,
          category: '',
        }));
      }
    }
  } catch { /* skip */ }

  return [];
}

export async function scrapeJuejin(): Promise<{ scraped: number; saved: number }> {
  console.log('[Juejin] 开始采集掘金热榜...');
  const items = await fetchJuejinHot();

  if (items.length === 0) {
    console.log('[Juejin] 未获取到数据');
    return { scraped: 0, saved: 0 };
  }

  console.log(`[Juejin] 获取 ${items.length} 条热榜文章`);

  let saved = 0;
  for (const item of items) {
    if (!item.title) continue;
    const hash = contentHash(item.title, 'juejin');

    const { data: existing } = await supabaseAdmin
      .from('signals').select('id').eq('source', 'juejin').eq('source_id', item.id).maybeSingle();
    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'juejin', source_id: item.id, source_url: item.url,
      title: item.title, description: `掘金热榜 (阅读: ${item.view}, 点赞: ${item.like})`,
      stars: item.view, comments_count: item.like, content_hash: hash,
      raw_data: { view: item.view, like: item.like, category: item.category, type: 'juejin_hot', market: 'china' },
    });

    if (!error) {
      saved++;
      if (saved <= 5) console.log(`[Juejin] 保存: "${item.title.slice(0, 40)}" (阅读: ${item.view})`);
    }
  }

  console.log(`[Juejin] 完成: ${items.length} 条采集, ${saved} 条保存`);
  return { scraped: items.length, saved };
}

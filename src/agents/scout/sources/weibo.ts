/**
 * Weibo Hot Search Scraper (微博热搜)
 * Mass consumer trends from China's largest social platform
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

async function fetchWeiboHot(): Promise<Array<{ id: string; title: string; url: string; heat: number; category: string }>> {
  // Try vvhan API
  try {
    const response = await fetch('https://api.vvhan.com/api/hotlist/wbHot', {
      headers: { 'User-Agent': 'ProductFactory/1.0' },
    });
    if (response.ok) {
      const data: any = await response.json();
      if (data.success && Array.isArray(data.data)) {
        return data.data.map((item: any, idx: number) => ({
          id: item.id || `wb-${idx}`,
          title: item.title || '',
          url: item.url || item.mobilUrl || `https://s.weibo.com/weibo?q=${encodeURIComponent(item.title || '')}`,
          heat: parseInt(item.hot || '0', 10) || (50 - idx),
          category: item.category || '',
        }));
      }
    }
  } catch { /* try next */ }

  // Fallback: direct Weibo API
  try {
    const response = await fetch('https://weibo.com/ajax/side/hotSearch', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    if (response.ok) {
      const data: any = await response.json();
      const realtime = data.data?.realtime || [];
      return realtime.map((item: any, idx: number) => ({
        id: `wb-${item.mid || idx}`,
        title: item.word || item.note || '',
        url: `https://s.weibo.com/weibo?q=${encodeURIComponent(item.word || '')}`,
        heat: item.num || (50 - idx),
        category: item.category || '',
      }));
    }
  } catch { /* skip */ }

  return [];
}

/**
 * Filter for tech/product/monetizable topics
 */
function isTechOrProduct(title: string): boolean {
  const keywords = [
    'AI', '人工智能', 'ChatGPT', '科技', '互联网', '手机', '应用',
    '软件', '工具', '产品', '创业', '融资', '电商', '直播',
    '小程序', '网站', '短视频', '自媒体', '变现', '副业',
    '数码', '效率', '测评', '对比', '推荐', '教程',
    'iPhone', 'Apple', '华为', '小米', 'OpenAI', '百度',
    '抖音', '微信', '淘宝', '拼多多', 'B站',
  ];
  return keywords.some(kw => title.includes(kw));
}

export async function scrapeWeibo(): Promise<{ scraped: number; saved: number }> {
  console.log('[Weibo] 开始采集微博热搜...');
  const items = await fetchWeiboHot();

  if (items.length === 0) {
    console.log('[Weibo] 未获取到数据');
    return { scraped: 0, saved: 0 };
  }

  const techItems = items.filter(item => isTechOrProduct(item.title));
  console.log(`[Weibo] 获取 ${items.length} 条热搜，${techItems.length} 条与科技/产品相关`);

  let saved = 0;
  for (const item of techItems) {
    const sourceId = `weibo-${item.id}`;
    const hash = contentHash(item.title, 'weibo');

    const { data: existing } = await supabaseAdmin
      .from('signals').select('id').eq('source', 'weibo').eq('source_id', sourceId).maybeSingle();
    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'weibo', source_id: sourceId, source_url: item.url,
      title: item.title, description: `微博热搜 (热度: ${item.heat})`,
      stars: item.heat, comments_count: 0, content_hash: hash,
      raw_data: { heat: item.heat, category: item.category, type: 'weibo_hot', market: 'china' },
    });

    if (!error) {
      saved++;
      console.log(`[Weibo] 保存: "${item.title}" (热度: ${item.heat})`);
    }
  }

  console.log(`[Weibo] 完成: ${techItems.length} 条采集, ${saved} 条保存`);
  return { scraped: techItems.length, saved };
}

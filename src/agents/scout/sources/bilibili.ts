/**
 * Bilibili Hot List Scraper (B站热门)
 * Gen-Z content trends from China's top video platform
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

async function fetchBilibiliHot(): Promise<Array<{ id: string; title: string; url: string; view: number; like: number; author: string }>> {
  // Try Bilibili popular API
  try {
    const response = await fetch('https://api.bilibili.com/x/web-interface/popular?ps=50&pn=1', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.bilibili.com',
      },
    });
    if (response.ok) {
      const data: any = await response.json();
      if (data.code === 0 && Array.isArray(data.data?.list)) {
        return data.data.list.map((item: any) => ({
          id: `bili-${item.bvid || item.aid}`,
          title: item.title || '',
          url: `https://www.bilibili.com/video/${item.bvid}`,
          view: item.stat?.view || 0,
          like: item.stat?.like || 0,
          author: item.owner?.name || '',
        }));
      }
    }
  } catch { /* try fallback */ }

  // Try vvhan API
  try {
    const response = await fetch('https://api.vvhan.com/api/hotlist/bilibili', {
      headers: { 'User-Agent': 'ProductFactory/1.0' },
    });
    if (response.ok) {
      const data: any = await response.json();
      if (data.success && Array.isArray(data.data)) {
        return data.data.map((item: any, idx: number) => ({
          id: item.id || `bili-${idx}`,
          title: item.title || '',
          url: item.url || item.mobilUrl || '',
          view: parseInt(item.hot || '0', 10) || 0,
          like: 0,
          author: '',
        }));
      }
    }
  } catch { /* skip */ }

  return [];
}

function isTechContent(title: string): boolean {
  const keywords = [
    'AI', '人工智能', 'ChatGPT', '编程', '代码', '开发', '教程',
    '工具', '软件', '效率', '科技', '测评', '对比', '推荐',
    '干货', '模板', '自动化', '副业', '赚钱', '创业',
    'Python', 'JavaScript', 'Mac', 'Windows', 'Chrome',
    '插件', '扩展', '网站', '小程序', 'SEO', '独立开发',
  ];
  return keywords.some(kw => title.includes(kw));
}

export async function scrapeBilibili(): Promise<{ scraped: number; saved: number }> {
  console.log('[Bilibili] 开始采集B站热门...');
  const items = await fetchBilibiliHot();

  if (items.length === 0) {
    console.log('[Bilibili] 未获取到数据');
    return { scraped: 0, saved: 0 };
  }

  const techItems = items.filter(item => isTechContent(item.title));
  console.log(`[Bilibili] 获取 ${items.length} 条热门，${techItems.length} 条科技/教程相关`);

  let saved = 0;
  for (const item of techItems) {
    const hash = contentHash(item.title, 'bilibili');

    const { data: existing } = await supabaseAdmin
      .from('signals').select('id').eq('source', 'bilibili').eq('source_id', item.id).maybeSingle();
    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'bilibili', source_id: item.id, source_url: item.url,
      title: item.title, description: `B站热门视频 (播放: ${item.view}, 点赞: ${item.like})`,
      stars: item.view, comments_count: item.like, content_hash: hash,
      raw_data: { view: item.view, like: item.like, author: item.author, type: 'bilibili_hot', market: 'china' },
    });

    if (!error) {
      saved++;
      console.log(`[Bilibili] 保存: "${item.title.slice(0, 40)}" (播放: ${item.view})`);
    }
  }

  console.log(`[Bilibili] 完成: ${techItems.length} 条采集, ${saved} 条保存`);
  return { scraped: techItems.length, saved };
}

/**
 * Zhihu Hot List Scraper (知乎热榜)
 * Uses public API to get trending topics from China's top Q&A platform
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

interface ZhihuItem {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  heat: number;
  answerCount: number;
  type: string;
}

/**
 * Fetch Zhihu hot list via public API
 */
async function fetchZhihuHot(): Promise<ZhihuItem[]> {
  const apis = [
    'https://api.vvhan.com/api/hotlist/zhihuHot',
    'https://api.vvhan.com/api/hotlist/zhihu',
  ];

  for (const apiUrl of apis) {
    try {
      const response = await fetch(apiUrl, {
        headers: { 'User-Agent': 'ProductFactory/1.0' },
      });

      if (!response.ok) continue;
      const data: any = await response.json();

      if (data.success === true && Array.isArray(data.data)) {
        return data.data.map((item: any, idx: number) => ({
          id: item.id || item.url || `zhihu-${idx}`,
          title: item.title || '',
          url: item.url || item.mobilUrl || '',
          excerpt: item.desc || item.excerpt || '',
          heat: parseInt(item.hot || item.heat || '0', 10) || (50 - idx),
          answerCount: parseInt(item.answerCount || '0', 10),
          type: item.type || 'question',
        }));
      }
    } catch {
      continue;
    }
  }

  // Fallback: direct Zhihu API
  try {
    const response = await fetch('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) return [];
    const data: any = await response.json();

    return (data.data || []).map((item: any) => ({
      id: item.target?.id?.toString() || item.id?.toString() || '',
      title: item.target?.title || '',
      url: item.target?.url || `https://www.zhihu.com/question/${item.target?.id}`,
      excerpt: item.target?.excerpt || '',
      heat: Math.round((item.detail_text || '0').replace(/[^\d]/g, '') / 10000) || 0,
      answerCount: item.target?.answer_count || 0,
      type: 'question',
    }));
  } catch {
    return [];
  }
}

/**
 * Check if a Zhihu topic has tech/product relevance
 */
function isTechRelevant(title: string): boolean {
  const keywords = [
    'AI', '人工智能', 'ChatGPT', '编程', '软件', '工具', '技术', '开发',
    '互联网', '产品', 'App', '小程序', '网站', '自媒体', '赚钱', '副业',
    '创业', 'SEO', '流量', '变现', '独立开发', '开源', 'GitHub',
    '效率', '模板', '教程', '指南', '推荐', '对比', '替代',
    '浏览器', '插件', '扩展', 'Chrome', 'Python', 'JavaScript',
  ];
  const lower = title.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

export async function scrapeZhihu(): Promise<{ scraped: number; saved: number }> {
  console.log('[Zhihu] 开始采集知乎热榜...');

  const items = await fetchZhihuHot();

  if (items.length === 0) {
    console.log('[Zhihu] 未获取到数据');
    return { scraped: 0, saved: 0 };
  }

  // Filter for tech-relevant topics
  const techItems = items.filter(item => isTechRelevant(item.title));
  console.log(`[Zhihu] 获取 ${items.length} 条热榜，${techItems.length} 条与科技/产品相关`);

  let saved = 0;
  for (const item of techItems) {
    const sourceId = `zhihu-${item.id}`;
    const hash = contentHash(item.title, 'zhihu');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'zhihu')
      .eq('source_id', sourceId)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'zhihu',
      source_id: sourceId,
      source_url: item.url,
      title: item.title,
      description: item.excerpt.slice(0, 500),
      stars: item.heat,
      comments_count: item.answerCount,
      content_hash: hash,
      raw_data: {
        heat: item.heat,
        answer_count: item.answerCount,
        type: item.type,
        market: 'china',
      },
    });

    if (!error) {
      saved++;
      console.log(`[Zhihu] 保存: "${item.title.slice(0, 40)}" (热度: ${item.heat})`);
    }
  }

  console.log(`[Zhihu] 完成: ${techItems.length} 条采集, ${saved} 条保存`);
  return { scraped: techItems.length, saved };
}

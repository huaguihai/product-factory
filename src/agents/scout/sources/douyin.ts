/**
 * Douyin Hot Search Scraper (抖音热搜)
 * Mass consumer trends from China's largest short video platform (700M+ DAU)
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

interface DouyinHotItem {
  id: string;
  title: string;
  url: string;
  heat: number;
  label: string;
}

async function fetchDouyinHot(): Promise<DouyinHotItem[]> {
  // Method 1: Try vvhan API
  try {
    const response = await fetch('https://api.vvhan.com/api/hotlist/douyinHot', {
      headers: { 'User-Agent': 'ProductFactory/1.0' },
    });
    if (response.ok) {
      const data: any = await response.json();
      if (data.success && Array.isArray(data.data)) {
        return data.data.map((item: any, idx: number) => ({
          id: item.id || `dy-${idx}`,
          title: item.title || '',
          url: item.url || item.mobilUrl || `https://www.douyin.com/search/${encodeURIComponent(item.title || '')}`,
          heat: parseInt(item.hot || '0', 10) || (50 - idx),
          label: item.label || '',
        }));
      }
    }
  } catch { /* try next */ }

  // Method 2: Try Douyin official trending page API
  try {
    const response = await fetch('https://www.douyin.com/aweme/v1/web/hot/search/list/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.douyin.com/',
        'Accept': 'application/json',
      },
    });
    if (response.ok) {
      const data: any = await response.json();
      const list = data.data?.word_list || data.word_list || [];
      if (Array.isArray(list) && list.length > 0) {
        return list.map((item: any, idx: number) => ({
          id: `dy-${item.sentence_id || idx}`,
          title: item.word || '',
          url: `https://www.douyin.com/search/${encodeURIComponent(item.word || '')}`,
          heat: item.hot_value || (50 - idx),
          label: item.label?.toString() || '',
        }));
      }
    }
  } catch { /* try next */ }

  // Method 3: Try tophub / other aggregator
  try {
    const response = await fetch('https://api.vvhan.com/api/hotlist/douyinHot', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (response.ok) {
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data.data)) {
          return data.data.map((item: any, idx: number) => ({
            id: `dy-${idx}`,
            title: item.title || item.name || '',
            url: item.url || `https://www.douyin.com/search/${encodeURIComponent(item.title || '')}`,
            heat: parseInt(item.hot || '0', 10) || (50 - idx),
            label: '',
          }));
        }
      } catch { /* skip */ }
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
    '机器人', '芯片', '算法', '大模型', '智能', '自动',
    '新能源', '电动', '充电', '无人', '虚拟', '元宇宙',
    'App', 'app', '游戏', '支付', '理财', '数字',
  ];
  return keywords.some(kw => title.includes(kw));
}

export async function scrapeDouyin(): Promise<{ scraped: number; saved: number }> {
  console.log('[Douyin] 开始采集抖音热搜...');
  const items = await fetchDouyinHot();

  if (items.length === 0) {
    console.log('[Douyin] 未获取到数据');
    return { scraped: 0, saved: 0 };
  }

  const techItems = items.filter(item => isTechOrProduct(item.title));
  console.log(`[Douyin] 获取 ${items.length} 条热搜，${techItems.length} 条与科技/产品相关`);

  let saved = 0;
  for (const item of techItems) {
    const sourceId = `douyin-${item.id}`;
    const hash = contentHash(item.title, 'douyin');

    const { data: existing } = await supabaseAdmin
      .from('signals').select('id').eq('source', 'douyin').eq('source_id', sourceId).maybeSingle();
    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'douyin', source_id: sourceId, source_url: item.url,
      title: item.title, description: `抖音热搜 (热度: ${item.heat})`,
      stars: item.heat, comments_count: 0, content_hash: hash,
      raw_data: { heat: item.heat, label: item.label, type: 'douyin_hot', market: 'china' },
    });

    if (!error) {
      saved++;
      console.log(`[Douyin] 保存: "${item.title}" (热度: ${item.heat})`);
    }
  }

  console.log(`[Douyin] 完成: ${techItems.length} 条采集, ${saved} 条保存`);
  return { scraped: techItems.length, saved };
}

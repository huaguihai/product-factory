/**
 * V2EX Hot Topics Scraper
 * Developer & tech enthusiast community — high signal quality for tool/product needs
 * Public API: https://www.v2ex.com/api/topics/hot.json (no auth required)
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

interface V2exTopic {
  id: number;
  title: string;
  url: string;
  content: string;
  replies: number;
  node: { name: string; title: string };
  member: { username: string };
  created: number;
}

async function fetchV2exHot(): Promise<V2exTopic[]> {
  // Method 1: Official V2EX API (no auth needed)
  try {
    const response = await fetch('https://www.v2ex.com/api/topics/hot.json', {
      headers: {
        'User-Agent': 'ProductFactory/1.0 (https://github.com/huaguihai/product-factory)',
      },
    });
    if (response.ok) {
      const data: any = await response.json();
      if (Array.isArray(data)) {
        return data.map((item: any) => ({
          id: item.id,
          title: item.title || '',
          url: item.url || `https://www.v2ex.com/t/${item.id}`,
          content: item.content || item.content_rendered || '',
          replies: item.replies || 0,
          node: { name: item.node?.name || '', title: item.node?.title || '' },
          member: { username: item.member?.username || '' },
          created: item.created || 0,
        }));
      }
    }
  } catch { /* try fallback */ }

  // Method 2: Try latest topics
  try {
    const response = await fetch('https://www.v2ex.com/api/topics/latest.json', {
      headers: { 'User-Agent': 'ProductFactory/1.0' },
    });
    if (response.ok) {
      const data: any = await response.json();
      if (Array.isArray(data)) {
        // Sort by replies to get most discussed
        return data
          .sort((a: any, b: any) => (b.replies || 0) - (a.replies || 0))
          .slice(0, 30)
          .map((item: any) => ({
            id: item.id,
            title: item.title || '',
            url: item.url || `https://www.v2ex.com/t/${item.id}`,
            content: item.content || '',
            replies: item.replies || 0,
            node: { name: item.node?.name || '', title: item.node?.title || '' },
            member: { username: item.member?.username || '' },
            created: item.created || 0,
          }));
      }
    }
  } catch { /* skip */ }

  return [];
}

/**
 * Relevant V2EX nodes for product/tool discovery
 */
const RELEVANT_NODES = new Set([
  'create', 'programmer', 'apple', 'chrome', 'google', 'ai',
  'macos', 'windows', 'linux', 'python', 'nodejs', 'share',
  'internet', 'career', 'blockchain', 'bitcoin', 'cloud',
  'design', 'hardware', 'android', 'iphone', 'ipad',
  'firefox', 'edge', 'vscode', 'github', 'git',
  'openai', 'gpt', 'llm', 'devops', 'mysql', 'redis',
  'free', 'promotions', 'qna', 'ideas', 'review',
  'app', 'miniprogram', 'wechat', 'tools',
]);

/**
 * Filter for product-relevant topics
 */
function isProductRelevant(topic: V2exTopic): boolean {
  // Always include relevant nodes
  if (RELEVANT_NODES.has(topic.node.name)) return true;

  // Keyword-based fallback
  const text = (topic.title + ' ' + topic.content).toLowerCase();
  const keywords = [
    'ai', '工具', '推荐', '开发', '产品', '独立开发', '副业',
    '赚钱', '变现', '创业', '效率', '自动化', '模板', '教程',
    '对比', '测评', '替代', 'alternative', 'saas', '小程序',
    '开源', 'open source', 'chrome', '插件', '扩展',
    '分享', '上线', '发布', 'launch', 'show', 'side project',
    '需求', '痛点', '解决', '方案',
  ];
  return keywords.some(kw => text.includes(kw));
}

export async function scrapeV2ex(): Promise<{ scraped: number; saved: number }> {
  console.log('[V2EX] 开始采集V2EX热门话题...');
  const topics = await fetchV2exHot();

  if (topics.length === 0) {
    console.log('[V2EX] 未获取到数据');
    return { scraped: 0, saved: 0 };
  }

  const relevant = topics.filter(isProductRelevant);
  console.log(`[V2EX] 获取 ${topics.length} 条话题，${relevant.length} 条与产品/工具相关`);

  let saved = 0;
  for (const topic of relevant) {
    const sourceId = `v2ex-${topic.id}`;
    const hash = contentHash(topic.title, 'v2ex');

    const { data: existing } = await supabaseAdmin
      .from('signals').select('id').eq('source', 'v2ex').eq('source_id', sourceId).maybeSingle();
    if (existing) continue;

    const description = topic.content
      ? topic.content.replace(/<[^>]*>/g, '').substring(0, 300)
      : `V2EX 热门话题 [${topic.node.title || topic.node.name}] (${topic.replies} 回复)`;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'v2ex', source_id: sourceId, source_url: topic.url,
      title: topic.title, description,
      stars: topic.replies, comments_count: topic.replies, content_hash: hash,
      raw_data: {
        replies: topic.replies,
        node: topic.node.name,
        node_title: topic.node.title,
        author: topic.member.username,
        type: 'v2ex_hot',
        market: 'china',
      },
    });

    if (!error) {
      saved++;
      console.log(`[V2EX] 保存: "${topic.title.slice(0, 50)}" [${topic.node.title || topic.node.name}] (${topic.replies} 回复)`);
    }
  }

  console.log(`[V2EX] 完成: ${relevant.length} 条采集, ${saved} 条保存`);
  return { scraped: relevant.length, saved };
}

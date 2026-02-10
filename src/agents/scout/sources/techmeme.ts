/**
 * Techmeme RSS Scraper
 * Algorithmically curated tech news with extremely high signal-to-noise ratio
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

interface TechmemeItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

/**
 * Fetch Techmeme RSS feed
 */
async function fetchTechmemeFeed(): Promise<TechmemeItem[]> {
  try {
    const response = await fetch('https://www.techmeme.com/feed.xml', {
      headers: { 'User-Agent': 'ProductFactory/1.0' },
    });

    if (!response.ok) {
      console.error(`[Techmeme] RSS 请求失败: ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const items: TechmemeItem[] = [];

    // Simple XML parsing for RSS items
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

    for (const itemXml of itemMatches) {
      const title = (itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                     itemXml.match(/<title>(.*?)<\/title>/) || [])[1] || '';
      const link = (itemXml.match(/<link>(.*?)<\/link>/) || [])[1] || '';
      const pubDate = (itemXml.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
      const description = (itemXml.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                          itemXml.match(/<description>(.*?)<\/description>/) || [])[1] || '';

      if (title && link) {
        items.push({ title: title.trim(), link: link.trim(), pubDate, description: description.slice(0, 500) });
      }
    }

    return items;
  } catch (error) {
    console.error('[Techmeme] 获取失败:', error);
    return [];
  }
}

/**
 * Check if item is recent (within last 3 days)
 */
function isRecent(pubDate: string): boolean {
  try {
    const date = new Date(pubDate);
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return date.getTime() > threeDaysAgo;
  } catch {
    return true; // If can't parse, include it
  }
}

export async function scrapeTechmeme(): Promise<{ scraped: number; saved: number }> {
  console.log('[Techmeme] 开始采集...');

  const items = await fetchTechmemeFeed();
  const recent = items.filter(item => isRecent(item.pubDate));

  console.log(`[Techmeme] 获取 ${items.length} 条，${recent.length} 条为近3天内`);

  let saved = 0;
  for (const item of recent) {
    const sourceId = `tm-${contentHash(item.link, 'techmeme')}`;
    const hash = contentHash(item.title, 'techmeme');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'techmeme')
      .eq('source_id', sourceId)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'techmeme',
      source_id: sourceId,
      source_url: item.link,
      title: item.title,
      description: item.description,
      stars: 0,
      comments_count: 0,
      source_created_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
      content_hash: hash,
      raw_data: { type: 'curated_tech_news', source_feed: 'techmeme' },
    });

    if (!error) {
      saved++;
      if (saved <= 5) console.log(`[Techmeme] 保存: "${item.title.slice(0, 60)}"`);
    }
  }

  console.log(`[Techmeme] 完成: ${recent.length} 条采集, ${saved} 条保存`);
  return { scraped: recent.length, saved };
}

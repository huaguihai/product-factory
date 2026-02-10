/**
 * BestBlogs.dev Scraper
 * AI-scored content from 400+ sources, pre-filtered for quality
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

interface BestBlogsItem {
  title: string;
  url: string;
  source: string;
  score: number;
  summary: string;
  publishedAt: string;
}

/**
 * Fetch from BestBlogs.dev RSS/API
 */
async function fetchBestBlogs(): Promise<BestBlogsItem[]> {
  // Try RSS feed first
  const feedUrls = [
    'https://www.bestblogs.dev/feeds/posts.xml',
    'https://www.bestblogs.dev/api/posts?limit=30',
  ];

  for (const feedUrl of feedUrls) {
    try {
      const response = await fetch(feedUrl, {
        headers: {
          'User-Agent': 'ProductFactory/1.0',
          'Accept': 'application/xml, application/json, text/xml',
        },
      });

      if (!response.ok) continue;
      const text = await response.text();

      // Try XML/RSS parsing
      if (text.includes('<item>') || text.includes('<entry>')) {
        const items: BestBlogsItem[] = [];
        const entryPattern = text.includes('<entry>')
          ? /<entry>([\s\S]*?)<\/entry>/g
          : /<item>([\s\S]*?)<\/item>/g;
        const matches = text.match(entryPattern) || [];

        for (const entry of matches.slice(0, 30)) {
          const title = (entry.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                        entry.match(/<title>(.*?)<\/title>/) || [])[1] || '';
          const link = (entry.match(/<link href="(.*?)"/) ||
                       entry.match(/<link>(.*?)<\/link>/) || [])[1] || '';
          const summary = (entry.match(/<summary><!\[CDATA\[(.*?)\]\]><\/summary>/) ||
                          entry.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                          entry.match(/<description>(.*?)<\/description>/) || [])[1] || '';
          const pubDate = (entry.match(/<pubDate>(.*?)<\/pubDate>/) ||
                          entry.match(/<published>(.*?)<\/published>/) || [])[1] || '';

          if (title && link) {
            items.push({
              title: title.trim(),
              url: link.trim(),
              source: 'bestblogs',
              score: 0,
              summary: summary.replace(/<[^>]+>/g, '').slice(0, 300),
              publishedAt: pubDate,
            });
          }
        }
        if (items.length > 0) return items;
      }

      // Try JSON parsing
      try {
        const json = JSON.parse(text);
        const posts = Array.isArray(json) ? json : json.data || json.posts || [];
        return posts.slice(0, 30).map((p: any) => ({
          title: p.title || '',
          url: p.url || p.link || '',
          source: p.source || 'bestblogs',
          score: p.score || p.ai_score || 0,
          summary: p.summary || p.description || '',
          publishedAt: p.publishedAt || p.published_at || '',
        }));
      } catch { /* not JSON */ }
    } catch {
      continue;
    }
  }

  console.log('[BestBlogs] RSS/API 均不可用，使用搜索建议降级方案');
  // Fallback: Google suggestions about bestblogs topics
  const results: BestBlogsItem[] = [];
  const seeds = ['best tech blog post 2026', 'viral programming article', 'trending developer blog'];

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
        if (s.length > 10) {
          results.push({
            title: s,
            url: `https://www.google.com/search?q=${encodeURIComponent(s)}`,
            source: 'google_suggest',
            score: 0,
            summary: `科技博客趋势: "${seed}"`,
            publishedAt: '',
          });
        }
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 200));
  }

  return results;
}

export async function scrapeBestBlogs(): Promise<{ scraped: number; saved: number }> {
  console.log('[BestBlogs] 开始采集高质量博客...');

  const items = await fetchBestBlogs();
  console.log(`[BestBlogs] 获取 ${items.length} 条内容`);

  let saved = 0;
  for (const item of items) {
    if (!item.title) continue;
    const sourceId = `bb-${contentHash(item.url || item.title, 'bestblogs')}`;
    const hash = contentHash(item.title, 'bestblogs');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'bestblogs')
      .eq('source_id', sourceId)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'bestblogs',
      source_id: sourceId,
      source_url: item.url,
      title: item.title,
      description: item.summary,
      stars: item.score,
      comments_count: 0,
      source_created_at: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
      content_hash: hash,
      raw_data: { original_source: item.source, ai_score: item.score, type: 'curated_blog' },
    });

    if (!error) {
      saved++;
      if (saved <= 5) console.log(`[BestBlogs] 保存: "${item.title.slice(0, 50)}"`);
    }
  }

  console.log(`[BestBlogs] 完成: ${items.length} 条采集, ${saved} 条保存`);
  return { scraped: items.length, saved };
}

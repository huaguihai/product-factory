/**
 * Exploding Topics Scraper
 * Discovers rapidly growing search trends via Google suggestions about trending topics
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

/**
 * Use Google suggestions to find exploding/trending topics
 */
async function fetchExplodingTopics(): Promise<Array<{ topic: string; score: number; category: string }>> {
  // Categories mapped to high-value seed queries
  const categorySeeds: Record<string, string[]> = {
    'ai_tools': [
      'trending AI tool 2026', 'new AI app everyone using',
      'viral AI tool', 'AI tool alternative to',
    ],
    'saas': [
      'trending saas 2026', 'fastest growing saas',
      'new saas tool', 'micro saas ideas',
    ],
    'dev_tools': [
      'trending developer tool 2026', 'new coding tool',
      'github trending project', 'dev tool everyone using',
    ],
    'digital_products': [
      'trending digital product 2026', 'best selling online course topic',
      'viral template', 'trending notion template',
    ],
    'consumer': [
      'trending app 2026', 'new app everyone downloading',
      'viral chrome extension', 'trending browser tool',
    ],
  };

  const results: Array<{ topic: string; score: number; category: string; seed: string }> = [];
  const seen = new Set<string>();

  for (const [category, seeds] of Object.entries(categorySeeds)) {
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
          const norm = s.toLowerCase().trim();
          if (!seen.has(norm) && s.length > 10) {
            seen.add(norm);
            let score = 15;
            if (norm.includes('trending') || norm.includes('viral')) score += 15;
            if (norm.includes('2026') || norm.includes('new')) score += 10;
            if (norm.includes('everyone') || norm.includes('fastest')) score += 15;
            if (norm.includes('alternative') || norm.includes('best')) score += 10;
            results.push({ topic: s, score, category, seed });
          }
        }
      } catch { /* skip */ }
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 25);
}

export async function scrapeExplodingTopics(): Promise<{ scraped: number; saved: number }> {
  console.log('[ExplodingTopics] 开始采集增长趋势...');

  const items = await fetchExplodingTopics();
  console.log(`[ExplodingTopics] 获取 ${items.length} 条趋势`);

  let saved = 0;
  for (const item of items) {
    const sourceId = `et-${contentHash(item.topic, 'exploding_topics')}`;
    const hash = contentHash(item.topic, 'exploding_topics');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'exploding_topics')
      .eq('source_id', sourceId)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'exploding_topics',
      source_id: sourceId,
      source_url: `https://www.google.com/search?q=${encodeURIComponent(item.topic)}`,
      title: item.topic,
      description: `增长趋势信号 [${item.category}]`,
      stars: item.score,
      comments_count: 0,
      content_hash: hash,
      raw_data: { category: item.category, type: 'trend_signal', intent_score: item.score },
    });

    if (!error) {
      saved++;
      if (saved <= 5) console.log(`[ExplodingTopics] 保存: "${item.topic}" (${item.score}分)`);
    }
  }

  console.log(`[ExplodingTopics] 完成: ${items.length} 条采集, ${saved} 条保存`);
  return { scraped: items.length, saved };
}

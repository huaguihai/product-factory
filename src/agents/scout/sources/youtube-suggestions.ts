/**
 * YouTube Search Suggestions Scraper
 * Uses YouTube suggest API (free, no key required) to find trending search queries
 * related to tech, AI tools, and product opportunities
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

interface YTSuggestion {
  query: string;
  seed: string;
}

const SEED_QUERIES = [
  'how to use', 'best alternative to', 'tutorial for',
  'vs comparison', 'free tool for', 'AI tool',
  'chrome extension', 'workflow automation',
  'make money with', 'side project', 'no code',
  'chatgpt prompt', 'midjourney', 'cursor ide',
];

/**
 * Get YouTube autocomplete suggestions for a seed query
 */
async function getYTSuggestions(seed: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(seed)}&hl=en`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    if (!response.ok) return [];

    const text = await response.text();
    // Response is JSONP: window.google.ac.h([...])
    const match = text.match(/\[.*\]/s);
    if (!match) return [];

    const data = JSON.parse(match[0]);
    if (!Array.isArray(data) || data.length < 2) return [];

    // data[1] is array of [suggestion, ?, ?, ?]
    return (data[1] || [])
      .map((item: any) => (Array.isArray(item) ? item[0] : item))
      .filter((s: any) => typeof s === 'string' && s.length > 5);
  } catch (error) {
    return [];
  }
}

/**
 * Score a suggestion's potential based on specificity and intent
 */
function scoreSuggestion(query: string): number {
  let score = 0;
  const q = query.toLowerCase();

  // Transactional intent signals
  if (q.includes('best') || q.includes('top')) score += 20;
  if (q.includes('alternative') || q.includes('vs')) score += 25;
  if (q.includes('how to') || q.includes('tutorial')) score += 15;
  if (q.includes('free') || q.includes('cheap')) score += 10;
  if (q.includes('review') || q.includes('comparison')) score += 20;

  // Tech/product signals
  if (q.includes('ai') || q.includes('chatgpt') || q.includes('tool')) score += 10;
  if (q.includes('extension') || q.includes('plugin') || q.includes('app')) score += 15;
  if (q.includes('2025') || q.includes('2026')) score += 10;

  // Length bonus (more specific = better)
  if (q.split(' ').length >= 4) score += 10;
  if (q.split(' ').length >= 6) score += 5;

  return score;
}

export async function scrapeYouTubeSuggestions(): Promise<{ scraped: number; saved: number }> {
  console.log('[YouTube] 开始采集搜索建议...');

  const allSuggestions: YTSuggestion[] = [];
  const seen = new Set<string>();

  for (const seed of SEED_QUERIES) {
    const suggestions = await getYTSuggestions(seed);
    for (const query of suggestions) {
      const normalized = query.toLowerCase().trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        allSuggestions.push({ query, seed });
      }
    }
    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  // Score and filter
  const scored = allSuggestions
    .map(s => ({ ...s, score: scoreSuggestion(s.query) }))
    .filter(s => s.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);

  console.log(`[YouTube] 获取 ${allSuggestions.length} 条建议，${scored.length} 条通过评分过滤`);

  let saved = 0;
  for (const item of scored) {
    const sourceId = `yt-suggest-${contentHash(item.query, 'youtube')}`;
    const hash = contentHash(item.query, 'youtube_suggestions');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'youtube_suggestions')
      .eq('source_id', sourceId)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'youtube_suggestions',
      source_id: sourceId,
      source_url: `https://www.youtube.com/results?search_query=${encodeURIComponent(item.query)}`,
      title: item.query,
      description: `YouTube 搜索建议，来源种子词: "${item.seed}"`,
      stars: item.score,
      comments_count: 0,
      content_hash: hash,
      raw_data: {
        seed_query: item.seed,
        intent_score: item.score,
        type: 'youtube_autocomplete',
      },
    });

    if (!error) {
      saved++;
      if (saved <= 5) console.log(`[YouTube] 保存: "${item.query}" (${item.score}分)`);
    }
  }

  console.log(`[YouTube] 完成: ${scored.length} 条采集, ${saved} 条保存`);
  return { scraped: scored.length, saved };
}

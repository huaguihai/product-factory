/**
 * Quora Trending Questions Scraper
 * Finds trending questions on Quora via Google autocomplete as proxy
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

const SEED_QUERIES = [
  'quora best', 'quora how to make money',
  'quora AI tools', 'quora chrome extension',
  'quora side hustle', 'quora no code',
  'quora passive income', 'quora chatgpt',
  'quora freelance', 'quora SEO tips',
  'quora productivity app', 'quora web development',
  'quora startup idea', 'quora digital marketing',
];

/**
 * Get Google autocomplete suggestions for Quora-related queries
 */
async function fetchQuoraTrends(): Promise<Array<{ question: string; seed: string; score: number }>> {
  const results: Array<{ question: string; seed: string; score: number }> = [];
  const seen = new Set<string>();

  for (const seed of SEED_QUERIES) {
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
        if (!seen.has(norm) && s.length > 15) {
          seen.add(norm);
          let score = 10;
          const lower = norm;
          if (lower.includes('best') || lower.includes('top') || lower.includes('recommend')) score += 15;
          if (lower.includes('money') || lower.includes('earn') || lower.includes('income')) score += 20;
          if (lower.includes('tool') || lower.includes('app') || lower.includes('software')) score += 15;
          if (lower.includes('alternative') || lower.includes('vs')) score += 20;
          if (lower.includes('how to') || lower.includes('what is')) score += 10;
          if (lower.includes('ai') || lower.includes('chatgpt')) score += 10;
          results.push({ question: s, seed, score });
        }
      }
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 200));
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 25);
}

export async function scrapeQuora(): Promise<{ scraped: number; saved: number }> {
  console.log('[Quora] 开始采集热门问题...');

  const items = await fetchQuoraTrends();
  const filtered = items.filter(i => i.score >= 20);
  console.log(`[Quora] 获取 ${items.length} 条，${filtered.length} 条通过过滤`);

  let saved = 0;
  for (const item of filtered) {
    const sourceId = `quora-${contentHash(item.question, 'quora')}`;
    const hash = contentHash(item.question, 'quora');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'quora')
      .eq('source_id', sourceId)
      .maybeSingle();

    if (existing) continue;

    const cleanQuestion = item.question.replace(/^quora\s+/i, '').trim();

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'quora',
      source_id: sourceId,
      source_url: `https://www.quora.com/search?q=${encodeURIComponent(cleanQuestion)}`,
      title: cleanQuestion,
      description: `Quora 用户热门问题，种子词: "${item.seed}"`,
      stars: item.score,
      comments_count: 0,
      content_hash: hash,
      raw_data: { seed_query: item.seed, intent_score: item.score, type: 'quora_question' },
    });

    if (!error) {
      saved++;
      if (saved <= 5) console.log(`[Quora] 保存: "${cleanQuestion.slice(0, 50)}" (${item.score}分)`);
    }
  }

  console.log(`[Quora] 完成: ${filtered.length} 条采集, ${saved} 条保存`);
  return { scraped: filtered.length, saved };
}

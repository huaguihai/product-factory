/**
 * Google People Also Ask Scraper
 * Extracts PAA questions from Google search results to discover user pain points
 */

import { supabaseAdmin } from '../../../db/supabase';
import { contentHash } from '../../../utils/helpers';

const SEED_QUERIES = [
  'best AI tools 2026', 'chatgpt alternatives free',
  'how to make money online', 'chrome extensions productivity',
  'no code app builder', 'AI image generator comparison',
  'workflow automation tools', 'free website builder seo',
  'side hustle ideas tech', 'browser extension tutorial',
  'wechat mini program development', 'google adsense approval tips',
];

/**
 * Get Google autocomplete suggestions as a proxy for PAA
 * (True PAA requires SERP parsing; autocomplete is free and reliable)
 */
async function getGoogleSuggestions(query: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}&hl=en`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    if (!response.ok) return [];

    const data = await response.json();
    // Firefox format: ["query", ["suggestion1", "suggestion2", ...]]
    return Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
  } catch {
    return [];
  }
}

/**
 * Expand queries with question modifiers to find pain points
 */
function expandToQuestions(base: string): string[] {
  const modifiers = ['how to', 'why', 'what is', 'best way to', 'can I', 'how do I'];
  const words = base.split(' ').slice(0, 3).join(' ');
  return modifiers.map(m => `${m} ${words}`);
}

/**
 * Score a question's monetization potential
 */
function scoreQuestion(q: string): number {
  let score = 0;
  const lower = q.toLowerCase();

  // High-value intent
  if (lower.includes('best') || lower.includes('top') || lower.includes('recommend')) score += 20;
  if (lower.includes('alternative') || lower.includes('instead of') || lower.includes('vs')) score += 25;
  if (lower.includes('tool') || lower.includes('app') || lower.includes('software')) score += 15;
  if (lower.includes('free') || lower.includes('cheap') || lower.includes('affordable')) score += 10;
  if (lower.includes('how to make') || lower.includes('how to earn') || lower.includes('monetize')) score += 20;
  if (lower.includes('tutorial') || lower.includes('guide') || lower.includes('step')) score += 10;
  if (lower.includes('template') || lower.includes('download')) score += 15;

  // Question format (longer = more specific)
  if (q.split(' ').length >= 5) score += 10;

  return score;
}

export async function scrapeGooglePAA(): Promise<{ scraped: number; saved: number }> {
  console.log('[GooglePAA] 开始采集搜索建议...');

  const allQuestions: Array<{ question: string; seed: string; score: number }> = [];
  const seen = new Set<string>();

  for (const seed of SEED_QUERIES) {
    // Direct suggestions
    const suggestions = await getGoogleSuggestions(seed);
    for (const s of suggestions) {
      const norm = s.toLowerCase().trim();
      if (!seen.has(norm) && s.length > 10) {
        seen.add(norm);
        allQuestions.push({ question: s, seed, score: scoreQuestion(s) });
      }
    }

    // Question-expanded suggestions
    const questionQueries = expandToQuestions(seed);
    for (const qq of questionQueries) {
      const qSuggestions = await getGoogleSuggestions(qq);
      for (const s of qSuggestions) {
        const norm = s.toLowerCase().trim();
        if (!seen.has(norm) && s.length > 10) {
          seen.add(norm);
          allQuestions.push({ question: s, seed: qq, score: scoreQuestion(s) });
        }
      }
      await new Promise(r => setTimeout(r, 150));
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // Filter and sort
  const filtered = allQuestions
    .filter(q => q.score >= 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);

  console.log(`[GooglePAA] 获取 ${allQuestions.length} 条问题，${filtered.length} 条通过过滤`);

  let saved = 0;
  for (const item of filtered) {
    const sourceId = `paa-${contentHash(item.question, 'google_paa')}`;
    const hash = contentHash(item.question, 'google_paa');

    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'google_paa')
      .eq('source_id', sourceId)
      .maybeSingle();

    if (existing) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'google_paa',
      source_id: sourceId,
      source_url: `https://www.google.com/search?q=${encodeURIComponent(item.question)}`,
      title: item.question,
      description: `用户搜索问题，种子词: "${item.seed}"`,
      stars: item.score,
      comments_count: 0,
      content_hash: hash,
      raw_data: {
        seed_query: item.seed,
        intent_score: item.score,
        type: 'google_autocomplete_question',
      },
    });

    if (!error) {
      saved++;
      if (saved <= 5) console.log(`[GooglePAA] 保存: "${item.question}" (${item.score}分)`);
    }
  }

  console.log(`[GooglePAA] 完成: ${filtered.length} 条采集, ${saved} 条保存`);
  return { scraped: filtered.length, saved };
}

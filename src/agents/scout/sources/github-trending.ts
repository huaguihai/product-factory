/**
 * GitHub Trending Scraper
 * Discovers newly trending repos that could represent emerging tech opportunities
 */

import * as cheerio from 'cheerio';
import { supabaseAdmin } from '../../../db/supabase';
import { contentHash, daysSince } from '../../../utils/helpers';

export interface GitHubSignal {
  source_id: string;
  title: string;
  description: string;
  source_url: string;
  stars: number;
  language: string;
  growth_rate: number;
  repo_created_at: string | null;
  raw_data: any;
}

/**
 * Scrape GitHub trending page
 */
async function fetchTrendingPage(since: 'daily' | 'weekly' = 'daily'): Promise<GitHubSignal[]> {
  const url = `https://github.com/trending?since=${since}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html',
    },
  });

  if (!response.ok) {
    console.error(`[GitHub] Failed to fetch trending: ${response.status}`);
    return [];
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const signals: GitHubSignal[] = [];

  $('article.Box-row').each((_, el) => {
    const $el = $(el);
    const repoLink = $el.find('h2 a').attr('href')?.trim();
    if (!repoLink) return;

    const fullName = repoLink.replace(/^\//, '');
    const description = $el.find('p.col-9').text().trim();
    const language = $el.find('[itemprop="programmingLanguage"]').text().trim();

    // Parse stars
    const starsText = $el.find('a[href$="/stargazers"]').text().trim().replace(/,/g, '');
    const stars = parseInt(starsText) || 0;

    // Parse today's stars
    const todayStarsText = $el.find('span.d-inline-block.float-sm-right').text().trim();
    const todayStarsMatch = todayStarsText.match(/([\d,]+)\s+stars?\s+today/);
    const todayStars = todayStarsMatch ? parseInt(todayStarsMatch[1].replace(/,/g, '')) : 0;

    signals.push({
      source_id: fullName,
      title: fullName,
      description: description || '',
      source_url: `https://github.com/${fullName}`,
      stars,
      language,
      growth_rate: todayStars,
      repo_created_at: null,
      raw_data: { language, todayStars, fullName },
    });
  });

  return signals;
}

/**
 * Fetch repo details from GitHub API to get creation date
 */
async function fetchRepoDetails(fullName: string): Promise<{ created_at: string; description: string } | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${fullName}`, {
      headers: {
        'User-Agent': 'ProductFactory/1.0',
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) return null;
    const data: any = await response.json();
    return { created_at: data.created_at, description: data.description || '' };
  } catch {
    return null;
  }
}

/**
 * Main scrape function: fetch trending repos and save new signals
 */
export async function scrapeGitHubTrending(): Promise<{ scraped: number; saved: number }> {
  console.log('[GitHub] Starting trending scrape...');

  const signals = await fetchTrendingPage('daily');
  console.log(`[GitHub] Found ${signals.length} trending repos`);

  let saved = 0;

  for (const signal of signals) {
    // Check for duplicates
    const hash = contentHash(signal.title, 'github_trending');
    const { data: existing } = await supabaseAdmin
      .from('signals')
      .select('id')
      .eq('source', 'github_trending')
      .eq('source_id', signal.source_id)
      .maybeSingle();

    if (existing) continue;

    // Fetch repo creation date (rate limit: be gentle)
    const details = await fetchRepoDetails(signal.source_id);
    const createdAt = details?.created_at;
    const daysOld = createdAt ? daysSince(createdAt) : 999;

    // Only keep repos created in the last 60 days
    if (daysOld > 60) continue;

    const { error } = await supabaseAdmin.from('signals').insert({
      source: 'github_trending',
      source_id: signal.source_id,
      source_url: signal.source_url,
      title: signal.title,
      description: details?.description || signal.description,
      stars: signal.stars,
      growth_rate: signal.growth_rate,
      source_created_at: createdAt || null,
      content_hash: hash,
      raw_data: { ...signal.raw_data, days_old: daysOld },
    });

    if (!error) {
      saved++;
      console.log(`[GitHub] Saved: ${signal.title} (${daysOld}d old, ${signal.stars} stars, +${signal.growth_rate}/day)`);
    }

    // Rate limit GitHub API
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`[GitHub] Done: ${signals.length} scraped, ${saved} saved`);
  return { scraped: signals.length, saved };
}

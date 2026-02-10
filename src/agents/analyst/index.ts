/**
 * Analyst Agent - Deep evaluation of emerging signals
 * Scores opportunities on multiple dimensions and writes to opportunities table
 */

import { supabaseAdmin } from '../../db/supabase';
import { aiGenerateJson } from '../../ai/client';
import { isDailyBudgetExceeded } from '../../ai/cost-tracker';
import { slugify } from '../../utils/helpers';

interface OpportunityAssessment {
  title: string;
  title_zh: string;
  slug: string;
  description: string;
  description_zh: string;
  target_keyword: string;
  secondary_keywords: string[];
  category: string;
  opportunity_type: 'direct' | 'derivative';
  product_form: 'website' | 'mini_program' | 'both';
  score_breakdown: {
    development_speed: number;
    monetization: number;
    seo_potential: number;
    business_viability: number;
    time_sensitivity: number;
    longtail_value: number;
    novelty: number;
  };
  window_days_remaining: number;
  competitors: Array<{ name: string; url: string; weakness: string }>;
  recommended_template: string;
  recommended_features: string[];
  recommended_features_zh: string[];
  estimated_effort: string;
  monetization_strategy: string[];
  derivative_suggestions: string[];
  reasoning: string;
}

const SCORE_WEIGHTS: Record<string, number> = {
  development_speed: 0.15,
  monetization: 0.15,
  seo_potential: 0.15,
  business_viability: 0.20,
  time_sensitivity: 0.10,
  longtail_value: 0.15,
  novelty: 0.10,
};

function calculateWeightedScore(breakdown: OpportunityAssessment['score_breakdown']): number {
  return Object.entries(SCORE_WEIGHTS).reduce((total, [key, weight]) => {
    return total + ((breakdown as any)[key] || 0) * weight;
  }, 0);
}

const ANALYST_SYSTEM_PROMPT = `You are a senior product strategist for an indie developer who builds lightweight websites and WeChat mini-programs for ad and affiliate monetization.

Your evaluation criteria (each scored 0-100):

1. **Development Speed (0-100)**: Can we build this in < 1 day using a template? Higher = faster to build. Tutorial sites and comparison pages score high; complex interactive tools score low.
2. **Monetization (0-100)**: AdSense CPC estimate for this niche, affiliate program availability, traffic ceiling, user dwell time. High CPC niches (finance, SaaS tools) score higher.
3. **SEO Potential (0-100)**: Keyword search volume estimate, competition level from existing sites, long-tail keyword opportunities, SERP feature opportunities (featured snippets, People Also Ask).
4. **Business Viability (0-100)**: THIS IS CRITICAL. Score based on:
   - Can we create UNIQUE VALUE that doesn't already exist? If official docs/help center already answers the user's question, score LOW (< 30).
   - What does the user DO AFTER reading? If they just get an answer and leave (e.g. "how to verify my account"), score LOW. If they need ongoing tools, comparisons, or resources, score HIGH.
   - Content MOAT: Can we build something meaningfully better than what 100 copycat sites would produce? Thin step-by-step tutorials have NO moat (score < 20). Data-driven comparisons, curated directories, and interactive tools have HIGH moat.
   - Is the user intent TRANSACTIONAL (willing to click ads/buy something) or purely INFORMATIONAL (just wants a quick answer)? Transactional = HIGH, Informational = LOW.
   - Examples of LOW viability: platform policy changes (users just want to know what changed), account verification steps (official help center suffices), celebrity gossip (no product angle).
   - Examples of HIGH viability: "best alternatives to X" (comparison intent, affiliate potential), "how to block ads in X" (tool/extension intent), "X vs Y for Z use case" (purchase decision).
5. **Time Sensitivity (0-100)**: How urgent is the window? Will big players and content farms cover this soon? Higher = more urgent, must act now.
6. **Long-tail Value (0-100)**: Will people still search for this in 3-6 months? Evergreen topics score high; one-week viral spikes score low.
7. **Novelty (0-100)**: How new is this? How few competitors exist? Higher = less competition, more room for a new site.

Key principles:
- Score > 70 is worth building immediately
- Score 55-70 is worth deriving specific product ideas from
- If business_viability < 30, the overall opportunity should be REJECTED regardless of other scores
- Prioritize topics where a focused, well-built page can rank on page 1
- Consider DERIVATIVE opportunities: tutorials, comparisons, directories, prompt guides, cheatsheets
- Think about monetization concretely: which affiliate programs, what AdSense CPC range
- "New + searchable + buildable in 1 day + clear monetization path" is the sweet spot
- NEVER recommend opportunities where the only content we can create is restating official documentation`;

/**
 * Extract core topic words from a string for similarity comparison
 */
function extractTopicWords(text: string): Set<string> {
  const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'through',
    'how', 'what', 'which', 'who', 'when', 'where', 'why', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
    'and', 'but', 'or', 'nor', 'if', 'then', 'else', 'this', 'that',
    'these', 'those', 'it', 'its', 'your', 'our', 'my', 'his', 'her',
    'step', 'by', 'guide', 'tutorial', 'complete', 'full', 'new', 'best',
    'top', 'tips', 'tricks', 'ultimate', '2024', '2025', '2026',
  ]);
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

/**
 * Calculate Jaccard similarity between two sets of words
 */
function topicSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Group signals by topic — signals about the same topic are merged
 */
function groupSignalsByTopic(signals: any[]): any[][] {
  const groups: any[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < signals.length; i++) {
    if (assigned.has(i)) continue;
    const group = [signals[i]];
    assigned.add(i);
    const wordsI = extractTopicWords(signals[i].title + ' ' + (signals[i].description || ''));

    for (let j = i + 1; j < signals.length; j++) {
      if (assigned.has(j)) continue;
      const wordsJ = extractTopicWords(signals[j].title + ' ' + (signals[j].description || ''));
      const sim = topicSimilarity(wordsI, wordsJ);
      // Also check URL-based match
      const urlI = (signals[i].source_url || '').split('?')[0].replace(/\/+$/, '').toLowerCase();
      const urlJ = (signals[j].source_url || '').split('?')[0].replace(/\/+$/, '').toLowerCase();
      const sameUrl = urlI && urlJ && urlI === urlJ;

      if (sim >= 0.4 || sameUrl) {
        group.push(signals[j]);
        assigned.add(j);
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Merge a group of signals into one representative signal with combined context
 */
function mergeSignalGroup(group: any[]): any {
  // Pick the signal with most traction as representative
  group.sort((a: any, b: any) => ((b.stars || 0) + (b.comments_count || 0)) - ((a.stars || 0) + (a.comments_count || 0)));
  const primary = { ...group[0] };

  if (group.length > 1) {
    // Combine descriptions and source info
    const otherSources = group.slice(1).map((s: any) => `${s.source}: ${s.title}`).join('; ');
    primary.description = (primary.description || '') + `\nAlso reported by: ${otherSources}`;
    primary._merged_ids = group.map((s: any) => s.id);
    primary._merged_count = group.length;
  }
  return primary;
}

/**
 * Evaluate a single analyzed signal
 */
async function evaluateSignal(signal: any): Promise<OpportunityAssessment | null> {
  const aiAssessment = signal.raw_data?.ai_assessment || {};

  const prompt = `Evaluate this emerging tech signal as a product opportunity for an indie developer.

Signal:
- Title: ${signal.title}
- Description: ${signal.description || 'N/A'}
- Source: ${signal.source}
- Traction: ${signal.stars || 0} stars/votes, ${signal.comments_count || 0} comments
- First seen: ${signal.first_seen_at}
- Source created: ${signal.source_created_at || 'Unknown'}
- AI Pre-assessment: ${JSON.stringify(aiAssessment)}
- URL: ${signal.source_url}

Respond with JSON:
{
  "title": "SEO-friendly opportunity title (English, for slug and SEO)",
  "title_zh": "中文标题（10-25字，具体描述产品内容，如：AI视频生成工具对比与教程站、Step青少年理财App注册指南）",
  "slug": "url-safe-slug",
  "description": "2-3 sentence description (English)",
  "description_zh": "2-3句中文描述，不要用「一个」开头，直接说明：做什么产品、解决什么问题、怎么赚钱",
  "target_keyword": "primary SEO keyword in English (e.g. 'seedance tutorial')",
  "secondary_keywords": ["keyword 1", "keyword 2", "keyword 3"],
  "category": "ai_tool|dev_tool|saas|framework|tutorial|utility|trending_topic",
  "opportunity_type": "direct or derivative",
  "product_form": "website|mini_program|both",
  "score_breakdown": {
    "development_speed": 0-100,
    "monetization": 0-100,
    "seo_potential": 0-100,
    "business_viability": 0-100,
    "time_sensitivity": 0-100,
    "longtail_value": 0-100,
    "novelty": 0-100
  },
  "window_days_remaining": number,
  "competitors": [{"name": "...", "url": "...", "weakness": "..."}],
  "recommended_template": "tutorial-site|tool-site|comparison-site|cheatsheet-site|playground-site|resource-site|directory-site",
  "recommended_features": ["feature 1", "feature 2"],
  "recommended_features_zh": ["功能建议1（中文）", "功能建议2（中文）"],
  "estimated_effort": "2h|4h|1d|2d|3d",
  "monetization_strategy": ["adsense", "affiliate", "referral", "sponsored"],
  "derivative_suggestions": ["tutorial: how to use X", "comparison: X vs Y vs Z", "directory: best X alternatives"],
  "reasoning": "Detailed reasoning for scores, focusing on why this is or isn't a good opportunity for a quick, ad-monetized site"
}`;

  return await aiGenerateJson<OpportunityAssessment>(prompt, {
    system: ANALYST_SYSTEM_PROMPT,
    agentType: 'analyst',
    tier: 'quality',
    temperature: 0.4,
  });
}

/**
 * Main Analyst run: evaluate all analyzed signals
 */
export async function runAnalyst(): Promise<{ evaluated: number; opportunities: number }> {
  console.log('[Analyst] === Starting Analyst Run ===');

  const { exceeded, spent, limit } = await isDailyBudgetExceeded();
  if (exceeded) {
    console.warn(`[Analyst] Budget exceeded ($${spent.toFixed(2)}/$${limit}). Skipping.`);
    return { evaluated: 0, opportunities: 0 };
  }

  // Get analyzed signals that haven't been evaluated yet
  const { data: rawSignals } = await supabaseAdmin
    .from('signals')
    .select('*')
    .eq('status', 'analyzed')
    .order('created_at', { ascending: false })
    .limit(20);

  if (!rawSignals || rawSignals.length === 0) {
    console.log('[Analyst] No analyzed signals to evaluate');
    return { evaluated: 0, opportunities: 0 };
  }

  // Group signals by topic (not just URL) to prevent duplicates
  const groups = groupSignalsByTopic(rawSignals);
  console.log(`[Analyst] ${rawSignals.length} signals grouped into ${groups.length} topics`);

  // Merge each group into one representative signal
  const signals: any[] = [];
  for (const group of groups) {
    const merged = mergeSignalGroup(group);
    signals.push(merged);
    if (group.length > 1) {
      console.log(`[Analyst] ⊟ Merged ${group.length} signals about: "${merged.title.slice(0, 50)}"`);
      // Mark non-primary signals as dismissed
      for (const s of group.slice(1)) {
        await supabaseAdmin.from('signals').update({
          status: 'dismissed',
          raw_data: { ...s.raw_data, dismiss_reason: `Merged with signal ${merged.id} (same topic)` },
        }).eq('id', s.id);
      }
    }
  }

  // Load existing opportunities for semantic dedup
  const { data: existingOpps } = await supabaseAdmin
    .from('opportunities')
    .select('id, slug, title, target_keyword')
    .order('created_at', { ascending: false })
    .limit(100);
  const existingTopicSets = (existingOpps || []).map((opp: any) => ({
    opp,
    words: extractTopicWords(opp.title + ' ' + (opp.target_keyword || '')),
  }));

  const evalSignals = signals.slice(0, 10);
  console.log(`[Analyst] Evaluating ${evalSignals.length} topics...`);

  let evaluated = 0;
  let opportunities = 0;

  for (const signal of evalSignals) {
    const { exceeded } = await isDailyBudgetExceeded();
    if (exceeded) {
      console.warn('[Analyst] Budget exceeded mid-run. Stopping.');
      break;
    }

    const assessment = await evaluateSignal(signal);
    evaluated++;

    if (!assessment) {
      console.error(`[Analyst] Failed to evaluate: ${signal.title}`);
      continue;
    }

    const score = calculateWeightedScore(assessment.score_breakdown);
    const slug = assessment.slug || slugify(assessment.title);

    // Business viability gate: reject if too low regardless of total score
    const bv = assessment.score_breakdown.business_viability || 0;
    if (bv < 30) {
      console.log(`[Analyst] ✗ REJECTED (low business viability: ${bv}): ${assessment.title}`);
      // Mark signal as evaluated
      await supabaseAdmin.from('signals').update({ status: 'evaluated' })
        .eq('id', signal.id);
      continue;
    }

    // Semantic dedup against existing opportunities
    const newWords = extractTopicWords(assessment.title + ' ' + (assessment.target_keyword || ''));
    const duplicateOf = existingTopicSets.find(e => topicSimilarity(newWords, e.words) >= 0.35);
    if (duplicateOf) {
      console.log(`[Analyst] ⊟ Topic already covered: "${duplicateOf.opp.title.slice(0, 50)}" ≈ "${assessment.title.slice(0, 50)}", skipping`);
      await supabaseAdmin.from('signals').update({ status: 'evaluated' })
        .eq('id', signal.id);
      continue;
    }

    // Check if opportunity with this slug already exists
    const { data: existingOpp } = await supabaseAdmin
      .from('opportunities')
      .select('id, slug')
      .eq('slug', slug)
      .maybeSingle();

    if (existingOpp) {
      console.log(`[Analyst] Opportunity already exists (slug): ${slug}`);
      continue;
    }

    // Determine window status
    const windowDays = assessment.window_days_remaining || 14;
    let windowStatus = 'open';
    if (windowDays <= 3) windowStatus = 'closing';
    else if (windowDays > 30) windowStatus = 'upcoming';

    const windowClosesAt = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000).toISOString();

    // Insert opportunity
    const signalIds = signal._merged_ids || [signal.id];
    const insertData: Record<string, any> = {
      signal_ids: signalIds,
      title: assessment.title,
      slug,
      description: assessment.description,
      description_zh: assessment.description_zh || null,
      category: assessment.category,
      target_keyword: assessment.target_keyword,
      secondary_keywords: assessment.secondary_keywords || [],
      score,
      score_breakdown: assessment.score_breakdown,
      window_opens_at: signal.first_seen_at,
      window_closes_at: windowClosesAt,
      window_status: windowStatus,
      competitors: assessment.competitors,
      search_volume: null,
      recommended_template: assessment.recommended_template,
      recommended_features: assessment.recommended_features || [],
      recommended_features_zh: assessment.recommended_features_zh || [],
      estimated_effort: assessment.estimated_effort,
      opportunity_type: assessment.opportunity_type || 'direct',
      product_form: assessment.product_form || 'website',
      monetization_strategy: assessment.monetization_strategy || [],
      derivative_suggestions: assessment.derivative_suggestions || [],
      status: score >= 50 ? 'evaluated' : 'rejected',
      decision_reason: score < 50 ? `Score too low: ${score.toFixed(1)}` : null,
      decided_by: score < 50 ? 'auto' : 'human',
    };

    // Try with title_zh first; if column doesn't exist, retry without it
    if (assessment.title_zh) {
      insertData.title_zh = assessment.title_zh;
    }

    let { error } = await supabaseAdmin.from('opportunities').insert(insertData);

    // If title_zh column doesn't exist yet, retry without it
    if (error && error.message?.includes('title_zh')) {
      delete insertData.title_zh;
      const retry = await supabaseAdmin.from('opportunities').insert(insertData);
      error = retry.error;
    }

    if (!error) {
      opportunities++;
      const emoji = score >= 70 ? '🎯' : score >= 50 ? '📊' : '❌';
      console.log(`[Analyst] ${emoji} ${assessment.title} — Score: ${score.toFixed(1)} (viability: ${bv}, window: ${windowDays}d)`);
      console.log(`[Analyst]   Keyword: "${assessment.target_keyword}" | Template: ${assessment.recommended_template}`);

      // Add to existing set for intra-run dedup
      existingTopicSets.push({ opp: { id: '', slug, title: assessment.title, target_keyword: assessment.target_keyword }, words: newWords });
    } else {
      console.error(`[Analyst] Insert error for ${slug}:`, error.message);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  // Mark all processed signals as evaluated
  for (const signal of evalSignals) {
    const ids = signal._merged_ids || [signal.id];
    for (const id of ids) {
      await supabaseAdmin.from('signals').update({ status: 'evaluated' }).eq('id', id);
    }
  }

  console.log(`[Analyst] === Analyst Run Complete ===`);
  console.log(`[Analyst] Evaluated: ${evaluated}, Opportunities: ${opportunities}`);

  return { evaluated, opportunities };
}

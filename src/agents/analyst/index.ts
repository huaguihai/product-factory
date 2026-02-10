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
  development_speed: 0.20,
  monetization: 0.20,
  seo_potential: 0.20,
  time_sensitivity: 0.15,
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
4. **Time Sensitivity (0-100)**: How urgent is the window? Will big players and content farms cover this soon? Higher = more urgent, must act now.
5. **Long-tail Value (0-100)**: Will people still search for this in 3-6 months? Evergreen topics score high; one-week viral spikes score low.
6. **Novelty (0-100)**: How new is this? How few competitors exist? Higher = less competition, more room for a new site.

Key principles:
- Score > 70 is worth building immediately
- Score 55-70 is worth deriving specific product ideas from
- Prioritize topics where a focused, well-built page can rank on page 1
- Consider DERIVATIVE opportunities: tutorials, comparisons, directories, prompt guides, cheatsheets
- Think about monetization concretely: which affiliate programs, what AdSense CPC range
- "New + searchable + buildable in 1 day" is the sweet spot`;

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
  "title": "SEO-friendly opportunity title (English)",
  "slug": "url-safe-slug",
  "description": "2-3 sentence description of the opportunity (English)",
  "description_zh": "2-3句中文描述：这个项目是什么、为什么现在是机会、我们可以做什么",
  "target_keyword": "primary SEO keyword (e.g. 'seedance tutorial', 'seedance vs kling')",
  "secondary_keywords": ["related keyword 1", "related keyword 2", "related keyword 3"],
  "category": "ai_tool|dev_tool|saas|framework|tutorial|utility|trending_topic",
  "opportunity_type": "direct or derivative",
  "product_form": "website|mini_program|both",
  "score_breakdown": {
    "development_speed": 0-100,
    "monetization": 0-100,
    "seo_potential": 0-100,
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

  // Deduplicate signals by source_url — keep the one with highest traction
  const urlMap = new Map<string, any>();
  for (const sig of rawSignals) {
    // Normalize URL: strip trailing slashes, query params for comparison
    const rawUrl = sig.source_url || '';
    const normalizedUrl = rawUrl.split('?')[0].replace(/\/+$/, '').toLowerCase();
    const key = normalizedUrl || sig.title.toLowerCase().slice(0, 60);

    const existing = urlMap.get(key);
    if (!existing || (sig.stars || 0) > (existing.stars || 0)) {
      if (existing) {
        // Mark the duplicate as evaluated so it's not re-processed
        await supabaseAdmin.from('signals').update({
          status: 'dismissed',
          raw_data: { ...existing.raw_data, dismiss_reason: 'Duplicate signal (merged)' },
        }).eq('id', existing.id);
        console.log(`[Analyst] ⊟ Merged duplicate signal: "${existing.title.slice(0, 50)}"`);
      }
      urlMap.set(key, sig);
    } else {
      // This signal is a duplicate with lower traction, dismiss it
      await supabaseAdmin.from('signals').update({
        status: 'dismissed',
        raw_data: { ...sig.raw_data, dismiss_reason: 'Duplicate signal (merged)' },
      }).eq('id', sig.id);
      console.log(`[Analyst] ⊟ Merged duplicate signal: "${sig.title.slice(0, 50)}"`);
    }
  }

  const signals = Array.from(urlMap.values()).slice(0, 10);
  console.log(`[Analyst] Evaluating ${signals.length} signals (${rawSignals.length - signals.length} duplicates merged)...`);

  let evaluated = 0;
  let opportunities = 0;

  for (const signal of signals) {
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

    // Check if opportunity with this slug already exists
    const { data: existingOpp } = await supabaseAdmin
      .from('opportunities')
      .select('id, slug, target_keyword')
      .eq('slug', slug)
      .maybeSingle();

    if (existingOpp) {
      console.log(`[Analyst] Opportunity already exists (slug): ${slug}`);
      continue;
    }

    // Check if opportunity with similar keyword already exists (prevent near-duplicates)
    const keyword = assessment.target_keyword?.toLowerCase().trim() || '';
    if (keyword) {
      const { data: keywordMatch } = await supabaseAdmin
        .from('opportunities')
        .select('id, slug, target_keyword')
        .ilike('target_keyword', `%${keyword}%`)
        .limit(1)
        .maybeSingle();

      if (keywordMatch) {
        console.log(`[Analyst] ⊟ Similar opportunity exists: "${keywordMatch.target_keyword}" ≈ "${keyword}", skipping`);
        continue;
      }

      // Also check reverse: existing keyword contained in new keyword
      const { data: reverseMatch } = await supabaseAdmin
        .from('opportunities')
        .select('id, slug, target_keyword')
        .not('target_keyword', 'is', null)
        .limit(50);

      const hasSimilar = (reverseMatch || []).some((opp: any) => {
        const existingKw = (opp.target_keyword || '').toLowerCase().trim();
        return existingKw && (keyword.includes(existingKw) || existingKw.includes(keyword));
      });

      if (hasSimilar) {
        console.log(`[Analyst] ⊟ Similar keyword already covered: "${keyword}", skipping`);
        continue;
      }
    }

    // Determine window status
    const windowDays = assessment.window_days_remaining || 14;
    let windowStatus = 'open';
    if (windowDays <= 3) windowStatus = 'closing';
    else if (windowDays > 30) windowStatus = 'upcoming';

    const windowClosesAt = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000).toISOString();

    // Insert opportunity
    const { error } = await supabaseAdmin.from('opportunities').insert({
      signal_ids: [signal.id],
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
    });

    if (!error) {
      opportunities++;
      const emoji = score >= 70 ? '🎯' : score >= 50 ? '📊' : '❌';
      console.log(`[Analyst] ${emoji} ${assessment.title} — Score: ${score.toFixed(1)} (window: ${windowDays}d)`);
      console.log(`[Analyst]   Keyword: "${assessment.target_keyword}" | Template: ${assessment.recommended_template}`);
    } else {
      console.error(`[Analyst] Insert error for ${slug}:`, error.message);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`[Analyst] === Analyst Run Complete ===`);
  console.log(`[Analyst] Evaluated: ${evaluated}, Opportunities: ${opportunities}`);

  return { evaluated, opportunities };
}

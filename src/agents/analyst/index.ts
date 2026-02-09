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
  target_keyword: string;
  category: string;
  score_breakdown: {
    novelty: number;
    demand: number;
    feasibility: number;
    seo_potential: number;
    time_sensitivity: number;
    monetization: number;
  };
  window_days_remaining: number;
  competitors: Array<{ name: string; url: string; weakness: string }>;
  recommended_template: string;
  recommended_features: string[];
  estimated_effort: string;
  reasoning: string;
}

const SCORE_WEIGHTS = {
  time_sensitivity: 0.25,
  novelty: 0.20,
  feasibility: 0.20,
  seo_potential: 0.15,
  demand: 0.10,
  monetization: 0.10,
};

function calculateWeightedScore(breakdown: OpportunityAssessment['score_breakdown']): number {
  return Object.entries(SCORE_WEIGHTS).reduce((total, [key, weight]) => {
    return total + ((breakdown as any)[key] || 0) * weight;
  }, 0);
}

const ANALYST_SYSTEM_PROMPT = `You are a senior product manager and SEO expert who discovers fast-to-monetize tech product opportunities.

Your evaluation criteria:

1. **Novelty (0-100)**: How new is this? How many competitors exist? Higher = less competition.
2. **Demand (0-100)**: Community discussion heat? Are users searching for solutions?
3. **Feasibility (0-100)**: Can we build this with a template? (tutorial/tool/comparison site)
4. **SEO Potential (0-100)**: Keyword search volume estimate, competition level, long-tail potential.
5. **Time Sensitivity (0-100)**: How urgent is the window? Will big players move in soon?
6. **Monetization (0-100)**: AdSense CPC estimate, traffic ceiling, user dwell time.

Key principles:
- Score > 70 is worth building
- Window < 7 days should be marked urgent
- Mature products with many tutorials → low score
- "New" matters more than "good"
- Be specific about target keyword and competitors`;

/**
 * Evaluate a single analyzed signal
 */
async function evaluateSignal(signal: any): Promise<OpportunityAssessment | null> {
  const aiAssessment = signal.raw_data?.ai_assessment || {};

  const prompt = `Evaluate this emerging tech signal as a product opportunity.

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
  "description": "2-3 sentence description",
  "target_keyword": "primary SEO keyword",
  "category": "ai_tool|dev_tool|saas|framework|tutorial|utility",
  "score_breakdown": {
    "novelty": 0-100,
    "demand": 0-100,
    "feasibility": 0-100,
    "seo_potential": 0-100,
    "time_sensitivity": 0-100,
    "monetization": 0-100
  },
  "window_days_remaining": number,
  "competitors": [{"name": "...", "url": "...", "weakness": "..."}],
  "recommended_template": "tutorial-site|tool-site|comparison-site|cheatsheet-site|playground-site|resource-site",
  "recommended_features": ["feature1", "feature2"],
  "estimated_effort": "2h|4h|1d|2d|3d|1w",
  "reasoning": "Detailed reasoning for scores"
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
  const { data: signals } = await supabaseAdmin
    .from('signals')
    .select('*')
    .eq('status', 'analyzed')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!signals || signals.length === 0) {
    console.log('[Analyst] No analyzed signals to evaluate');
    return { evaluated: 0, opportunities: 0 };
  }

  console.log(`[Analyst] Evaluating ${signals.length} signals...`);

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
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (existingOpp) {
      console.log(`[Analyst] Opportunity already exists: ${slug}`);
      continue;
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
      category: assessment.category,
      target_keyword: assessment.target_keyword,
      score,
      score_breakdown: assessment.score_breakdown,
      window_opens_at: signal.first_seen_at,
      window_closes_at: windowClosesAt,
      window_status: windowStatus,
      competitors: assessment.competitors,
      search_volume: null,
      recommended_template: assessment.recommended_template,
      recommended_features: assessment.recommended_features,
      estimated_effort: assessment.estimated_effort,
      status: score >= 80 ? 'evaluated' : score >= 50 ? 'evaluated' : 'rejected',
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

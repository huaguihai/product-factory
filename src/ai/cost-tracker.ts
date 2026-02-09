/**
 * Cost Tracker - Records LLM usage and enforces daily budget
 */

import { supabaseAdmin } from '../db/supabase';
import { config } from '../config';

/**
 * Track token usage and cost for an AI call
 */
export async function trackCost(
  agentType: string,
  model: string,
  tokensInput: number,
  tokensOutput: number
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  // Estimate cost based on model
  let costUsd = 0;
  const modelLower = model.toLowerCase();
  if (modelLower.includes('haiku') || modelLower.includes('flash') || modelLower.includes('mini')) {
    costUsd = (tokensInput / 1000) * config.cost.haikuInputPer1k +
              (tokensOutput / 1000) * config.cost.haikuOutputPer1k;
  } else {
    costUsd = (tokensInput / 1000) * config.cost.sonnetInputPer1k +
              (tokensOutput / 1000) * config.cost.sonnetOutputPer1k;
  }

  // Upsert cost record
  const { data: existing } = await supabaseAdmin
    .from('cost_tracking')
    .select('id, api_calls, tokens_input, tokens_output, cost_usd')
    .eq('date', today)
    .eq('agent_type', agentType)
    .eq('llm_model', model)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin.from('cost_tracking').update({
      api_calls: (existing.api_calls || 0) + 1,
      tokens_input: (existing.tokens_input || 0) + tokensInput,
      tokens_output: (existing.tokens_output || 0) + tokensOutput,
      cost_usd: (existing.cost_usd || 0) + costUsd,
    }).eq('id', existing.id);
  } else {
    await supabaseAdmin.from('cost_tracking').insert({
      date: today,
      agent_type: agentType,
      llm_model: model,
      api_calls: 1,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      cost_usd: costUsd,
    });
  }
}

/**
 * Check if daily budget is exceeded
 */
export async function isDailyBudgetExceeded(): Promise<{ exceeded: boolean; spent: number; limit: number }> {
  const today = new Date().toISOString().split('T')[0];

  const { data } = await supabaseAdmin
    .from('cost_tracking')
    .select('cost_usd')
    .eq('date', today);

  const spent = data?.reduce((sum, r) => sum + (r.cost_usd || 0), 0) || 0;
  const limit = config.dailyBudgetLimit;

  return { exceeded: spent >= limit, spent, limit };
}

/**
 * Get today's cost summary
 */
export async function getTodayCostSummary(): Promise<{
  total: number;
  byAgent: Record<string, number>;
  byModel: Record<string, number>;
  apiCalls: number;
}> {
  const today = new Date().toISOString().split('T')[0];

  const { data } = await supabaseAdmin
    .from('cost_tracking')
    .select('*')
    .eq('date', today);

  const byAgent: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  let total = 0;
  let apiCalls = 0;

  for (const row of data || []) {
    total += row.cost_usd || 0;
    apiCalls += row.api_calls || 0;
    byAgent[row.agent_type] = (byAgent[row.agent_type] || 0) + (row.cost_usd || 0);
    byModel[row.llm_model] = (byModel[row.llm_model] || 0) + (row.cost_usd || 0);
  }

  return { total, byAgent, byModel, apiCalls };
}

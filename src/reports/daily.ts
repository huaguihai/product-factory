/**
 * Daily Report Generator
 * Generates and sends daily summary via Discord webhook
 */

import { supabaseAdmin } from '../db/supabase';
import { getTodayCostSummary } from '../ai/cost-tracker';
import { config } from '../config';
import { today } from '../utils/helpers';

interface DailyReportData {
  date: string;
  signals: { total: number; bySource: Record<string, number> };
  opportunities: { total: number; topScoring: any[] };
  cost: { total: number; byAgent: Record<string, number>; apiCalls: number };
}

/**
 * Gather data for the daily report
 */
async function gatherReportData(): Promise<DailyReportData> {
  const dateStr = today();
  const startOfDay = `${dateStr}T00:00:00Z`;
  const endOfDay = `${dateStr}T23:59:59Z`;

  // Today's signals
  const { data: signals } = await supabaseAdmin
    .from('signals')
    .select('source')
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay);

  const bySource: Record<string, number> = {};
  for (const s of signals || []) {
    bySource[s.source] = (bySource[s.source] || 0) + 1;
  }

  // Today's opportunities
  const { data: opportunities } = await supabaseAdmin
    .from('opportunities')
    .select('title, slug, score, score_breakdown, target_keyword, recommended_template, window_status, status')
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay)
    .order('score', { ascending: false })
    .limit(5);

  // Cost summary
  const cost = await getTodayCostSummary();

  return {
    date: dateStr,
    signals: { total: signals?.length || 0, bySource },
    opportunities: { total: opportunities?.length || 0, topScoring: opportunities || [] },
    cost,
  };
}

/**
 * Format report as Markdown
 */
function formatReport(data: DailyReportData): string {
  const lines: string[] = [];

  lines.push(`# Daily Report — ${data.date}`);
  lines.push('');

  // Signals
  lines.push(`## Signals Collected: ${data.signals.total}`);
  for (const [source, count] of Object.entries(data.signals.bySource)) {
    lines.push(`- ${source}: ${count}`);
  }
  lines.push('');

  // Opportunities
  lines.push(`## Opportunities Found: ${data.opportunities.total}`);
  if (data.opportunities.topScoring.length > 0) {
    for (const opp of data.opportunities.topScoring) {
      const score = typeof opp.score === 'number' ? opp.score.toFixed(1) : '?';
      const emoji = parseFloat(score) >= 70 ? '🎯' : parseFloat(score) >= 50 ? '📊' : '❌';
      lines.push(`${emoji} **${opp.title}** — Score: ${score}`);
      lines.push(`   Keyword: \`${opp.target_keyword}\` | Template: ${opp.recommended_template} | Window: ${opp.window_status}`);
    }
  } else {
    lines.push('- No new opportunities today');
  }
  lines.push('');

  // Cost
  lines.push(`## Cost: $${data.cost.total.toFixed(4)} (${data.cost.apiCalls} API calls)`);
  for (const [agent, cost] of Object.entries(data.cost.byAgent)) {
    lines.push(`- ${agent}: $${cost.toFixed(4)}`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Send report to Discord webhook
 */
async function sendToDiscord(content: string): Promise<boolean> {
  if (!config.discord.webhookUrl) {
    console.log('[Report] No Discord webhook configured, skipping');
    return false;
  }

  try {
    // Discord has a 2000 char limit per message
    const chunks: string[] = [];
    if (content.length <= 2000) {
      chunks.push(content);
    } else {
      // Split by sections
      const sections = content.split('\n## ');
      let chunk = sections[0];
      for (let i = 1; i < sections.length; i++) {
        const section = '## ' + sections[i];
        if (chunk.length + section.length + 1 > 2000) {
          chunks.push(chunk);
          chunk = section;
        } else {
          chunk += '\n' + section;
        }
      }
      if (chunk) chunks.push(chunk);
    }

    for (const chunk of chunks) {
      const response = await fetch(config.discord.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: chunk }),
      });

      if (!response.ok) {
        console.error(`[Report] Discord send failed: ${response.status}`);
        return false;
      }

      await new Promise(r => setTimeout(r, 500));
    }

    console.log('[Report] Sent to Discord');
    return true;
  } catch (error) {
    console.error('[Report] Discord error:', error);
    return false;
  }
}

/**
 * Save report to database
 */
async function saveReport(data: DailyReportData): Promise<void> {
  await supabaseAdmin.from('daily_reports').upsert({
    report_date: data.date,
    signals_collected: data.signals.total,
    opportunities_found: data.opportunities.total,
    top_opportunities: data.opportunities.topScoring,
    total_llm_cost: data.cost.total,
    total_api_calls: data.cost.apiCalls,
    details: {
      signals_by_source: data.signals.bySource,
      cost_by_agent: data.cost.byAgent,
    },
  }, { onConflict: 'report_date' });
}

/**
 * Generate and send daily report
 */
export async function generateDailyReport(): Promise<void> {
  console.log('[Report] === Generating Daily Report ===');

  const data = await gatherReportData();
  const report = formatReport(data);

  console.log(report);

  await saveReport(data);
  await sendToDiscord(report);

  console.log('[Report] === Report Complete ===');
}

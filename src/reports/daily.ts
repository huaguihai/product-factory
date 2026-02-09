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

  // Today's opportunities with full details
  const { data: opportunities } = await supabaseAdmin
    .from('opportunities')
    .select('title, slug, score, score_breakdown, target_keyword, recommended_template, recommended_features, recommended_features_zh, window_status, window_closes_at, competitors, description, description_zh, category, signal_ids, estimated_effort, status')
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay)
    .order('score', { ascending: false })
    .limit(5);

  // Fetch related signals for source URLs and traction data
  if (opportunities && opportunities.length > 0) {
    const allSignalIds = opportunities.flatMap((o: any) => o.signal_ids || []);
    if (allSignalIds.length > 0) {
      const { data: relatedSignals } = await supabaseAdmin
        .from('signals')
        .select('id, source, source_url, stars, comments_count, title')
        .in('id', allSignalIds);

      // Attach signal data to opportunities
      const signalMap = new Map((relatedSignals || []).map((s: any) => [s.id, s]));
      for (const opp of opportunities) {
        const ids = (opp as any).signal_ids || [];
        (opp as any)._signals = ids.map((id: string) => signalMap.get(id)).filter(Boolean);
      }
    }
  }

  // Cost summary
  const cost = await getTodayCostSummary();

  return {
    date: dateStr,
    signals: { total: signals?.length || 0, bySource },
    opportunities: { total: opportunities?.length || 0, topScoring: opportunities || [] },
    cost,
  };
}

const WINDOW_STATUS_MAP: Record<string, string> = {
  'open': '开放中',
  'closing': '即将关闭',
  'upcoming': '即将开放',
  'closed': '已关闭',
};

const TEMPLATE_MAP: Record<string, string> = {
  'tutorial-site': '教程站',
  'tool-site': '工具站',
  'comparison-site': '对比站',
  'cheatsheet-site': '速查表',
  'playground-site': '在线体验',
  'resource-site': '资源站',
};

const CATEGORY_MAP: Record<string, string> = {
  'ai_tool': 'AI 工具',
  'dev_tool': '开发工具',
  'saas': 'SaaS',
  'framework': '框架',
  'tutorial': '教程',
  'utility': '实用工具',
};

/**
 * Format a single opportunity as a detailed card
 */
function formatOpportunityCard(opp: any, index: number): string[] {
  const lines: string[] = [];
  const score = typeof opp.score === 'number' ? opp.score.toFixed(1) : '?';
  const breakdown = opp.score_breakdown || {};

  // Header
  lines.push(`### ${index}. ${opp.title}`);
  lines.push(`**综合评分: ${score}** | ${CATEGORY_MAP[opp.category] || opp.category} | ${TEMPLATE_MAP[opp.recommended_template] || opp.recommended_template}`);
  lines.push('');

  // Description
  const descZh = opp.description_zh || opp.description || '';
  lines.push(`> ${descZh}`);
  lines.push('');

  // Score breakdown bar
  const dims = [
    { label: '时效性', value: breakdown.time_sensitivity },
    { label: '新颖度', value: breakdown.novelty },
    { label: '可行性', value: breakdown.feasibility },
    { label: 'SEO', value: breakdown.seo_potential },
    { label: '需求', value: breakdown.demand },
    { label: '变现', value: breakdown.monetization },
  ];
  const dimStr = dims
    .filter(d => d.value != null)
    .map(d => `${d.label}: ${d.value}`)
    .join(' | ');
  lines.push(`📊 ${dimStr}`);

  // Source & traction
  const sigs = (opp as any)._signals || [];
  if (sigs.length > 0) {
    const sig = sigs[0];
    const traction = [];
    if (sig.stars) traction.push(`${sig.stars} 赞`);
    if (sig.comments_count) traction.push(`${sig.comments_count} 评论`);
    lines.push(`📡 来源: ${sig.source} — ${traction.join(', ')}`);
    lines.push(`🔗 ${sig.source_url}`);
  }

  // Window
  const windowLabel = WINDOW_STATUS_MAP[opp.window_status] || opp.window_status;
  let windowDetail = `⏰ 窗口期: ${windowLabel}`;
  if (opp.window_closes_at) {
    const daysLeft = Math.ceil((new Date(opp.window_closes_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft > 0) windowDetail += ` (剩余约 ${daysLeft} 天)`;
  }
  lines.push(windowDetail);

  // Keyword & effort
  lines.push(`🔑 关键词: \`${opp.target_keyword}\` | 预估工作量: ${opp.estimated_effort || '未知'}`);

  // Competitors
  const competitors = opp.competitors || [];
  if (competitors.length > 0) {
    const compStr = competitors.map((c: any) => c.name || c).join(', ');
    lines.push(`⚔️ 竞品: ${compStr}`);
  } else {
    lines.push(`⚔️ 竞品: 暂无直接竞品`);
  }

  // Recommended features
  const features = opp.recommended_features_zh || opp.recommended_features || [];
  if (features.length > 0) {
    lines.push(`💡 建议功能: ${features.join('、')}`);
  }

  lines.push('');
  return lines;
}

/**
 * Format complete report
 */
function formatReport(data: DailyReportData): string[] {
  // Return array of message chunks (Discord 2000 char limit)
  const messages: string[] = [];

  // Header message
  const header: string[] = [];
  header.push(`# 📋 每日报告 — ${data.date}`);
  header.push('');
  header.push(`今日采集 **${data.signals.total}** 条信号，发现 **${data.opportunities.total}** 个机会`);
  const sourceStr = Object.entries(data.signals.bySource)
    .map(([source, count]) => `${source}: ${count}`)
    .join(' | ');
  header.push(`来源: ${sourceStr}`);
  header.push('');
  messages.push(header.join('\n'));

  // Each opportunity as a separate message
  if (data.opportunities.topScoring.length > 0) {
    for (let i = 0; i < data.opportunities.topScoring.length; i++) {
      const opp = data.opportunities.topScoring[i];
      const card = formatOpportunityCard(opp, i + 1);
      messages.push(card.join('\n'));
    }
  } else {
    messages.push('今日无新机会');
  }

  // Cost footer
  const footer: string[] = [];
  footer.push(`---`);
  footer.push(`💰 **成本**: $${data.cost.total.toFixed(4)} (${data.cost.apiCalls} 次调用)`);
  const agentCosts = Object.entries(data.cost.byAgent)
    .map(([agent, cost]) => `${agent}: $${cost.toFixed(4)}`)
    .join(' | ');
  if (agentCosts) footer.push(agentCosts);
  messages.push(footer.join('\n'));

  return messages;
}

/**
 * Send report to Discord webhook (multi-message)
 */
async function sendToDiscord(messages: string[]): Promise<boolean> {
  if (!config.discord.webhookUrl) {
    console.log('[Report] No Discord webhook configured, skipping');
    return false;
  }

  try {
    for (const msg of messages) {
      // Split if a single message exceeds 2000 chars
      const chunks: string[] = [];
      if (msg.length <= 2000) {
        chunks.push(msg);
      } else {
        // Split by lines, respecting limit
        const lines = msg.split('\n');
        let chunk = '';
        for (const line of lines) {
          if (chunk.length + line.length + 1 > 1900) {
            chunks.push(chunk);
            chunk = line;
          } else {
            chunk += (chunk ? '\n' : '') + line;
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
  const messages = formatReport(data);

  // Log full report
  for (const msg of messages) {
    console.log(msg);
  }

  await saveReport(data);
  await sendToDiscord(messages);

  console.log('[Report] === Report Complete ===');
}

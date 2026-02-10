/**
 * Daily Report Generator
 * Generates and sends daily summary via Discord webhook and GitHub Pages
 */

import { supabaseAdmin } from '../db/supabase';
import { getTodayCostSummary } from '../ai/cost-tracker';
import { config } from '../config';
import { today } from '../utils/helpers';
import * as fs from 'fs';
import * as path from 'path';

interface DailyReportData {
  date: string;
  signals: { total: number; bySource: Record<string, number> };
  opportunities: { total: number; topScoring: any[] };
  derivatives: { total: number; topScoring: any[] };
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

  // Today's derivatives
  const { data: derivatives } = await supabaseAdmin
    .from('derived_products')
    .select('id, title, slug, derivative_type, parent_topic, target_keywords, product_form, score, competition_level, monetization_strategy, build_effort, status')
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay)
    .order('score', { ascending: false })
    .limit(10);

  return {
    date: dateStr,
    signals: { total: signals?.length || 0, bySource },
    opportunities: { total: opportunities?.length || 0, topScoring: opportunities || [] },
    derivatives: { total: derivatives?.length || 0, topScoring: derivatives || [] },
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
    { label: '开发速度', value: breakdown.development_speed },
    { label: '变现', value: breakdown.monetization },
    { label: 'SEO', value: breakdown.seo_potential },
    { label: '时效性', value: breakdown.time_sensitivity },
    { label: '长尾', value: breakdown.longtail_value },
    { label: '新颖度', value: breakdown.novelty },
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
  header.push(`# 每日报告 — ${data.date}`);
  header.push('');
  header.push(`今日采集 **${data.signals.total}** 条信号，发现 **${data.opportunities.total}** 个机会，派生 **${data.derivatives.total}** 个产品创意`);
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

  // Derivatives section
  if (data.derivatives.topScoring.length > 0) {
    const derivMsg: string[] = [];
    derivMsg.push(`## 派生产品创意 (${data.derivatives.total})`);
    derivMsg.push('');
    for (const d of data.derivatives.topScoring) {
      const score = typeof d.score === 'number' ? d.score.toFixed(0) : '?';
      const keywords = (d.target_keywords || []).join(', ');
      const monetization = (d.monetization_strategy || []).join(', ');
      derivMsg.push(`**[${d.derivative_type}] ${d.title}** (${score}分)`);
      derivMsg.push(`  来源: ${d.parent_topic}`);
      derivMsg.push(`  关键词: ${keywords}`);
      derivMsg.push(`  变现: ${monetization} | 工作量: ${d.build_effort} | 竞争: ${d.competition_level}`);
      derivMsg.push('');
    }
    messages.push(derivMsg.join('\n'));
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
 * Format the full report as a single Markdown document (for GitHub Pages)
 */
function formatFullMarkdown(data: DailyReportData): string {
  const lines: string[] = [];

  // YAML front matter for Jekyll
  lines.push('---');
  lines.push(`layout: default`);
  lines.push(`title: "Daily Report - ${data.date}"`);
  lines.push('---');
  lines.push('');

  lines.push(`# Daily Report — ${data.date}`);
  lines.push('');
  lines.push(`[← Back to Index](../)`);
  lines.push('');

  // Summary
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Signals Collected | ${data.signals.total} |`);
  lines.push(`| Opportunities Found | ${data.opportunities.total} |`);
  lines.push(`| Derivatives Created | ${data.derivatives.total} |`);
  lines.push(`| LLM Cost | $${data.cost.total.toFixed(4)} |`);
  lines.push(`| API Calls | ${data.cost.apiCalls} |`);
  lines.push('');

  // Sources breakdown
  const sourceEntries = Object.entries(data.signals.bySource);
  if (sourceEntries.length > 0) {
    lines.push(`### Signal Sources`);
    lines.push('');
    lines.push(`| Source | Count |`);
    lines.push(`|--------|-------|`);
    for (const [source, count] of sourceEntries) {
      lines.push(`| ${source} | ${count} |`);
    }
    lines.push('');
  }

  // Opportunities
  if (data.opportunities.topScoring.length > 0) {
    lines.push(`## Top Opportunities`);
    lines.push('');
    for (let i = 0; i < data.opportunities.topScoring.length; i++) {
      const opp = data.opportunities.topScoring[i];
      const card = formatOpportunityCard(opp, i + 1);
      lines.push(...card);
    }
  }

  // Derivatives
  if (data.derivatives.topScoring.length > 0) {
    lines.push(`## Derivative Product Ideas (${data.derivatives.total})`);
    lines.push('');
    lines.push(`| Type | Title | Score | Keywords | Monetization | Effort | Competition |`);
    lines.push(`|------|-------|-------|----------|-------------|--------|-------------|`);
    for (const d of data.derivatives.topScoring) {
      const score = typeof d.score === 'number' ? d.score.toFixed(0) : '?';
      const keywords = (d.target_keywords || []).slice(0, 3).join(', ');
      const monetization = (d.monetization_strategy || []).join(', ');
      lines.push(`| ${d.derivative_type} | ${d.title} | ${score} | ${keywords} | ${monetization} | ${d.build_effort} | ${d.competition_level || '-'} |`);
    }
    lines.push('');

    // Detailed derivative cards
    for (const d of data.derivatives.topScoring) {
      const score = typeof d.score === 'number' ? d.score.toFixed(0) : '?';
      lines.push(`### [${d.derivative_type}] ${d.title} (${score})`);
      lines.push('');
      lines.push(`- **Parent Topic**: ${d.parent_topic}`);
      lines.push(`- **Keywords**: ${(d.target_keywords || []).join(', ')}`);
      lines.push(`- **Product Form**: ${d.product_form}`);
      lines.push(`- **Monetization**: ${(d.monetization_strategy || []).join(', ')}`);
      lines.push(`- **Build Effort**: ${d.build_effort}`);
      lines.push(`- **Competition**: ${d.competition_level || 'unknown'}`);
      lines.push(`- **Status**: ${d.status}`);
      lines.push('');
    }
  }

  // Cost breakdown
  lines.push(`## Cost Breakdown`);
  lines.push('');
  lines.push(`| Agent | Cost |`);
  lines.push(`|-------|------|`);
  for (const [agent, cost] of Object.entries(data.cost.byAgent)) {
    lines.push(`| ${agent} | $${cost.toFixed(4)} |`);
  }
  lines.push(`| **Total** | **$${data.cost.total.toFixed(4)}** |`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Save report as Markdown file to docs/reports/
 */
function saveMarkdownReport(data: DailyReportData, markdown: string): string | null {
  try {
    const docsDir = path.resolve(__dirname, '../../docs/reports');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }

    const filename = `${data.date}.md`;
    const filepath = path.join(docsDir, filename);
    fs.writeFileSync(filepath, markdown, 'utf-8');
    console.log(`[Report] Saved markdown: ${filepath}`);
    return filepath;
  } catch (error) {
    console.error('[Report] Failed to save markdown:', error);
    return null;
  }
}

/**
 * Update the docs/index.md with the new report link
 */
function updateReportIndex(data: DailyReportData): void {
  try {
    const indexPath = path.resolve(__dirname, '../../docs/index.md');
    if (!fs.existsSync(indexPath)) return;

    let content = fs.readFileSync(indexPath, 'utf-8');

    const reportLink = `- [${data.date}](reports/${data.date}) — ${data.signals.total} signals, ${data.opportunities.total} opportunities, ${data.derivatives.total} derivatives, $${data.cost.total.toFixed(4)}`;

    const startMarker = '<!-- REPORT_INDEX_START -->';
    const endMarker = '<!-- REPORT_INDEX_END -->';

    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = content.substring(0, startIdx + startMarker.length);
      const existingContent = content.substring(startIdx + startMarker.length, endIdx).trim();
      const after = content.substring(endIdx);

      // Remove placeholder text if it's the first report
      const existingLines = existingContent
        .split('\n')
        .filter(line => line.trim() && !line.includes('No reports yet'));

      // Add new report at the top (most recent first)
      existingLines.unshift(reportLink);

      content = before + '\n' + existingLines.join('\n') + '\n' + after;
      fs.writeFileSync(indexPath, content, 'utf-8');
      console.log('[Report] Updated index.md');
    }
  } catch (error) {
    console.error('[Report] Failed to update index:', error);
  }
}

/**
 * Send report to Discord webhook (summary + GitHub Pages link)
 */
async function sendToDiscord(data: DailyReportData): Promise<boolean> {
  if (!config.discord.webhookUrl) {
    console.log('[Report] No Discord webhook configured, skipping');
    return false;
  }

  try {
    // Build a compact summary for Discord
    const summary: string[] = [];
    summary.push(`# Daily Report — ${data.date}`);
    summary.push('');
    summary.push(`Signals: **${data.signals.total}** | Opportunities: **${data.opportunities.total}** | Derivatives: **${data.derivatives.total}** | Cost: **$${data.cost.total.toFixed(4)}**`);

    // Top 3 opportunities (compact)
    if (data.opportunities.topScoring.length > 0) {
      summary.push('');
      summary.push('**Top Opportunities:**');
      for (let i = 0; i < Math.min(3, data.opportunities.topScoring.length); i++) {
        const opp = data.opportunities.topScoring[i];
        const score = typeof opp.score === 'number' ? opp.score.toFixed(0) : '?';
        summary.push(`${i + 1}. **${opp.title}** (${score}) — \`${opp.target_keyword}\``);
      }
    }

    // Top 3 derivatives (compact)
    if (data.derivatives.topScoring.length > 0) {
      summary.push('');
      summary.push('**Top Derivatives:**');
      for (let i = 0; i < Math.min(3, data.derivatives.topScoring.length); i++) {
        const d = data.derivatives.topScoring[i];
        const score = typeof d.score === 'number' ? d.score.toFixed(0) : '?';
        summary.push(`${i + 1}. [${d.derivative_type}] **${d.title}** (${score})`);
      }
    }

    // GitHub Pages link
    if (config.githubPages.baseUrl) {
      summary.push('');
      summary.push(`Full report: ${config.githubPages.baseUrl}/reports/${data.date}`);
    }

    const content = summary.join('\n');

    const response = await fetch(config.discord.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      console.error(`[Report] Discord send failed: ${response.status}`);
      return false;
    }

    console.log('[Report] Sent summary to Discord');
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
    derivatives_created: data.derivatives.total,
    top_opportunities: data.opportunities.topScoring,
    total_llm_cost: data.cost.total,
    total_api_calls: data.cost.apiCalls,
    details: {
      signals_by_source: data.signals.bySource,
      cost_by_agent: data.cost.byAgent,
      top_derivatives: data.derivatives.topScoring,
    },
  }, { onConflict: 'report_date' });
}

/**
 * Generate and send daily report
 */
export async function generateDailyReport(): Promise<void> {
  console.log('[Report] === Generating Daily Report ===');

  const data = await gatherReportData();

  // Generate full markdown for GitHub Pages
  const markdown = formatFullMarkdown(data);
  saveMarkdownReport(data, markdown);
  updateReportIndex(data);

  // Log summary to console
  const messages = formatReport(data);
  for (const msg of messages) {
    console.log(msg);
  }

  // Save to database
  await saveReport(data);

  // Send compact summary to Discord (with link to full report)
  await sendToDiscord(data);

  console.log('[Report] === Report Complete ===');
}

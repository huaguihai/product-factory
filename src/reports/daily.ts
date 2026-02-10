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

/**
 * Dedup opportunities for display — keep only best per topic cluster
 */
function dedupOpportunities(opps: any[]): any[] {
  if (!opps || opps.length === 0) return [];

  const extractWords = (text: string): Set<string> => {
    const stops = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'for', 'on', 'how', 'and', 'or',
      'step', 'by', 'guide', 'tutorial', 'complete', 'full', 'new', 'best', 'top', '2024', '2025', '2026']);
    return new Set(
      text.toLowerCase().replace(/[^a-z0-9\s\u4e00-\u9fff]/g, ' ')
        .split(/\s+/).filter(w => w.length > 2 && !stops.has(w))
    );
  };

  const jaccard = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const w of a) { if (b.has(w)) inter++; }
    return inter / new Set([...a, ...b]).size;
  };

  // Keep best per topic (Jaccard >= 0.3 considered same topic)
  const kept: any[] = [];
  const keptWords: Set<string>[] = [];
  for (const opp of opps) {
    const words = extractWords(opp.title + ' ' + (opp.target_keyword || ''));
    const isDup = keptWords.some(kw => jaccard(words, kw) >= 0.3);
    if (!isDup) {
      kept.push(opp);
      keptWords.push(words);
    }
  }
  return kept.slice(0, 5);
}

interface DailyReportData {
  date: string;
  signals: { total: number; bySource: Record<string, number> };
  opportunities: { total: number; topScoring: any[] };
  derivatives: { total: number; validated: number; rejected: number; topScoring: any[] };
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
  // Try selecting title_zh; if column doesn't exist, fallback without it
  let opportunities: any[] | null = null;
  const baseFields = 'title, slug, score, score_breakdown, target_keyword, recommended_template, recommended_features, recommended_features_zh, window_status, window_closes_at, competitors, description, description_zh, category, signal_ids, estimated_effort, monetization_strategy, status';

  const { data: oppsWithZh, error: zhError } = await supabaseAdmin
    .from('opportunities')
    .select(baseFields + ', title_zh')
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay)
    .neq('status', 'archived')
    .neq('status', 'rejected')
    .order('score', { ascending: false })
    .limit(10);

  if (zhError && zhError.message?.includes('title_zh')) {
    // Column doesn't exist yet, query without it
    const { data: oppsNoZh } = await supabaseAdmin
      .from('opportunities')
      .select(baseFields)
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay)
      .neq('status', 'archived')
      .neq('status', 'rejected')
      .order('score', { ascending: false })
      .limit(10);
    opportunities = oppsNoZh;
  } else {
    opportunities = oppsWithZh;
  }

  // Fetch related signals for source URLs
  if (opportunities && opportunities.length > 0) {
    const allSignalIds = opportunities.flatMap((o: any) => o.signal_ids || []);
    if (allSignalIds.length > 0) {
      const { data: relatedSignals } = await supabaseAdmin
        .from('signals')
        .select('id, source, source_url, stars, comments_count, title')
        .in('id', allSignalIds);
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
    .limit(15);

  const validated = (derivatives || []).filter((d: any) => d.status === 'validated').length;
  const rejected = (derivatives || []).filter((d: any) => d.status === 'rejected').length;

  // Dedup opportunities at display level (defense against near-duplicates)
  const dedupedOpps = dedupOpportunities(opportunities || []);

  return {
    date: dateStr,
    signals: { total: signals?.length || 0, bySource },
    opportunities: { total: dedupedOpps.length, topScoring: dedupedOpps },
    derivatives: { total: derivatives?.length || 0, validated, rejected, topScoring: derivatives || [] },
    cost,
  };
}

const SOURCE_MAP: Record<string, string> = {
  google_trends: 'Google Trends',
  tech_media: '科技媒体',
  twitter_trends: 'Twitter/X',
  github_trending: 'GitHub',
  hackernews: 'Hacker News',
  product_hunt: 'Product Hunt',
  reddit: 'Reddit',
  youtube_suggestions: 'YouTube 热搜',
  google_paa: 'Google 相关问题',
  zhihu: '知乎',
  chrome_webstore: 'Chrome 扩展商店',
  indiehackers: 'IndieHackers',
  gumroad: 'Gumroad',
  exploding_topics: '爆发趋势',
  techmeme: 'Techmeme',
  bestblogs: '优质博客',
  quora: 'Quora',
  '36kr': '36氪',
  weibo: '微博',
  bilibili: 'B站',
  juejin: '掘金',
  xiaohongshu: '小红书',
};

const TEMPLATE_MAP: Record<string, string> = {
  'tutorial-site': '教程站',
  'tool-site': '工具站',
  'comparison-site': '对比站',
  'cheatsheet-site': '速查表',
  'playground-site': '在线体验',
  'resource-site': '资源站',
  'directory-site': '目录站',
};

const DERIV_TYPE_MAP: Record<string, string> = {
  tutorial: '教程',
  comparison: '对比',
  directory: '目录',
  tool: '工具',
  prompt_guide: 'Prompt 指南',
  template_gallery: '模板库',
  cheatsheet: '速查表',
  aggregator: '聚合器',
  calculator: '计算器',
  landing_page: '落地页',
};

const EFFORT_MAP: Record<string, string> = {
  '2h': '2小时',
  '4h': '半天',
  '1d': '1天',
  '2d': '2天',
  '3d': '3天',
};

const COMPETITION_MAP: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  easy: '低',
  moderate: '中',
  hard: '高',
  unknown: '未知',
};

function scoreClass(score: number): string {
  if (score >= 70) return 'score-high';
  if (score >= 50) return 'score-mid';
  return 'score-low';
}

function scoreSegment(value: number): string {
  if (value >= 70) return 'seg-green';
  if (value >= 40) return 'seg-yellow';
  if (value > 0) return 'seg-red';
  return 'seg-gray';
}

/**
 * Generate executive summary — the most important part of the report
 */
function generateExecutiveSummary(data: DailyReportData): { verdict: string; reasoning: string } {
  const opps = data.opportunities.topScoring;
  const derivs = data.derivatives.topScoring.filter((d: any) => d.status === 'validated');

  if (opps.length === 0 && derivs.length === 0) {
    return {
      verdict: '今日无高价值机会，建议维持现有产品运营。',
      reasoning: `采集了 ${data.signals.total} 条信号，但没有发现符合商业可行性标准的新机会。`,
    };
  }

  // Find the best actionable item
  const bestOpp = opps[0];
  const bestDeriv = derivs[0];

  let verdict = '';
  let reasoning = '';

  if (bestOpp && bestOpp.score >= 70) {
    const effort = EFFORT_MAP[bestOpp.estimated_effort] || bestOpp.estimated_effort;
    const bv = bestOpp.score_breakdown?.business_viability;
    const summaryTitle = bestOpp.title_zh || bestOpp.description_zh?.split('，')[0] || bestOpp.title;
    verdict = `今日最佳机会：${summaryTitle}`;
    reasoning = `综合评分 ${bestOpp.score.toFixed(0)} 分` +
      (bv ? `，商业可行性 ${bv} 分` : '') +
      `，预估投入 ${effort}` +
      `，关键词「${bestOpp.target_keyword}」。` +
      (data.derivatives.validated > 0 ? `另有 ${data.derivatives.validated} 个衍生产品通过验证。` : '');
  } else if (bestDeriv) {
    verdict = `今日无突破性机会，但有 ${derivs.length} 个衍生产品值得关注。`;
    reasoning = `最佳衍生品：${bestDeriv.title}（${bestDeriv.score?.toFixed(0)} 分），竞争度${COMPETITION_MAP[bestDeriv.competition_level] || '未知'}。`;
  } else {
    verdict = `发现 ${opps.length} 个潜在机会，但均未达到立即执行标准。`;
    reasoning = `最高分 ${bestOpp?.score?.toFixed(0) || '?'} 分，建议观察趋势变化。`;
  }

  return { verdict, reasoning };
}

/**
 * Format the full report as styled HTML (for GitHub Pages)
 */
function formatFullHtml(data: DailyReportData): string {
  const lines: string[] = [];
  const summary = generateExecutiveSummary(data);

  // YAML front matter
  lines.push('---');
  lines.push('layout: default');
  lines.push(`title: "每日洞察 - ${data.date}"`);
  lines.push('---');
  lines.push('');

  // Back link
  lines.push('<a href="../" class="back-link">← 返回首页</a>');
  lines.push('');

  // Header
  lines.push('<div class="report-header">');
  lines.push(`  <h1>每日洞察</h1>`);
  lines.push(`  <div class="date">${data.date}</div>`);
  lines.push('</div>');
  lines.push('');

  // Executive Summary
  lines.push('<div class="executive-summary">');
  lines.push(`  <p class="verdict">${summary.verdict}</p>`);
  lines.push(`  <p class="reasoning">${summary.reasoning}</p>`);
  lines.push('</div>');
  lines.push('');

  // Stats Row
  lines.push('<div class="stats-row">');
  lines.push('  <div class="stat-card">');
  lines.push(`    <div class="number">${data.signals.total}</div>`);
  lines.push('    <div class="label">信号采集</div>');
  lines.push('  </div>');
  lines.push('  <div class="stat-card">');
  lines.push(`    <div class="number">${data.opportunities.total}</div>`);
  lines.push('    <div class="label">机会发现</div>');
  lines.push('  </div>');
  lines.push('  <div class="stat-card">');
  lines.push(`    <div class="number">${data.derivatives.validated}</div>`);
  lines.push('    <div class="label">产品验证通过</div>');
  lines.push('  </div>');
  lines.push('  <div class="stat-card">');
  lines.push(`    <div class="number">$${data.cost.total.toFixed(2)}</div>`);
  lines.push('    <div class="label">今日成本</div>');
  lines.push('  </div>');
  lines.push('</div>');
  lines.push('');

  // Funnel
  const maxBar = data.signals.total || 1;
  const oppPct = Math.max(5, Math.round((data.opportunities.total / maxBar) * 100));
  const derivPct = Math.max(5, Math.round((data.derivatives.total / maxBar) * 100));
  const validPct = Math.max(5, Math.round((data.derivatives.validated / maxBar) * 100));

  lines.push('<div class="funnel">');
  lines.push('  <h2>Pipeline 转化漏斗</h2>');
  lines.push(`  <div class="funnel-bar"><span class="funnel-label">信号</span><div class="bar bar-signals" style="width:100%">${data.signals.total}</div></div>`);
  lines.push(`  <div class="funnel-bar"><span class="funnel-label">机会</span><div class="bar bar-opportunities" style="width:${oppPct}%">${data.opportunities.total}</div></div>`);
  lines.push(`  <div class="funnel-bar"><span class="funnel-label">衍生品</span><div class="bar bar-derivatives" style="width:${derivPct}%">${data.derivatives.total}</div></div>`);
  lines.push(`  <div class="funnel-bar"><span class="funnel-label">已验证</span><div class="bar bar-validated" style="width:${validPct}%">${data.derivatives.validated}</div></div>`);
  lines.push('</div>');
  lines.push('');

  // Opportunity Cards
  if (data.opportunities.topScoring.length > 0) {
    lines.push(`<h2 style="font-size:1.1em;color:var(--color-gray-700);margin:24px 0 12px;">重点机会</h2>`);
    lines.push('');

    for (const opp of data.opportunities.topScoring) {
      const score = typeof opp.score === 'number' ? opp.score : 0;
      const bd = opp.score_breakdown || {};
      const template = TEMPLATE_MAP[opp.recommended_template] || opp.recommended_template || '';
      const effort = EFFORT_MAP[opp.estimated_effort] || opp.estimated_effort || '';
      const windowDays = opp.window_closes_at
        ? Math.max(0, Math.ceil((new Date(opp.window_closes_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0;

      lines.push('<div class="opp-card">');

      // Header with Chinese title and score
      const displayTitle = opp.title_zh || opp.description_zh?.split('，')[0] || opp.title;
      lines.push('  <div class="card-header">');
      lines.push(`    <h3 class="card-title">${displayTitle}</h3>`);
      lines.push(`    <span class="card-score ${scoreClass(score)}">${score.toFixed(0)}</span>`);
      lines.push('  </div>');

      lines.push('  <div class="card-body">');

      // Score bar
      const dims = ['development_speed', 'monetization', 'seo_potential', 'business_viability', 'time_sensitivity', 'longtail_value', 'novelty'];
      const dimLabels: Record<string, string> = {
        development_speed: '开发速度',
        monetization: '变现',
        seo_potential: 'SEO',
        business_viability: '商业可行性',
        time_sensitivity: '时效性',
        longtail_value: '长尾价值',
        novelty: '新颖度',
      };
      lines.push('    <div class="score-bar-row">');
      for (const dim of dims) {
        const val = bd[dim] || 0;
        lines.push(`      <div class="score-segment ${scoreSegment(val)}" title="${dimLabels[dim]}: ${val}"></div>`);
      }
      lines.push('    </div>');

      // Description (Chinese preferred)
      const displayDesc = opp.description_zh || opp.description || '';
      lines.push(`    <p class="card-desc">${displayDesc}</p>`);

      // Tags
      lines.push('    <div class="tags">');
      lines.push(`      <span class="tag tag-keyword">${opp.target_keyword}</span>`);
      if (template) lines.push(`      <span class="tag tag-form">${template}</span>`);
      if (effort) lines.push(`      <span class="tag tag-effort">投入 ${effort}</span>`);
      if (windowDays > 0) lines.push(`      <span class="tag tag-window">窗口 ${windowDays} 天</span>`);
      const strategies = (opp.monetization_strategy || []).slice(0, 2);
      const strategyMap: Record<string, string> = { adsense: '广告', affiliate: '联盟', referral: '推荐', sponsored: '赞助' };
      for (const s of strategies) {
        // Extract just the core strategy type, strip long parenthetical details
        const core = s.split('(')[0].trim().split(' ')[0].toLowerCase();
        lines.push(`      <span class="tag tag-monetization">${strategyMap[core] || strategyMap[s] || s.split('(')[0].trim()}</span>`);
      }
      lines.push('    </div>');

      // Meta: key scores
      const metaParts = dims.map(d => `<span><strong>${dimLabels[d]}</strong> ${bd[d] || 0}</span>`).join(' ');
      lines.push(`    <div class="card-meta">${metaParts}</div>`);

      lines.push('  </div>');
      lines.push('</div>');
      lines.push('');
    }
  }

  // Derivatives — collapsible
  if (data.derivatives.topScoring.length > 0) {
    lines.push('<details>');
    lines.push(`  <summary>衍生产品候选（${data.derivatives.total} 个，${data.derivatives.validated} 个通过验证）</summary>`);
    lines.push('  <div class="details-body">');
    lines.push('    <table class="deriv-table">');
    lines.push('      <thead><tr><th>类型</th><th>产品名称</th><th>评分</th><th>竞争</th><th>工作量</th></tr></thead>');
    lines.push('      <tbody>');
    for (const d of data.derivatives.topScoring) {
      const dScore = typeof d.score === 'number' ? d.score.toFixed(0) : '?';
      const dType = DERIV_TYPE_MAP[d.derivative_type] || d.derivative_type;
      const comp = COMPETITION_MAP[d.competition_level] || '未知';
      const eff = EFFORT_MAP[d.build_effort] || d.build_effort || '';
      const status = d.status === 'validated' ? ' ✓' : d.status === 'rejected' ? ' ✗' : '';
      lines.push(`        <tr><td>${dType}</td><td>${d.title}${status}</td><td class="${scoreClass(d.score || 0)}">${dScore}</td><td>${comp}</td><td>${eff}</td></tr>`);
    }
    lines.push('      </tbody>');
    lines.push('    </table>');
    lines.push('  </div>');
    lines.push('</details>');
    lines.push('');
  }

  // Signal sources — collapsible
  const sourceEntries = Object.entries(data.signals.bySource);
  if (sourceEntries.length > 0) {
    lines.push('<details>');
    lines.push('  <summary>信号来源明细</summary>');
    lines.push('  <div class="details-body">');
    lines.push('    <table class="deriv-table">');
    lines.push('      <thead><tr><th>来源</th><th>数量</th></tr></thead>');
    lines.push('      <tbody>');
    for (const [source, count] of sourceEntries) {
      lines.push(`        <tr><td>${SOURCE_MAP[source] || source}</td><td>${count}</td></tr>`);
    }
    lines.push('      </tbody>');
    lines.push('    </table>');
    lines.push('  </div>');
    lines.push('</details>');
    lines.push('');
  }

  // Cost footer
  const agentCosts = Object.entries(data.cost.byAgent)
    .map(([agent, cost]) => `${agent}: $${cost.toFixed(2)}`)
    .join(' · ');
  lines.push('<div class="cost-footer">');
  lines.push(`  <span>成本：<strong>$${data.cost.total.toFixed(2)}</strong>（${data.cost.apiCalls} 次 API 调用）</span>`);
  if (agentCosts) lines.push(`  <span>${agentCosts}</span>`);
  lines.push('</div>');

  return lines.join('\n');
}

/**
 * Save report as HTML-Markdown file to docs/reports/
 */
function saveReport(data: DailyReportData, content: string): string | null {
  try {
    const docsDir = path.resolve(__dirname, '../../docs/reports');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }
    const filename = `${data.date}.md`;
    const filepath = path.join(docsDir, filename);
    fs.writeFileSync(filepath, content, 'utf-8');
    console.log(`[Report] 已保存: ${filepath}`);
    return filepath;
  } catch (error) {
    console.error('[Report] 保存失败:', error);
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

    const validated = data.derivatives.validated;
    const reportLink = `- [${data.date}](reports/${data.date}) — ${data.signals.total} 条信号, ${data.opportunities.total} 个机会, ${validated} 个已验证, $${data.cost.total.toFixed(2)}`;

    const startMarker = '<!-- REPORT_INDEX_START -->';
    const endMarker = '<!-- REPORT_INDEX_END -->';
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = content.substring(0, startIdx + startMarker.length);
      const existingContent = content.substring(startIdx + startMarker.length, endIdx).trim();
      const after = content.substring(endIdx);

      const existingLines = existingContent
        .split('\n')
        .filter(line => line.trim() && !line.includes('No reports yet') && !line.includes(`reports/${data.date})`));
      existingLines.unshift(reportLink);

      content = before + '\n' + existingLines.join('\n') + '\n' + after;
      fs.writeFileSync(indexPath, content, 'utf-8');
      console.log('[Report] 已更新 index.md');
    }
  } catch (error) {
    console.error('[Report] 更新索引失败:', error);
  }
}

/**
 * Send compact summary to Discord (Chinese, max 10 lines)
 */
async function sendToDiscord(data: DailyReportData): Promise<boolean> {
  if (!config.discord.webhookUrl) {
    console.log('[Report] 未配置 Discord webhook，跳过');
    return false;
  }

  try {
    const summary = generateExecutiveSummary(data);
    const lines: string[] = [];

    lines.push(`📊 **每日洞察 — ${data.date}**`);
    lines.push('');
    lines.push(`> ${summary.verdict}`);
    lines.push('');
    lines.push(`信号 **${data.signals.total}** → 机会 **${data.opportunities.total}** → 验证通过 **${data.derivatives.validated}** · 成本 $${data.cost.total.toFixed(2)}`);

    // Top 2 opportunities (only if valuable)
    const goodOpps = data.opportunities.topScoring.filter((o: any) => o.score >= 60);
    if (goodOpps.length > 0) {
      lines.push('');
      for (let i = 0; i < Math.min(2, goodOpps.length); i++) {
        const opp = goodOpps[i];
        const effort = EFFORT_MAP[opp.estimated_effort] || opp.estimated_effort;
        const discordTitle = opp.title_zh || opp.description_zh?.split('，')[0] || opp.title;
        lines.push(`${i + 1}. **${discordTitle}** (${opp.score.toFixed(0)}分) — \`${opp.target_keyword}\` · ${effort}`);
      }
    }

    // GitHub Pages link
    if (config.githubPages.baseUrl) {
      lines.push('');
      lines.push(`完整报告 → ${config.githubPages.baseUrl}/reports/${data.date}`);
    }

    const content = lines.join('\n');

    const response = await fetch(config.discord.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      console.error(`[Report] Discord 发送失败: ${response.status}`);
      return false;
    }

    console.log('[Report] 已推送至 Discord');
    return true;
  } catch (error) {
    console.error('[Report] Discord 错误:', error);
    return false;
  }
}

/**
 * Save report to database
 */
async function saveReportToDb(data: DailyReportData): Promise<void> {
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
      derivatives_validated: data.derivatives.validated,
      derivatives_rejected: data.derivatives.rejected,
    },
  }, { onConflict: 'report_date' });
}

/**
 * Generate and send daily report
 */
export async function generateDailyReport(): Promise<void> {
  console.log('[Report] === 生成每日报告 ===');

  const data = await gatherReportData();

  // Generate styled HTML report for GitHub Pages
  const html = formatFullHtml(data);
  saveReport(data, html);
  updateReportIndex(data);

  // Log summary
  const summary = generateExecutiveSummary(data);
  console.log(`[Report] ${summary.verdict}`);
  console.log(`[Report] ${summary.reasoning}`);
  console.log(`[Report] 信号: ${data.signals.total} | 机会: ${data.opportunities.total} | 验证通过: ${data.derivatives.validated} | 成本: $${data.cost.total.toFixed(2)}`);

  // Save to database
  await saveReportToDb(data);

  // Send compact summary to Discord
  await sendToDiscord(data);

  console.log('[Report] === 报告完成 ===');
}

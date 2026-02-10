/**
 * Worker - Main process
 * Express server + node-cron scheduling for Scout and Analyst agents
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cron from 'node-cron';
import { runScout } from '../agents/scout/index';
import { runAnalyst } from '../agents/analyst/index';
import { runDeriver } from '../agents/deriver/index';
import { runCompetitiveCheck } from '../agents/competitive/index';
import { runKeywordValidation } from '../agents/keyword-validator/index';
import { generateDailyReport } from '../reports/daily';
import { getTodayCostSummary, isDailyBudgetExceeded } from '../ai/cost-tracker';
import { config } from '../config';
import { supabaseAdmin } from '../db/supabase';

const app = express();
app.use(express.json());

// --- Health check ---
app.get('/health', async (_req, res) => {
  const cost = await getTodayCostSummary();
  const budget = await isDailyBudgetExceeded();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    cost: {
      today: `$${cost.total.toFixed(4)}`,
      limit: `$${budget.limit}`,
      exceeded: budget.exceeded,
      apiCalls: cost.apiCalls,
    },
  });
});

// --- Manual triggers ---
app.post('/trigger/scout', async (_req, res) => {
  try {
    const result = await runScout();
    res.json({ status: 'ok', result });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/trigger/analyst', async (_req, res) => {
  try {
    const result = await runAnalyst();
    res.json({ status: 'ok', result });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/trigger/report', async (_req, res) => {
  try {
    await generateDailyReport();
    res.json({ status: 'ok' });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/trigger/deriver', async (_req, res) => {
  try {
    const result = await runDeriver();
    res.json({ status: 'ok', result });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/trigger/competitive', async (_req, res) => {
  try {
    const result = await runCompetitiveCheck();
    res.json({ status: 'ok', result });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/trigger/keyword-validator', async (_req, res) => {
  try {
    const result = await runKeywordValidation();
    res.json({ status: 'ok', result });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// --- Read-only API endpoints ---

app.get('/api/opportunities', async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('opportunities')
      .select('id, title, slug, category, score, target_keyword, product_form, monetization_strategy, window_status, status, created_at')
      .order('score', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ status: 'ok', data });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/api/derivatives', async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('derived_products')
      .select('id, title, slug, derivative_type, parent_topic, target_keywords, product_form, score, competition_level, monetization_strategy, build_effort, status, created_at')
      .order('score', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ status: 'ok', data });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/api/derivatives/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('derived_products')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ status: 'error', message: 'Not found' });
    res.json({ status: 'ok', data });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// --- Cron schedules ---

// Scout: every 4 hours (rotates 2 sources per run)
// 0 */4 * * * = at minute 0 of every 4th hour
cron.schedule('0 */4 * * *', async () => {
  console.log(`[Cron] Scout triggered at ${new Date().toISOString()}`);
  try {
    await runScout();
  } catch (error) {
    console.error('[Cron] Scout error:', error);
  }
});

// Analyst: every 4 hours, offset by 30 min from Scout
// 30 */4 * * * = at minute 30 of every 4th hour
cron.schedule('30 */4 * * *', async () => {
  console.log(`[Cron] Analyst triggered at ${new Date().toISOString()}`);
  try {
    await runAnalyst();
  } catch (error) {
    console.error('[Cron] Analyst error:', error);
  }
});

// Daily report: every day at 21:00 UTC
cron.schedule('0 21 * * *', async () => {
  console.log(`[Cron] Daily report triggered at ${new Date().toISOString()}`);
  try {
    await generateDailyReport();
  } catch (error) {
    console.error('[Cron] Report error:', error);
  }
});

// Deriver: every 4 hours, offset by 90 min from Scout (runs after Analyst finishes)
cron.schedule('30 1,5,9,13,17,21 * * *', async () => {
  console.log(`[Cron] Deriver triggered at ${new Date().toISOString()}`);
  try {
    await runDeriver();
  } catch (error) {
    console.error('[Cron] Deriver error:', error);
  }
});

// Competitive check: every 4 hours, 30 min after Deriver
cron.schedule('0 2,6,10,14,18,22 * * *', async () => {
  console.log(`[Cron] Competitive check triggered at ${new Date().toISOString()}`);
  try {
    await runCompetitiveCheck();
  } catch (error) {
    console.error('[Cron] Competitive error:', error);
  }
});

// Keyword validation: every 4 hours, 30 min after Competitive check
cron.schedule('30 2,6,10,14,18,22 * * *', async () => {
  console.log(`[Cron] Keyword validation triggered at ${new Date().toISOString()}`);
  try {
    await runKeywordValidation();
  } catch (error) {
    console.error('[Cron] Keyword validation error:', error);
  }
});

// --- Start server ---
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`[Worker] Product Factory Worker running on port ${PORT}`);
  console.log(`[Worker] Cron schedules:`);
  console.log(`  Scout:       every 4h at :00`);
  console.log(`  Analyst:     every 4h at :30`);
  console.log(`  Deriver:     every 4h at :30 (offset 1h)`);
  console.log(`  Competitive: every 4h at :00 (offset 2h)`);
  console.log(`  Keywords:    every 4h at :30 (offset 2.5h)`);
  console.log(`  Report:      daily at 21:00 UTC`);
  console.log(`[Worker] Manual triggers:`);
  console.log(`  POST /trigger/scout`);
  console.log(`  POST /trigger/analyst`);
  console.log(`  POST /trigger/deriver`);
  console.log(`  POST /trigger/competitive`);
  console.log(`  POST /trigger/keyword-validator`);
  console.log(`  POST /trigger/report`);
  console.log(`[Worker] API endpoints:`);
  console.log(`  GET  /health`);
  console.log(`  GET  /api/opportunities`);
  console.log(`  GET  /api/derivatives`);
  console.log(`  GET  /api/derivatives/:id`);
});

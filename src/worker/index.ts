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
import { generateDailyReport } from '../reports/daily';
import { getTodayCostSummary, isDailyBudgetExceeded } from '../ai/cost-tracker';
import { config } from '../config';

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

// --- Start server ---
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`[Worker] Product Factory Worker running on port ${PORT}`);
  console.log(`[Worker] Cron schedules:`);
  console.log(`  Scout:   every 4h at :00`);
  console.log(`  Analyst: every 4h at :30`);
  console.log(`  Report:  daily at 21:00 UTC`);
  console.log(`[Worker] Manual triggers:`);
  console.log(`  POST /trigger/scout`);
  console.log(`  POST /trigger/analyst`);
  console.log(`  POST /trigger/report`);
  console.log(`  GET  /health`);
});

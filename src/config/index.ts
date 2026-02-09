import dotenv from 'dotenv';
dotenv.config();

export const config = {
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
  },
  port: parseInt(process.env.PORT || '3001', 10),
  dailyBudgetLimit: parseFloat(process.env.DAILY_BUDGET_LIMIT || '5'),

  // Scout schedule: which sources to check in each round
  scout: {
    intervalHours: 4,
    maxSignalsPerRound: 30,
    sources: ['github_trending', 'hackernews', 'producthunt', 'reddit'] as const,
  },

  // Analyst thresholds
  analyst: {
    minScoreToKeep: 50,       // Below this -> dismissed
    autoApproveScore: 80,     // Above this -> auto-approve (Phase 5)
    manualReviewScore: 60,    // Between 60-80 -> manual review
  },

  // Cost tracking
  cost: {
    haikuInputPer1k: 0.00025,
    haikuOutputPer1k: 0.00125,
    sonnetInputPer1k: 0.003,
    sonnetOutputPer1k: 0.015,
  },
} as const;

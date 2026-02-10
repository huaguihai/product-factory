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
    sources: ['google_trends', 'tech_media', 'twitter_trends', 'github_trending', 'hackernews', 'producthunt', 'reddit'] as const,
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

  // Deriver: demand derivation from opportunities
  deriver: {
    minScore: 55,                // Minimum opportunity score to derive from
    maxDerivativesPerTopic: 5,   // Max derivatives per opportunity
    minDerivativeScore: 40,      // Minimum derivative score to keep
    maxPerRun: 10,               // Max opportunities to process per run
  },

  // Competitive check: SERP analysis
  competitive: {
    serpApiKey: process.env.SERP_API_KEY || '',
    googleCseKey: process.env.GOOGLE_CSE_KEY || '',
    googleCseId: process.env.GOOGLE_CSE_ID || '',
    maxChecksPerRun: 10,
    bigSiteDomainThreshold: 7,   // If 7+ of top 10 are big sites, reject
  },

  // Keyword validation
  keywordValidator: {
    maxPerRun: 15,
  },

  // GitHub Pages reports
  githubPages: {
    baseUrl: process.env.GITHUB_PAGES_URL || 'https://huaguihai.github.io/product-factory',
  },
} as const;

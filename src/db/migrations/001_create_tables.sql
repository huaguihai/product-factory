-- Product Factory - Database Migration 001
-- Core tables for the discovery engine

-- 1. signals - Raw signals from data sources
CREATE TABLE IF NOT EXISTS signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  raw_data JSONB,
  source_created_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  stars INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  growth_rate FLOAT,
  status TEXT DEFAULT 'raw' CHECK (status IN ('raw', 'analyzed', 'dismissed')),
  content_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_source ON signals(source);
CREATE INDEX IF NOT EXISTS idx_signals_first_seen ON signals(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_content_hash ON signals(content_hash);

-- 2. opportunities - Evaluated opportunities
CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_ids UUID[] DEFAULT '{}',
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  target_keyword TEXT NOT NULL,
  score FLOAT NOT NULL DEFAULT 0,
  score_breakdown JSONB,
  window_opens_at TIMESTAMPTZ,
  window_closes_at TIMESTAMPTZ,
  window_status TEXT DEFAULT 'open' CHECK (window_status IN ('upcoming', 'open', 'closing', 'closed')),
  competitors JSONB DEFAULT '[]',
  search_volume INTEGER,
  recommended_template TEXT,
  recommended_features TEXT[],
  estimated_effort TEXT,
  status TEXT DEFAULT 'evaluated' CHECK (status IN (
    'evaluated', 'approved', 'in_progress', 'deployed', 'monitoring', 'archived', 'rejected'
  )),
  decision_reason TEXT,
  decided_at TIMESTAMPTZ,
  decided_by TEXT DEFAULT 'human',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_score ON opportunities(score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_window ON opportunities(window_status);

-- 3. projects - Generated sites
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES opportunities(id),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  domain TEXT,
  subdomain TEXT,
  template_id TEXT NOT NULL,
  template_config JSONB,
  locale TEXT DEFAULT 'en',
  content JSONB,
  pages JSONB DEFAULT '[]',
  github_repo TEXT,
  last_commit_sha TEXT,
  deploy_status TEXT DEFAULT 'draft' CHECK (deploy_status IN (
    'draft', 'generating', 'reviewing', 'deploying', 'live', 'failed', 'archived'
  )),
  deploy_url TEXT,
  deployed_at TIMESTAMPTZ,
  sitemap_submitted BOOLEAN DEFAULT FALSE,
  indexing_requested BOOLEAN DEFAULT FALSE,
  google_indexed BOOLEAN DEFAULT FALSE,
  metrics JSONB DEFAULT '{}',
  cost JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_deploy_status ON projects(deploy_status);
CREATE INDEX IF NOT EXISTS idx_projects_opportunity ON projects(opportunity_id);

-- 4. templates - Site templates registry
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  framework TEXT DEFAULT 'nextjs',
  github_repo TEXT,
  supports_i18n BOOLEAN DEFAULT TRUE,
  supports_adsense BOOLEAN DEFAULT TRUE,
  config_schema JSONB,
  usage_count INTEGER DEFAULT 0,
  avg_performance_score FLOAT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. agent_tasks - Task queue for agents
CREATE TABLE IF NOT EXISTS agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type TEXT NOT NULL,
  task_type TEXT NOT NULL,
  signal_id UUID REFERENCES signals(id),
  opportunity_id UUID REFERENCES opportunities(id),
  project_id UUID REFERENCES projects(id),
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  priority INTEGER DEFAULT 5,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  llm_model TEXT,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cost_usd FLOAT DEFAULT 0,
  current_stage TEXT,
  reserved_by TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON agent_tasks(agent_type, status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created ON agent_tasks(created_at DESC);

-- 6. daily_reports - Daily summary reports
CREATE TABLE IF NOT EXISTS daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL UNIQUE,
  signals_collected INTEGER DEFAULT 0,
  opportunities_found INTEGER DEFAULT 0,
  top_opportunities JSONB DEFAULT '[]',
  projects_generated INTEGER DEFAULT 0,
  projects_deployed INTEGER DEFAULT 0,
  total_pageviews INTEGER DEFAULT 0,
  total_revenue FLOAT DEFAULT 0,
  total_llm_cost FLOAT DEFAULT 0,
  total_api_calls INTEGER DEFAULT 0,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. cost_tracking - LLM cost tracking
CREATE TABLE IF NOT EXISTS cost_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  agent_type TEXT NOT NULL,
  llm_model TEXT NOT NULL,
  api_calls INTEGER DEFAULT 0,
  tokens_input BIGINT DEFAULT 0,
  tokens_output BIGINT DEFAULT 0,
  cost_usd FLOAT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, agent_type, llm_model)
);

CREATE INDEX IF NOT EXISTS idx_cost_date ON cost_tracking(date DESC);

-- 8. ai_api_keys - AI service pool (same structure as the-git-mind)
CREATE TABLE IF NOT EXISTS ai_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  key_value TEXT NOT NULL,
  base_url TEXT,
  allowed_models TEXT[],
  is_active BOOLEAN DEFAULT TRUE,
  error_count INTEGER DEFAULT 0,
  total_requests INTEGER DEFAULT 0,
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,
  last_used_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. system_config - Key-value config store
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial system config
INSERT INTO system_config (key, value) VALUES
  ('daily_budget_limit', '5'),
  ('scout_enabled', 'true'),
  ('analyst_enabled', 'true'),
  ('auto_approve_threshold', '80'),
  ('manual_review_threshold', '60')
ON CONFLICT (key) DO NOTHING;

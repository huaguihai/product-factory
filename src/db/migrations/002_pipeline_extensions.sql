-- Product Factory - Database Migration 002
-- Pipeline extensions for demand derivation and product generation

-- 1. Extend opportunities table for derivation tracking
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS opportunity_type TEXT DEFAULT 'direct'
  CHECK (opportunity_type IN ('direct', 'derivative'));
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS derivative_category TEXT
  CHECK (derivative_category IN (
    'tutorial', 'comparison', 'directory', 'tool', 'prompt_guide',
    'template_gallery', 'cheatsheet', 'aggregator', 'calculator', 'landing_page'
  ));
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS product_form TEXT DEFAULT 'website'
  CHECK (product_form IN ('website', 'mini_program', 'both'));
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS seo_data JSONB DEFAULT '{}';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS competitive_data JSONB DEFAULT '{}';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS longtail_score FLOAT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS secondary_keywords TEXT[] DEFAULT '{}';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS monetization_strategy TEXT[] DEFAULT '{}';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS derivative_suggestions TEXT[] DEFAULT '{}';

-- 2. derived_products - Derivative product ideas from hot topics
CREATE TABLE IF NOT EXISTS derived_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES opportunities(id),
  signal_id UUID,
  parent_topic TEXT NOT NULL,
  derivative_type TEXT NOT NULL CHECK (derivative_type IN (
    'tutorial', 'comparison', 'directory', 'tool', 'prompt_guide',
    'template_gallery', 'cheatsheet', 'aggregator', 'calculator', 'landing_page'
  )),
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  target_keywords TEXT[] DEFAULT '{}',
  product_form TEXT DEFAULT 'website' CHECK (product_form IN ('website', 'mini_program', 'both')),
  estimated_search_volume TEXT DEFAULT 'unknown' CHECK (estimated_search_volume IN ('high', 'medium', 'low', 'unknown')),
  competition_level TEXT DEFAULT 'unknown' CHECK (competition_level IN ('low', 'medium', 'high', 'unknown')),
  monetization_strategy TEXT[] DEFAULT '{}',
  build_effort TEXT DEFAULT '1d' CHECK (build_effort IN ('2h', '4h', '1d', '2d', '3d')),
  ai_reasoning TEXT,
  score FLOAT DEFAULT 0,
  score_breakdown JSONB DEFAULT '{}',
  status TEXT DEFAULT 'derived' CHECK (status IN (
    'derived', 'validated', 'planned', 'generating', 'deployed', 'monitoring', 'archived', 'rejected'
  )),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_derived_products_status ON derived_products(status);
CREATE INDEX IF NOT EXISTS idx_derived_products_opportunity ON derived_products(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_derived_products_score ON derived_products(score DESC);
CREATE INDEX IF NOT EXISTS idx_derived_products_slug ON derived_products(slug);

-- 3. Add pipeline_stage to agent_tasks
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS pipeline_stage TEXT;

-- 4. Extend daily_reports for derivative tracking
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS derivatives_created INTEGER DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS derivatives_validated INTEGER DEFAULT 0;

-- 5. Seed new system config entries
INSERT INTO system_config (key, value) VALUES
  ('derivation_enabled', 'true'),
  ('max_derivatives_per_topic', '5'),
  ('min_opportunity_score_for_derivation', '55'),
  ('competitive_check_enabled', 'false'),
  ('keyword_validation_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

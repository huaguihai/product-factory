-- Product Factory - Database Migration 003
-- Validation tables for competitive analysis and keyword verification

-- 1. competitive_checks - SERP analysis results for derivative products
CREATE TABLE IF NOT EXISTS competitive_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  derived_product_id UUID REFERENCES derived_products(id),
  keyword TEXT NOT NULL,
  serp_results JSONB DEFAULT '[]',
  big_site_count INTEGER DEFAULT 0,
  small_site_count INTEGER DEFAULT 0,
  content_gap_found BOOLEAN DEFAULT FALSE,
  difficulty_assessment TEXT CHECK (difficulty_assessment IN ('easy', 'moderate', 'hard', 'very_hard')),
  ai_analysis TEXT,
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_competitive_checks_derived ON competitive_checks(derived_product_id);

-- 2. keyword_validations - Search volume and difficulty data
CREATE TABLE IF NOT EXISTS keyword_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  derived_product_id UUID REFERENCES derived_products(id),
  keyword TEXT NOT NULL,
  autocomplete_count INTEGER DEFAULT 0,
  autocomplete_suggestions TEXT[] DEFAULT '{}',
  search_volume_estimate TEXT DEFAULT 'unknown' CHECK (search_volume_estimate IN ('high', 'medium', 'low', 'none', 'unknown')),
  keyword_difficulty TEXT DEFAULT 'unknown' CHECK (keyword_difficulty IN ('easy', 'moderate', 'hard', 'unknown')),
  cpc_estimate FLOAT,
  trend_direction TEXT DEFAULT 'unknown' CHECK (trend_direction IN ('rising', 'stable', 'declining', 'unknown')),
  data_source TEXT DEFAULT 'google_autocomplete',
  validated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_keyword_validations_derived ON keyword_validations(derived_product_id);

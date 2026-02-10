-- Product Factory - Database Migration 004
-- Add Chinese content columns and clean up old data

-- Add Chinese title and description columns
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS title_zh TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS description_zh TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS recommended_features_zh TEXT[] DEFAULT '{}';

-- Archive old duplicate Discord verification opportunities
-- Keep only the highest-scoring one
UPDATE opportunities
SET status = 'archived',
    decision_reason = 'Duplicate topic: Discord verification (auto-cleanup)'
WHERE title ILIKE '%discord%verif%'
  AND id NOT IN (
    SELECT id FROM opportunities
    WHERE title ILIKE '%discord%verif%'
    ORDER BY score DESC
    LIMIT 1
  );

-- Archive opportunities without business_viability score (pre-fix data)
-- These were created before the business viability check was added
UPDATE opportunities
SET status = 'archived',
    decision_reason = 'Pre-viability-check data (auto-cleanup)'
WHERE (score_breakdown->>'business_viability') IS NULL
  AND status = 'evaluated';

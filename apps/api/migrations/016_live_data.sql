-- Live data (OpenRouter + Artificial Analysis indices via OpenRouter).
-- The intelligence index is only published for some models: allow it to be missing.
ALTER TABLE ai_model ALTER COLUMN reasoning_score DROP NOT NULL;
ALTER TABLE benchmark ALTER COLUMN reasoning_score DROP NOT NULL;

-- Stable identifier from the source (e.g. 'openrouter:anthropic/claude-haiku-5.5'):
-- names change between releases, ids don't.
ALTER TABLE ai_model ADD COLUMN external_id text;
CREATE UNIQUE INDEX ai_model_external_id_key ON ai_model (external_id) WHERE external_id IS NOT NULL;

-- A source kind that speaks the OpenRouter public models API directly.
ALTER TABLE ingestion_source DROP CONSTRAINT ingestion_source_kind_check;
ALTER TABLE ingestion_source ADD CONSTRAINT ingestion_source_kind_check CHECK (kind IN ('FILE', 'HTTP', 'OPENROUTER'));

-- Ingestion may retire models that disappear from their source.
ALTER TABLE data_quality_issue DROP CONSTRAINT data_quality_issue_kind_check;
ALTER TABLE data_quality_issue ADD CONSTRAINT data_quality_issue_kind_check CHECK (kind IN ('INVALID_RECORD', 'MISSING_FIELDS', 'PRICE_JUMP', 'BENCHMARK_JUMP', 'STALE_DATA', 'SOURCE_ERROR', 'MODEL_REMOVED'));

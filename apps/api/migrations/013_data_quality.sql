-- Data-quality review queue (proposal §4.1 admin dashboard, §10 risks).
CREATE TABLE data_quality_issue (
  issue_id    bigserial PRIMARY KEY,
  model_id    bigint      REFERENCES ai_model (model_id) ON DELETE CASCADE,
  run_id      bigint      REFERENCES ingestion_run (run_id) ON DELETE SET NULL,
  kind        text        NOT NULL CHECK (kind IN ('INVALID_RECORD', 'MISSING_FIELDS', 'PRICE_JUMP', 'BENCHMARK_JUMP', 'STALE_DATA', 'SOURCE_ERROR')),
  severity    text        NOT NULL CHECK (severity IN ('WARNING', 'ERROR')),
  message     text        NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  resolved_by bigint      REFERENCES app_user (user_id) ON DELETE SET NULL
);
-- At most one open issue of a kind per model.
CREATE UNIQUE INDEX data_quality_open_key ON data_quality_issue (model_id, kind) WHERE resolved_at IS NULL AND model_id IS NOT NULL;
CREATE INDEX data_quality_open_idx ON data_quality_issue (detected_at DESC) WHERE resolved_at IS NULL;

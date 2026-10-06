-- Append-only.
CREATE TABLE benchmark (
  benchmark_id    bigserial PRIMARY KEY,
  model_id        bigint      NOT NULL REFERENCES ai_model (model_id) ON DELETE RESTRICT,
  coding_score    smallint    NOT NULL CHECK (coding_score BETWEEN 0 AND 100),
  reasoning_score smallint    NOT NULL CHECK (reasoning_score BETWEEN 0 AND 100),
  source          text        NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX benchmark_model_idx ON benchmark (model_id, recorded_at DESC);

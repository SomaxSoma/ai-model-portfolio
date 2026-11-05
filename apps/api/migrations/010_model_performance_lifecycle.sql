-- Proposal §3: latency, reliability and lifecycle policy per model.
-- All nullable: a source may not publish them, and the UI shows "Not available".
ALTER TABLE ai_model
  ADD COLUMN latency_ms       integer      CHECK (latency_ms > 0),
  ADD COLUMN reliability      numeric(5,2) CHECK (reliability BETWEEN 0 AND 100),
  ADD COLUMN deprecation_date date,
  -- Data freshness: when a source last confirmed this model's figures.
  ADD COLUMN last_verified_at timestamptz  NOT NULL DEFAULT now();

-- Performance measurements are kept with benchmark history (append-only).
ALTER TABLE benchmark
  ADD COLUMN latency_ms  integer      CHECK (latency_ms > 0),
  ADD COLUMN reliability numeric(5,2) CHECK (reliability BETWEEN 0 AND 100);

-- Alerts look up portfolios by model.
CREATE INDEX portfolio_model_model_idx ON portfolio_model (model_id);

-- allocations: snapshot of the engine's output so GET /recommendations/{id}
-- re-opens it without recomputing against a catalogue that may have changed.
CREATE TABLE recommendation (
  recommendation_id bigserial PRIMARY KEY,
  workload_id       bigint        NOT NULL REFERENCES workload (workload_id) ON DELETE CASCADE,
  portfolio_id      bigint        REFERENCES portfolio (portfolio_id) ON DELETE SET NULL,
  estimated_cost    numeric(18,4) NOT NULL CHECK (estimated_cost >= 0),
  score             numeric(5,2)  NOT NULL CHECK (score BETWEEN 0 AND 100),
  reason            text          NOT NULL,
  within_budget     boolean       NOT NULL,
  adjusted          boolean       NOT NULL,
  allocations       jsonb         NOT NULL CHECK (jsonb_typeof(allocations) = 'array'),
  created_at        timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX recommendation_workload_idx ON recommendation (workload_id);

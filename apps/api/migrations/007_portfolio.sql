-- workload_id: the server needs the workload's volumes to recompute every
-- allocation's cost on save (see DECISIONS.md).
CREATE TABLE portfolio (
  portfolio_id bigserial PRIMARY KEY,
  user_id      bigint        NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  workload_id  bigint        NOT NULL REFERENCES workload (workload_id) ON DELETE CASCADE,
  name         text          NOT NULL,
  budget       numeric(12,4) NOT NULL CHECK (budget > 0),
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX portfolio_user_idx ON portfolio (user_id, updated_at DESC);

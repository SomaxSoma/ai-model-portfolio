-- Junction with attributes. estimated_cost is a computed cost (volume x
-- price), so it gets more integer digits than a price or budget does.
CREATE TABLE portfolio_model (
  portfolio_model_id    bigserial PRIMARY KEY,
  portfolio_id          bigint        NOT NULL REFERENCES portfolio (portfolio_id) ON DELETE CASCADE,
  model_id              bigint        NOT NULL REFERENCES ai_model (model_id) ON DELETE RESTRICT,
  allocation_percentage smallint      NOT NULL CHECK (allocation_percentage BETWEEN 0 AND 100),
  estimated_cost        numeric(18,4) NOT NULL CHECK (estimated_cost >= 0),
  UNIQUE (portfolio_id, model_id)
);

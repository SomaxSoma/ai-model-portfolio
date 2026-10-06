-- input_price, output_price, coding_score and reasoning_score are a read
-- optimisation: they duplicate the newest PRICING_HISTORY / BENCHMARK rows and
-- are only ever written together with a history row, in one transaction
-- (see catalogue repository: recordPricing / recordBenchmark).
CREATE TABLE ai_model (
  model_id        bigserial PRIMARY KEY,
  provider_id     bigint        NOT NULL REFERENCES provider (provider_id) ON DELETE RESTRICT,
  name            text          NOT NULL,
  version         text          NOT NULL DEFAULT '',
  context_window  integer       NOT NULL CHECK (context_window > 0),
  input_price     numeric(12,4) NOT NULL CHECK (input_price >= 0),
  output_price    numeric(12,4) NOT NULL CHECK (output_price >= 0),
  coding_score    smallint      NOT NULL CHECK (coding_score BETWEEN 0 AND 100),
  reasoning_score smallint      NOT NULL CHECK (reasoning_score BETWEEN 0 AND 100),
  status          text          NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  capabilities    jsonb         NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(capabilities) = 'array'),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (provider_id, name, version)
);
CREATE INDEX ai_model_provider_idx ON ai_model (provider_id);

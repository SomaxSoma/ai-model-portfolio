-- Append-only.
CREATE TABLE pricing_history (
  history_id   bigserial PRIMARY KEY,
  model_id     bigint        NOT NULL REFERENCES ai_model (model_id) ON DELETE RESTRICT,
  input_price  numeric(12,4) NOT NULL CHECK (input_price >= 0),
  output_price numeric(12,4) NOT NULL CHECK (output_price >= 0),
  source       text          NOT NULL,
  recorded_at  timestamptz   NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX pricing_history_model_idx ON pricing_history (model_id, recorded_at DESC);

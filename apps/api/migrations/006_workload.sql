CREATE TABLE workload (
  workload_id           bigserial PRIMARY KEY,
  user_id               bigint        NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  name                  text          NOT NULL,
  input_tokens          integer       NOT NULL CHECK (input_tokens > 0),
  output_tokens         integer       NOT NULL CHECK (output_tokens > 0),
  requests_per_month    integer       NOT NULL CHECK (requests_per_month > 0),
  budget                numeric(12,4) NOT NULL CHECK (budget > 0),
  required_capabilities jsonb         NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(required_capabilities) = 'array'),
  created_at            timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX workload_user_idx ON workload (user_id, created_at DESC);

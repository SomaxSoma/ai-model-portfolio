-- Prompt-cache pricing, benchmark choice, provider headquarters, and account
-- features (demo accounts, sign-in without a password, password resets,
-- email alerts).

-- Price per 1M input tokens served from the provider's prompt cache (null = not published).
ALTER TABLE ai_model ADD COLUMN cache_read_price numeric(12,4) CHECK (cache_read_price IS NULL OR cache_read_price >= 0);
ALTER TABLE pricing_history ADD COLUMN cache_read_price numeric(12,4) CHECK (cache_read_price IS NULL OR cache_read_price >= 0);

-- Workload: share of input tokens read from cache, and which benchmark stands for quality.
ALTER TABLE workload ADD COLUMN cached_input_percent integer NOT NULL DEFAULT 0 CHECK (cached_input_percent BETWEEN 0 AND 100);
ALTER TABLE workload ADD COLUMN quality_basis text NOT NULL DEFAULT 'BLENDED' CHECK (quality_basis IN ('BLENDED', 'CODING', 'INTELLIGENCE'));

-- Provider headquarters (ISO 3166-1 alpha-2). Where the company is based, not where data is processed.
ALTER TABLE provider ADD COLUMN hq_country char(2) CHECK (hq_country IS NULL OR hq_country ~ '^[A-Z]{2}$');
UPDATE provider SET hq_country = v.cc
  FROM (VALUES
    ('openai', 'US'), ('anthropic', 'US'), ('google', 'US'), ('meta', 'US'), ('meta-llama', 'US'), ('x-ai', 'US'), ('xai', 'US'),
    ('amazon', 'US'), ('microsoft', 'US'), ('nvidia', 'US'), ('ibm', 'US'), ('perplexity', 'US'), ('inception', 'US'), ('liquid', 'US'),
    ('nousresearch', 'US'), ('nous research', 'US'), ('arcee', 'US'), ('arcee ai', 'US'), ('deep cogito', 'US'),
    ('mistral', 'FR'), ('mistral ai', 'FR'), ('mistralai', 'FR'),
    ('cohere', 'CA'), ('ai21', 'IL'), ('ai21 labs', 'IL'),
    ('deepseek', 'CN'), ('qwen', 'CN'), ('alibaba', 'CN'), ('moonshotai', 'CN'), ('moonshot ai', 'CN'), ('z.ai', 'CN'), ('zhipu', 'CN'),
    ('minimax', 'CN'), ('baidu', 'CN'), ('tencent', 'CN'), ('bytedance', 'CN'), ('bytedance seed', 'CN'), ('stepfun', 'CN'),
    ('xiaomi', 'CN'), ('inclusionai', 'CN'), ('meituan', 'CN'), ('thudm', 'CN'),
    ('spacexai', 'US'), ('liquidai', 'US'), ('thinking machines', 'US'), ('upstage', 'KR')
  ) AS v(name, cc)
 WHERE lower(provider.name) = v.name AND provider.hq_country IS NULL;

-- Accounts: demo accounts are disposable; sign-in-only accounts (Google/GitHub) have no password.
ALTER TABLE app_user ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE app_user ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE app_user ADD COLUMN email_alerts boolean NOT NULL DEFAULT false;
CREATE INDEX app_user_demo_idx ON app_user (created_at) WHERE is_demo;

-- Linked sign-in providers (one row per provider account).
CREATE TABLE user_identity (
  identity_id  bigserial PRIMARY KEY,
  user_id      bigint      NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  provider     text        NOT NULL CHECK (provider IN ('google', 'github')),
  subject      text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX user_identity_user_idx ON user_identity (user_id);

-- Password reset: only a SHA-256 of the token is stored; single use; short-lived.
CREATE TABLE password_reset (
  reset_id    bigserial PRIMARY KEY,
  user_id     bigint      NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_user_idx ON password_reset (user_id, created_at DESC);

-- Tokens carry the session version they were issued under; a password reset
-- bumps it, which signs the account out everywhere.
ALTER TABLE app_user ADD COLUMN session_version integer NOT NULL DEFAULT 0;

-- Email alert digests: when a notification was included in one.
ALTER TABLE notification ADD COLUMN emailed_at timestamptz;

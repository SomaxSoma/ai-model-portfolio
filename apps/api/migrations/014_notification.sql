-- In-app alerts (proposal §9.2). No email or push: notifications live in the app.
CREATE TABLE notification (
  notification_id bigserial PRIMARY KEY,
  user_id         bigint      NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  kind            text        NOT NULL CHECK (kind IN ('COST_CHANGE', 'OVER_BUDGET', 'MODEL_RETIRED', 'MODEL_DEPRECATION', 'INGESTION_FAILED', 'DATA_QUALITY')),
  severity        text        NOT NULL CHECK (severity IN ('INFO', 'WARNING')),
  title           text        NOT NULL,
  body            text        NOT NULL,
  link            text,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at         timestamptz
);
CREATE INDEX notification_user_idx ON notification (user_id, created_at DESC);
CREATE INDEX notification_unread_idx ON notification (user_id) WHERE read_at IS NULL;

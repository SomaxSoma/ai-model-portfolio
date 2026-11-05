-- Data ingestion layer (proposal §4.2 step 1).
CREATE TABLE ingestion_source (
  source_id        bigserial PRIMARY KEY,
  name             text        NOT NULL,
  kind             text        NOT NULL CHECK (kind IN ('FILE', 'HTTP')),
  location         text        NOT NULL,
  enabled          boolean     NOT NULL DEFAULT true,
  schedule_minutes integer     NOT NULL DEFAULT 60 CHECK (schedule_minutes BETWEEN 5 AND 10080),
  last_run_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ingestion_source_name_key ON ingestion_source (lower(name));

CREATE TABLE ingestion_run (
  run_id          bigserial PRIMARY KEY,
  source_id       bigint      NOT NULL REFERENCES ingestion_source (source_id) ON DELETE CASCADE,
  trigger         text        NOT NULL CHECK (trigger IN ('SCHEDULE', 'MANUAL')),
  status          text        NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  started_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at     timestamptz,
  records_seen    integer     NOT NULL DEFAULT 0,
  models_created  integer     NOT NULL DEFAULT 0,
  models_updated  integer     NOT NULL DEFAULT 0,
  records_rejected integer    NOT NULL DEFAULT 0,
  issues_found    integer     NOT NULL DEFAULT 0,
  error           text
);
CREATE INDEX ingestion_run_source_idx ON ingestion_run (source_id, started_at DESC);

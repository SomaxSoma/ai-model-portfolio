CREATE TABLE provider (
  provider_id bigserial PRIMARY KEY,
  name        text        NOT NULL,
  website     text,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX provider_name_key ON provider (lower(name));

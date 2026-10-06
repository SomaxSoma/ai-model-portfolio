-- USER. Named app_user because "user" is reserved in PostgreSQL.
-- Admin is a role on this table, not a separate entity.
CREATE TABLE app_user (
  user_id       bigserial PRIMARY KEY,
  name          text        NOT NULL CHECK (length(trim(name)) >= 2),
  email         text        NOT NULL,
  password_hash text        NOT NULL,
  role          text        NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_user_email_key ON app_user (lower(email));

-- Team workspaces: people who plan together. A portfolio can be shared with
-- one team; its members can open, edit and stress-test it.

CREATE TABLE team (
  team_id     bigserial PRIMARY KEY,
  name        text        NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  created_by  bigint      REFERENCES app_user (user_id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_member (
  team_id    bigint      NOT NULL REFERENCES team (team_id) ON DELETE CASCADE,
  user_id    bigint      NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'MEMBER')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_member_user_idx ON team_member (user_id);

-- Invitations by email address; the invitee accepts after signing in with that address.
CREATE TABLE team_invite (
  invite_id     bigserial PRIMARY KEY,
  team_id       bigint      NOT NULL REFERENCES team (team_id) ON DELETE CASCADE,
  email         text        NOT NULL,
  invited_by    bigint      REFERENCES app_user (user_id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  accepted      boolean
);
CREATE UNIQUE INDEX team_invite_pending_key ON team_invite (team_id, lower(email)) WHERE responded_at IS NULL;
CREATE INDEX team_invite_email_idx ON team_invite (lower(email)) WHERE responded_at IS NULL;

ALTER TABLE portfolio ADD COLUMN team_id bigint REFERENCES team (team_id) ON DELETE SET NULL;
CREATE INDEX portfolio_team_idx ON portfolio (team_id) WHERE team_id IS NOT NULL;

ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check
  CHECK (kind IN ('COST_CHANGE', 'OVER_BUDGET', 'MODEL_RETIRED', 'MODEL_DEPRECATION', 'INGESTION_FAILED', 'DATA_QUALITY', 'TEAM_INVITE'));

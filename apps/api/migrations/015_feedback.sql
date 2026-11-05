-- Pilot validation (proposal §6.3): clarity rating and the user's prior model choice.
CREATE TABLE feedback (
  feedback_id       bigserial PRIMARY KEY,
  user_id           bigint      NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  recommendation_id bigint      NOT NULL REFERENCES recommendation (recommendation_id) ON DELETE CASCADE,
  clarity_rating    smallint    NOT NULL CHECK (clarity_rating BETWEEN 1 AND 5),
  prior_model_id    bigint      REFERENCES ai_model (model_id) ON DELETE SET NULL,
  comment           text        CHECK (length(comment) <= 2000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, recommendation_id)
);

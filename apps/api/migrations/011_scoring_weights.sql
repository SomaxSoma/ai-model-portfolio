-- Configurable ranking factors (proposal §5.1). NULL = default 60/40 quality:cost.
ALTER TABLE workload ADD COLUMN scoring_weights jsonb CHECK (scoring_weights IS NULL OR jsonb_typeof(scoring_weights) = 'object');
ALTER TABLE recommendation ADD COLUMN scoring_weights jsonb CHECK (scoring_weights IS NULL OR jsonb_typeof(scoring_weights) = 'object');

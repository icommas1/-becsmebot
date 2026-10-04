CREATE TABLE IF NOT EXISTS superagent_observer_scopes (
  scope_id text PRIMARY KEY,
  binding jsonb NOT NULL,
  event_sequence bigint NOT NULL DEFAULT 0 CHECK (event_sequence >= 0),
  event_hash text,
  archive_sequence bigint NOT NULL DEFAULT 0 CHECK (archive_sequence >= 0),
  archive_hash text
);
CREATE TABLE IF NOT EXISTS superagent_observer_events (
  scope_id text NOT NULL REFERENCES superagent_observer_scopes(scope_id),
  event_id uuid NOT NULL,
  sequence bigint NOT NULL,
  event_hash text NOT NULL,
  evidence jsonb NOT NULL,
  PRIMARY KEY(scope_id,event_id), UNIQUE(scope_id,sequence)
);
CREATE TABLE IF NOT EXISTS superagent_observer_purchases (
  scope_id text NOT NULL REFERENCES superagent_observer_scopes(scope_id),
  purchase_id uuid NOT NULL,
  sequence bigint NOT NULL,
  asset text NOT NULL,
  occurred_at bigint NOT NULL,
  evidence jsonb NOT NULL,
  PRIMARY KEY(scope_id,purchase_id), UNIQUE(scope_id,sequence)
);
CREATE TABLE IF NOT EXISTS superagent_observer_outcomes (
  scope_id text NOT NULL,
  purchase_id uuid NOT NULL,
  source_key text NOT NULL,
  observed_at bigint NOT NULL,
  evidence jsonb NOT NULL,
  PRIMARY KEY(scope_id,purchase_id,source_key),
  FOREIGN KEY(scope_id,purchase_id) REFERENCES superagent_observer_purchases(scope_id,purchase_id)
);
CREATE INDEX IF NOT EXISTS superagent_outcomes_report_page
  ON superagent_observer_outcomes(scope_id,observed_at,purchase_id,source_key);
CREATE OR REPLACE FUNCTION superagent_observer_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''SuperAgent observations are append-only''; END;';
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['superagent_observer_events','superagent_observer_purchases','superagent_observer_outcomes'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=name::regclass AND tgname='superagent_append_only') THEN
      EXECUTE format('CREATE TRIGGER superagent_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION superagent_observer_reject_mutation()',name);
      EXECUTE format('CREATE TRIGGER superagent_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION superagent_observer_reject_mutation()',name);
    END IF;
  END LOOP;
END $$;

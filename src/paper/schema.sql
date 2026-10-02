CREATE TABLE IF NOT EXISTS paper_accounts (
  user_id text PRIMARY KEY,
  account_id text NOT NULL UNIQUE,
  ledger jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  replay_before bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS paper_requests (
  user_id text NOT NULL REFERENCES paper_accounts(user_id),
  request_id uuid NOT NULL,
  fingerprint text NOT NULL,
  created_at bigint NOT NULL,
  sequence bigint NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY(user_id, request_id)
);
CREATE INDEX IF NOT EXISTS paper_requests_sequence ON paper_requests(user_id,sequence);
CREATE TABLE IF NOT EXISTS paper_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES paper_accounts(user_id),
  expires_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_oauth_flows (
  state_hash text PRIMARY KEY,
  verifier text NOT NULL,
  expires_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS becs_event_streams (
  stream_id text PRIMARY KEY,
  head_sequence bigint NOT NULL DEFAULT 0,
  head_hash text,
  event_count bigint NOT NULL DEFAULT 0,
  CHECK (head_sequence >= 0),
  CHECK (event_count >= 0),
  CHECK (head_hash IS NULL OR head_hash ~ '^[0-9a-f]{64}$')
);
CREATE TABLE IF NOT EXISTS becs_events (
  event_id uuid PRIMARY KEY,
  stream_id text NOT NULL REFERENCES becs_event_streams(stream_id),
  sequence bigint NOT NULL CHECK (sequence > 0),
  occurred_at bigint NOT NULL CHECK (occurred_at >= 0),
  type text NOT NULL,
  source text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  previous_hash text CHECK (previous_hash IS NULL OR previous_hash ~ '^[0-9a-f]{64}$'),
  event_hash text NOT NULL UNIQUE CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  request_id uuid,
  account_id text,
  strategy_id text,
  strategy_version text,
  UNIQUE(stream_id, sequence)
);
CREATE INDEX IF NOT EXISTS becs_events_stream_time ON becs_events(stream_id,occurred_at DESC,sequence DESC);
CREATE INDEX IF NOT EXISTS becs_events_request ON becs_events(stream_id,request_id) WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS becs_event_proofs (
  proof_id uuid PRIMARY KEY,
  stream_id text NOT NULL REFERENCES becs_event_streams(stream_id),
  first_sequence bigint NOT NULL CHECK (first_sequence > 0),
  last_sequence bigint NOT NULL CHECK (last_sequence >= first_sequence),
  event_count integer NOT NULL CHECK (event_count > 0),
  root_hash text NOT NULL CHECK (root_hash ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL,
  proof jsonb NOT NULL,
  created_at bigint NOT NULL CHECK (created_at >= 0),
  UNIQUE(stream_id,first_sequence,last_sequence,provider)
);
CREATE INDEX IF NOT EXISTS becs_event_proofs_stream ON becs_event_proofs(stream_id,last_sequence DESC);

CREATE OR REPLACE FUNCTION becs_reject_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''BecsEvent records are append-only''; END;';

DROP TRIGGER IF EXISTS becs_events_append_only ON becs_events;
CREATE TRIGGER becs_events_append_only
  BEFORE UPDATE OR DELETE ON becs_events
  FOR EACH ROW EXECUTE FUNCTION becs_reject_append_only_mutation();

DROP TRIGGER IF EXISTS becs_event_proofs_append_only ON becs_event_proofs;
CREATE TRIGGER becs_event_proofs_append_only
  BEFORE UPDATE OR DELETE ON becs_event_proofs
  FOR EACH ROW EXECUTE FUNCTION becs_reject_append_only_mutation();

DROP TRIGGER IF EXISTS becs_events_no_truncate ON becs_events;
CREATE TRIGGER becs_events_no_truncate BEFORE TRUNCATE ON becs_events
  FOR EACH STATEMENT EXECUTE FUNCTION becs_reject_append_only_mutation();
DROP TRIGGER IF EXISTS becs_event_proofs_no_truncate ON becs_event_proofs;
CREATE TRIGGER becs_event_proofs_no_truncate BEFORE TRUNCATE ON becs_event_proofs
  FOR EACH STATEMENT EXECUTE FUNCTION becs_reject_append_only_mutation();

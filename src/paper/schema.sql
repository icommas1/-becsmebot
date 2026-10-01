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

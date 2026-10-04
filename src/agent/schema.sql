CREATE TABLE IF NOT EXISTS agent_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  candidate_count integer NOT NULL DEFAULT 0 CHECK(candidate_count>=0)
);
INSERT INTO agent_control(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS agent_candidates (
  bundle_hash text PRIMARY KEY CHECK(bundle_hash ~ '^[a-f0-9]{64}$'),
  owner_id text NOT NULL, bundle jsonb NOT NULL, created_at bigint NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  status text NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','reviewed'))
);
CREATE TABLE IF NOT EXISTS agent_daily_budgets (
  day bigint PRIMARY KEY, used integer NOT NULL CHECK(used>=0)
);
CREATE TABLE IF NOT EXISTS agent_evaluations (
  evaluation_id uuid PRIMARY KEY, bundle_hash text NOT NULL REFERENCES agent_candidates(bundle_hash),
  nonce_hash text NOT NULL, reserved_at bigint NOT NULL, expires_at bigint NOT NULL,
  status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','passed','failed')),
  report jsonb, signature text
);
CREATE TABLE IF NOT EXISTS agent_approvals (
  token_hash text PRIMARY KEY, bundle_hash text NOT NULL REFERENCES agent_candidates(bundle_hash),
  evaluation_id uuid NOT NULL UNIQUE REFERENCES agent_evaluations(evaluation_id),
  expires_at bigint NOT NULL, consumed_at bigint
);
CREATE TABLE IF NOT EXISTS agent_audit (
  sequence bigserial PRIMARY KEY, owner_id text NOT NULL, bundle_hash text NOT NULL,
  kind text NOT NULL, occurred_at bigint NOT NULL, details jsonb NOT NULL
);
CREATE OR REPLACE FUNCTION agent_reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''Agent audit records are append-only''; END;';
DROP TRIGGER IF EXISTS agent_audit_append_only ON agent_audit;
CREATE TRIGGER agent_audit_append_only BEFORE UPDATE OR DELETE ON agent_audit
FOR EACH ROW EXECUTE FUNCTION agent_reject_audit_mutation();
DROP TRIGGER IF EXISTS agent_audit_no_truncate ON agent_audit;
CREATE TRIGGER agent_audit_no_truncate BEFORE TRUNCATE ON agent_audit
FOR EACH STATEMENT EXECUTE FUNCTION agent_reject_audit_mutation();

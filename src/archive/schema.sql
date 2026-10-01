CREATE TABLE IF NOT EXISTS research_archive_streams (
  stream_id text PRIMARY KEY,
  head_sequence bigint NOT NULL DEFAULT 0,
  head_hash text,
  record_count bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  CHECK (head_sequence >= 0),
  CHECK (record_count >= 0),
  CHECK (head_hash IS NULL OR head_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS research_archive_payloads (
  payload_hash text PRIMARY KEY CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  encoding text NOT NULL CHECK (encoding = 'gzip-json-v1'),
  payload bytea NOT NULL,
  uncompressed_bytes bigint NOT NULL CHECK (uncompressed_bytes >= 0),
  compressed_bytes bigint NOT NULL CHECK (compressed_bytes >= 0),
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS research_archive_records (
  record_id uuid PRIMARY KEY,
  stream_id text NOT NULL REFERENCES research_archive_streams(stream_id),
  sequence bigint NOT NULL CHECK (sequence > 0),
  occurred_at bigint NOT NULL CHECK (occurred_at >= 0),
  captured_at bigint NOT NULL CHECK (captured_at >= 0),
  kind text NOT NULL,
  source text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  payload_hash text NOT NULL REFERENCES research_archive_payloads(payload_hash),
  metadata jsonb NOT NULL,
  metadata_hash text NOT NULL CHECK (metadata_hash ~ '^[0-9a-f]{64}$'),
  previous_hash text CHECK (previous_hash IS NULL OR previous_hash ~ '^[0-9a-f]{64}$'),
  record_hash text NOT NULL UNIQUE CHECK (record_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE(stream_id, sequence)
);
CREATE INDEX IF NOT EXISTS research_archive_records_time
  ON research_archive_records(stream_id, occurred_at DESC, sequence DESC);
CREATE INDEX IF NOT EXISTS research_archive_records_kind
  ON research_archive_records(stream_id, kind, occurred_at DESC);

CREATE OR REPLACE FUNCTION research_archive_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''Research archive records are append-only''; END;';

DROP TRIGGER IF EXISTS research_archive_records_append_only ON research_archive_records;
CREATE TRIGGER research_archive_records_append_only
  BEFORE UPDATE OR DELETE ON research_archive_records
  FOR EACH ROW EXECUTE FUNCTION research_archive_reject_mutation();

DROP TRIGGER IF EXISTS research_archive_payloads_append_only ON research_archive_payloads;
CREATE TRIGGER research_archive_payloads_append_only
  BEFORE UPDATE OR DELETE ON research_archive_payloads
  FOR EACH ROW EXECUTE FUNCTION research_archive_reject_mutation();

ALTER TABLE idempotency_records
ADD COLUMN request_hash TEXT NOT NULL DEFAULT '';

ALTER TABLE idempotency_records
ALTER COLUMN request_hash DROP DEFAULT;

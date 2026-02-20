PRAGMA foreign_keys = ON;

ALTER TABLE investment_records ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE investment_records ADD COLUMN source_file TEXT;
ALTER TABLE investment_records ADD COLUMN import_job_id TEXT REFERENCES import_jobs(id);

CREATE INDEX IF NOT EXISTS idx_transactions_month_source
ON transactions(month_key, source_type);

CREATE INDEX IF NOT EXISTS idx_investment_records_date_source_account
ON investment_records(snapshot_date, source_type, account_id);

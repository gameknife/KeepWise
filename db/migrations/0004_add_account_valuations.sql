PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS account_valuations (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    account_name TEXT NOT NULL,
    asset_class TEXT NOT NULL CHECK (asset_class IN ('cash', 'real_estate')),
    snapshot_date TEXT NOT NULL,
    value_cents INTEGER NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'manual',
    source_file TEXT,
    import_job_id TEXT REFERENCES import_jobs(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (account_id, asset_class, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_account_valuations_class_date_account
ON account_valuations(asset_class, snapshot_date, account_id);

CREATE INDEX IF NOT EXISTS idx_account_valuations_snapshot_date
ON account_valuations(snapshot_date);

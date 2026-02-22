PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS account_valuations__new;

CREATE TABLE account_valuations__new (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    account_name TEXT NOT NULL,
    asset_class TEXT NOT NULL CHECK (asset_class IN ('cash', 'real_estate', 'liability')),
    snapshot_date TEXT NOT NULL,
    value_cents INTEGER NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'manual',
    source_file TEXT,
    import_job_id TEXT REFERENCES import_jobs(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (account_id, asset_class, snapshot_date)
);

INSERT INTO account_valuations__new(
    id, account_id, account_name, asset_class, snapshot_date, value_cents,
    source_type, source_file, import_job_id, created_at, updated_at
)
SELECT
    id, account_id, account_name, asset_class, snapshot_date, value_cents,
    source_type, source_file, import_job_id, created_at, updated_at
FROM account_valuations;

DROP TABLE account_valuations;
ALTER TABLE account_valuations__new RENAME TO account_valuations;

CREATE INDEX IF NOT EXISTS idx_account_valuations_class_date_account
ON account_valuations(asset_class, snapshot_date, account_id);

CREATE INDEX IF NOT EXISTS idx_account_valuations_snapshot_date
ON account_valuations(snapshot_date);

PRAGMA foreign_keys = ON;

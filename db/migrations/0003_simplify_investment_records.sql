PRAGMA foreign_keys = OFF;

ALTER TABLE investment_records RENAME TO investment_records_old;

CREATE TABLE investment_records (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    snapshot_date TEXT NOT NULL,
    total_assets_cents INTEGER NOT NULL,
    transfer_amount_cents INTEGER NOT NULL DEFAULT 0,
    source_type TEXT NOT NULL DEFAULT 'manual',
    source_file TEXT,
    import_job_id TEXT REFERENCES import_jobs(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (account_id, snapshot_date)
);

INSERT INTO investment_records (
    id,
    account_id,
    snapshot_date,
    total_assets_cents,
    transfer_amount_cents,
    source_type,
    source_file,
    import_job_id,
    created_at,
    updated_at
)
SELECT
    id,
    account_id,
    snapshot_date,
    total_assets_cents,
    COALESCE(external_in_cents, 0) - COALESCE(external_out_cents, 0) AS transfer_amount_cents,
    COALESCE(source_type, 'manual') AS source_type,
    source_file,
    import_job_id,
    COALESCE(created_at, datetime('now')) AS created_at,
    COALESCE(updated_at, datetime('now')) AS updated_at
FROM investment_records_old;

DROP TABLE investment_records_old;

CREATE INDEX IF NOT EXISTS idx_investment_records_date_source_account
ON investment_records(snapshot_date, source_type, account_id);

PRAGMA foreign_keys = ON;

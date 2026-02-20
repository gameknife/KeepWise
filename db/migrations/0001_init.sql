PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('bank', 'credit_card', 'cash', 'wallet', 'investment', 'liability', 'other')),
    currency TEXT NOT NULL DEFAULT 'CNY',
    initial_balance_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    parent_id TEXT REFERENCES categories(id),
    level INTEGER NOT NULL DEFAULT 1,
    budget_enabled INTEGER NOT NULL DEFAULT 1 CHECK (budget_enabled IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_jobs (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_file TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    total_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    external_ref TEXT UNIQUE,
    occurred_at TEXT,
    posted_at TEXT,
    month_key TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CNY',
    direction TEXT NOT NULL CHECK (direction IN ('expense', 'income', 'transfer', 'other')),
    description TEXT NOT NULL DEFAULT '',
    merchant TEXT NOT NULL DEFAULT '',
    merchant_normalized TEXT NOT NULL DEFAULT '',
    statement_category TEXT NOT NULL DEFAULT '',
    category_id TEXT REFERENCES categories(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    source_type TEXT NOT NULL,
    source_file TEXT,
    import_job_id TEXT REFERENCES import_jobs(id),
    confidence REAL NOT NULL DEFAULT 0.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
    excluded_in_analysis INTEGER NOT NULL DEFAULT 0 CHECK (excluded_in_analysis IN (0, 1)),
    exclude_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reconciliations (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'matched', 'unmatched', 'difference')),
    expected_amount_cents INTEGER,
    actual_amount_cents INTEGER,
    diff_amount_cents INTEGER,
    note TEXT,
    reconciled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    month_key TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id),
    amount_cents INTEGER NOT NULL,
    spent_cents INTEGER NOT NULL DEFAULT 0,
    warning_threshold REAL NOT NULL DEFAULT 0.8,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (month_key, category_id)
);

CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    snapshot_date TEXT NOT NULL,
    account_id TEXT REFERENCES accounts(id),
    asset_type TEXT NOT NULL CHECK (asset_type IN ('cash', 'investment', 'liability', 'networth', 'other')),
    value_cents INTEGER NOT NULL,
    external_in_cents INTEGER NOT NULL DEFAULT 0,
    external_out_cents INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investment_records (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    snapshot_date TEXT NOT NULL,
    total_assets_cents INTEGER NOT NULL,
    external_in_cents INTEGER NOT NULL DEFAULT 0,
    external_out_cents INTEGER NOT NULL DEFAULT 0,
    dividend_cents INTEGER NOT NULL DEFAULT 0,
    realized_pnl_cents INTEGER NOT NULL DEFAULT 0,
    unrealized_pnl_cents INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (account_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS ai_suggestions (
    id TEXT PRIMARY KEY,
    suggestion_type TEXT NOT NULL,
    suggestion_text TEXT NOT NULL,
    confidence REAL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    evidence_refs_json TEXT,
    risk_notice TEXT,
    model_version TEXT,
    feedback TEXT NOT NULL DEFAULT 'none' CHECK (feedback IN ('none', 'useful', 'useless')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_month ON transactions(month_key);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_posted_at ON transactions(posted_at);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_norm ON transactions(merchant_normalized);
CREATE INDEX IF NOT EXISTS idx_transactions_review ON transactions(needs_review);
CREATE INDEX IF NOT EXISTS idx_transactions_import_job ON transactions(import_job_id);
CREATE INDEX IF NOT EXISTS idx_budgets_month ON budgets(month_key);
CREATE INDEX IF NOT EXISTS idx_assets_snapshot_date ON assets(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_import_jobs_started_at ON import_jobs(started_at);

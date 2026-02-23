CREATE TABLE IF NOT EXISTS monthly_budget_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    monthly_amount_cents INTEGER NOT NULL CHECK (monthly_amount_cents >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_budget_items_name
ON monthly_budget_items(name);

CREATE INDEX IF NOT EXISTS idx_monthly_budget_items_sort
ON monthly_budget_items(sort_order, is_active DESC, name);

INSERT OR IGNORE INTO monthly_budget_items(id, name, monthly_amount_cents, sort_order, is_active, is_builtin)
VALUES
    ('budget_item_mortgage', '房贷', 0, 10, 1, 1),
    ('budget_item_living', '日常开销', 0, 20, 1, 1),
    ('budget_item_bills', '缴费', 0, 30, 1, 1);

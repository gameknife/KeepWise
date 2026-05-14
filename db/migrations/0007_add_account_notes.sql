PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS account_notes (
    account_id    TEXT PRIMARY KEY,
    holdings_text TEXT NOT NULL DEFAULT '',
    risk_note     TEXT NOT NULL DEFAULT '',
    note_text     TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_notes_updated_at ON account_notes(updated_at);

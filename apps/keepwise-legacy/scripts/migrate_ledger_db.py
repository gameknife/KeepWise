#!/usr/bin/env python3
"""Apply SQLite schema migrations for the ledger database."""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


def ensure_migration_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )


def list_migration_files(migrations_dir: Path) -> list[Path]:
    if not migrations_dir.exists():
        raise FileNotFoundError(f"未找到迁移目录: {migrations_dir}")
    files = sorted([p for p in migrations_dir.iterdir() if p.is_file() and p.suffix == ".sql"])
    if not files:
        raise FileNotFoundError(f"迁移目录中没有 .sql 文件: {migrations_dir}")
    return files


def applied_versions(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT version FROM schema_migrations").fetchall()
    return {row[0] for row in rows}


def apply_migrations(db_path: Path, migrations_dir: Path) -> tuple[list[str], list[str]]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    files = list_migration_files(migrations_dir)

    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        ensure_migration_table(conn)
        already_applied = applied_versions(conn)

        applied_now: list[str] = []
        skipped: list[str] = []
        for migration in files:
            version = migration.name
            if version in already_applied:
                skipped.append(version)
                continue

            sql = migration.read_text(encoding="utf-8")
            with conn:
                conn.executescript(sql)
                conn.execute("INSERT INTO schema_migrations(version) VALUES (?)", (version,))
            applied_now.append(version)
        return applied_now, skipped
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="初始化并迁移本地账本 SQLite 数据库")
    parser.add_argument(
        "--db",
        default=Path("data/work/processed/ledger/keepwise.db"),
        type=Path,
        help="SQLite 数据库文件路径（默认: data/work/processed/ledger/keepwise.db）",
    )
    parser.add_argument(
        "--migrations-dir",
        default=Path("db/migrations"),
        type=Path,
        help="迁移 SQL 目录（默认: db/migrations）",
    )
    args = parser.parse_args()

    applied_now, skipped = apply_migrations(args.db, args.migrations_dir)
    if applied_now:
        print("已应用迁移:")
        for version in applied_now:
            print(f"  - {version}")
    else:
        print("没有新的迁移需要应用。")

    print(f"数据库路径: {args.db}")
    print(f"已跳过迁移数量: {len(skipped)}")


if __name__ == "__main__":
    main()

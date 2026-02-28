#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import shutil
import sqlite3
from pathlib import Path
from typing import Iterable


def repo_root() -> Path:
    # /repo/apps/keepwise-tauri/scripts/make_demo_db.py -> /repo
    return Path(__file__).resolve().parents[3]


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1 LIMIT 1",
        (table,),
    ).fetchone()
    return row is not None


def column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    if not table_exists(conn, table):
        return False
    rows = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    return any((r[1] == column) for r in rows)


def apply_id_mapping(
    conn: sqlite3.Connection,
    table: str,
    column: str,
    mapping: dict[str, str],
) -> None:
    if not mapping or not table_exists(conn, table) or not column_exists(conn, table, column):
        return
    sql = f'UPDATE "{table}" SET "{column}"=?1 WHERE "{column}"=?2'
    conn.executemany(sql, [(new, old) for old, new in mapping.items() if old != new])


def remap_primary_key(
    conn: sqlite3.Connection,
    table: str,
    pk_column: str,
    refs: Iterable[tuple[str, str]],
    prefix: str,
    width: int = 4,
) -> None:
    if not table_exists(conn, table) or not column_exists(conn, table, pk_column):
        return

    rows = conn.execute(f'SELECT "{pk_column}" FROM "{table}" ORDER BY "{pk_column}"').fetchall()
    ids = [str(r[0]) for r in rows]
    if not ids:
        return

    final_map = {old: f"{prefix}_{idx:0{width}d}" for idx, old in enumerate(ids, 1)}
    temp_map = {old: f"__tmp__{prefix}_{idx:0{width}d}" for idx, old in enumerate(ids, 1)}

    for ref_table, ref_column in [*refs, (table, pk_column)]:
        apply_id_mapping(conn, ref_table, ref_column, temp_map)

    second_stage = {temp_map[old]: new for old, new in final_map.items()}
    for ref_table, ref_column in [*refs, (table, pk_column)]:
        apply_id_mapping(conn, ref_table, ref_column, second_stage)


def list_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [str(r[0]) for r in rows]


def primary_key_column(conn: sqlite3.Connection, table: str) -> str | None:
    if not table_exists(conn, table):
        return None
    rows = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    pks = [r for r in rows if int(r[5] or 0) > 0]
    if not pks:
        return None
    pks.sort(key=lambda r: int(r[5]))
    return str(pks[0][1])


def cents_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    if not table_exists(conn, table):
        return []
    rows = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    cols: list[str] = []
    for row in rows:
        col = str(row[1] or "")
        if col.endswith("_cents"):
            cols.append(col)
    return cols


def _stable_unit_f64(seed: str) -> float:
    digest = hashlib.sha1(seed.encode("utf-8")).digest()
    # 48-bit mantissa-like integer -> [0, 1)
    raw = int.from_bytes(digest[:6], "big")
    return raw / float(1 << 48)


def obfuscate_cents_value(table: str, column: str, row_key: str, value: int) -> int:
    if value == 0:
        return 0
    sign = 1 if value > 0 else -1
    base = abs(int(value))
    global_scale = 0.72 + (_stable_unit_f64(f"{table}|{column}|global") * 0.62)  # [0.72, 1.34]
    jitter = (_stable_unit_f64(f"{table}|{column}|{row_key}") - 0.5) * 0.22  # [-0.11, +0.11]
    scaled = int(round(base * global_scale * (1.0 + jitter)))
    if scaled <= 0:
        scaled = 1
    return sign * scaled


def obfuscate_all_cents_columns(conn: sqlite3.Connection) -> None:
    for table in list_tables(conn):
        cols = cents_columns(conn, table)
        if not cols:
            continue
        pk_col = primary_key_column(conn, table)
        key_expr = f'"{pk_col}"' if pk_col else "rowid"
        select_cols = ", ".join([key_expr, *[f'"{c}"' for c in cols]])
        rows = conn.execute(f'SELECT {select_cols} FROM "{table}"').fetchall()
        if not rows:
            continue
        set_clause = ", ".join([f'"{c}"=?' for c in cols])
        where_clause = f'"{pk_col}"=?' if pk_col else "rowid=?"
        sql = f'UPDATE "{table}" SET {set_clause} WHERE {where_clause}'
        payload: list[tuple[object, ...]] = []
        for row in rows:
            row_key = str(row[0])
            transformed: list[object] = []
            for idx, col in enumerate(cols, 1):
                raw = row[idx]
                if raw is None:
                    transformed.append(None)
                    continue
                transformed.append(obfuscate_cents_value(table, col, row_key, int(raw)))
            transformed.append(row[0])
            payload.append(tuple(transformed))
        conn.executemany(sql, payload)


def anonymize_demo_db(db_path: Path) -> None:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("PRAGMA journal_mode = DELETE")
        conn.execute("BEGIN IMMEDIATE")

        remap_primary_key(
            conn,
            table="accounts",
            pk_column="id",
            refs=[
                ("transactions", "account_id"),
                ("investment_records", "account_id"),
                ("account_valuations", "account_id"),
                ("assets", "account_id"),
            ],
            prefix="acc",
            width=3,
        )
        remap_primary_key(
            conn,
            table="import_jobs",
            pk_column="id",
            refs=[
                ("transactions", "import_job_id"),
                ("investment_records", "import_job_id"),
                ("account_valuations", "import_job_id"),
            ],
            prefix="job",
            width=4,
        )
        remap_primary_key(
            conn,
            table="categories",
            pk_column="id",
            refs=[
                ("categories", "parent_id"),
                ("transactions", "category_id"),
                ("budgets", "category_id"),
            ],
            prefix="cat",
            width=3,
        )
        remap_primary_key(
            conn,
            table="transactions",
            pk_column="id",
            refs=[("reconciliations", "transaction_id")],
            prefix="tx",
            width=6,
        )
        remap_primary_key(conn, table="investment_records", pk_column="id", refs=[], prefix="inv", width=5)
        remap_primary_key(conn, table="account_valuations", pk_column="id", refs=[], prefix="val", width=5)
        remap_primary_key(conn, table="monthly_budget_items", pk_column="id", refs=[], prefix="bgt", width=3)
        remap_primary_key(conn, table="assets", pk_column="id", refs=[], prefix="ast", width=4)
        remap_primary_key(conn, table="budgets", pk_column="id", refs=[], prefix="bud", width=4)
        remap_primary_key(conn, table="ai_suggestions", pk_column="id", refs=[], prefix="ai", width=4)
        remap_primary_key(conn, table="reconciliations", pk_column="id", refs=[], prefix="rec", width=4)

        if table_exists(conn, "accounts"):
            account_ids = [str(r[0]) for r in conn.execute('SELECT id FROM accounts ORDER BY id').fetchall()]
            for idx, account_id in enumerate(account_ids, 1):
                conn.execute(
                    'UPDATE accounts SET name=?1, currency="CNY" WHERE id=?2',
                    (f"账户{idx:03d}", account_id),
                )

        if table_exists(conn, "categories"):
            category_ids = [str(r[0]) for r in conn.execute("SELECT id FROM categories ORDER BY level, id").fetchall()]
            for idx, category_id in enumerate(category_ids, 1):
                conn.execute(
                    "UPDATE categories SET name=?1 WHERE id=?2",
                    (f"分类{idx:03d}", category_id),
                )

        if table_exists(conn, "monthly_budget_items"):
            item_ids = [str(r[0]) for r in conn.execute("SELECT id FROM monthly_budget_items ORDER BY sort_order, id").fetchall()]
            for idx, item_id in enumerate(item_ids, 1):
                conn.execute(
                    "UPDATE monthly_budget_items SET name=?1 WHERE id=?2",
                    (f"预算项{idx:02d}", item_id),
                )

        if table_exists(conn, "account_valuations"):
            conn.execute(
                """
                UPDATE account_valuations
                   SET account_name = COALESCE(
                       (SELECT a.name FROM accounts a WHERE a.id = account_valuations.account_id),
                       account_name
                   ),
                       source_file = CASE
                           WHEN source_file IS NULL OR trim(source_file) = '' THEN source_file
                           ELSE 'demo_source.csv'
                       END
                """
            )

        if table_exists(conn, "investment_records"):
            conn.execute(
                """
                UPDATE investment_records
                   SET source_file = CASE
                       WHEN source_file IS NULL OR trim(source_file) = '' THEN source_file
                       ELSE 'demo_source.csv'
                   END
                """
            )

        if table_exists(conn, "transactions"):
            tx_rows = conn.execute(
                """
                SELECT id, direction, excluded_in_analysis
                FROM transactions
                ORDER BY month_key, occurred_at, id
                """
            ).fetchall()
            for idx, row in enumerate(tx_rows, 1):
                direction = str(row["direction"] or "")
                base_desc = {
                    "expense": "消费支出",
                    "income": "收入入账",
                    "transfer": "资金划转",
                }.get(direction, "其他交易")
                merchant = f"商户{((idx - 1) % 80) + 1:03d}"
                exclude_reason = "演示数据剔除" if int(row["excluded_in_analysis"] or 0) == 1 else ""
                conn.execute(
                    """
                    UPDATE transactions
                       SET external_ref=?1,
                           description=?2,
                           merchant=?3,
                           merchant_normalized=?4,
                           source_file=CASE
                               WHEN source_file IS NULL OR trim(source_file) = '' THEN source_file
                               ELSE 'demo_source.csv'
                           END,
                           exclude_reason=?5
                     WHERE id=?6
                    """,
                    (
                        f"demo-ref-{idx:06d}",
                        f"{base_desc} {idx:04d}",
                        merchant,
                        merchant,
                        exclude_reason,
                        str(row["id"]),
                    ),
                )

        if table_exists(conn, "import_jobs"):
            job_ids = [str(r[0]) for r in conn.execute("SELECT id FROM import_jobs ORDER BY started_at, id").fetchall()]
            for idx, job_id in enumerate(job_ids, 1):
                conn.execute(
                    """
                    UPDATE import_jobs
                       SET source_file=?1,
                           error_message=CASE
                               WHEN status='failed' AND error_message IS NOT NULL AND trim(error_message) <> '' THEN '演示导入错误'
                               ELSE NULL
                           END,
                           metadata_json='{"demo":true}'
                     WHERE id=?2
                    """,
                    (f"demo_import_{idx:02d}.csv", job_id),
                )

        if table_exists(conn, "ai_suggestions"):
            ai_ids = [str(r[0]) for r in conn.execute("SELECT id FROM ai_suggestions ORDER BY created_at, id").fetchall()]
            for idx, ai_id in enumerate(ai_ids, 1):
                conn.execute(
                    """
                    UPDATE ai_suggestions
                       SET suggestion_text=?1,
                           evidence_refs_json=NULL,
                           risk_notice='仅用于演示'
                     WHERE id=?2
                    """,
                    (f"演示建议 {idx:02d}", ai_id),
                )

        for table, column in [
            ("assets", "note"),
            ("budgets", "note"),
            ("reconciliations", "note"),
        ]:
            if table_exists(conn, table) and column_exists(conn, table, column):
                conn.execute(f'UPDATE "{table}" SET "{column}"=NULL')

        obfuscate_all_cents_columns(conn)

        conn.commit()
        conn.execute("PRAGMA foreign_keys = ON")
        fk_error = conn.execute("PRAGMA foreign_key_check").fetchone()
        if fk_error is not None:
            raise RuntimeError(f"脱敏后外键校验失败: {tuple(fk_error)}")
        conn.execute("VACUUM")
    finally:
        conn.close()


def table_count(conn: sqlite3.Connection, table: str) -> int:
    if not table_exists(conn, table):
        return 0
    row = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()
    return int(row[0]) if row else 0


def parse_args() -> argparse.Namespace:
    root = repo_root()
    default_source = root / "data/work/processed/ledger/keepwise.db"
    default_output = root / "apps/keepwise-tauri/src-tauri/assets/demo.db"
    parser = argparse.ArgumentParser(
        description="从 keepwise.db 生成脱敏 demo.db（用于应用首启演示）",
    )
    parser.add_argument("--source", type=Path, default=default_source, help=f"源数据库路径（默认：{default_source}）")
    parser.add_argument("--output", type=Path, default=default_output, help=f"输出数据库路径（默认：{default_output}）")
    parser.add_argument("--force", action="store_true", help="如果输出已存在则覆盖")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = args.source.expanduser().resolve()
    output = args.output.expanduser().resolve()

    if not source.exists() or not source.is_file():
        raise FileNotFoundError(f"源数据库不存在或不是文件: {source}")
    if output.exists() and not args.force:
        raise FileExistsError(f"输出文件已存在，请使用 --force 覆盖: {output}")

    output.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(str(source)) as src_conn:
        src_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    if output.exists():
        output.unlink()
    shutil.copy2(source, output)
    anonymize_demo_db(output)

    with sqlite3.connect(str(output)) as conn:
        counts = {
            "accounts": table_count(conn, "accounts"),
            "transactions": table_count(conn, "transactions"),
            "investment_records": table_count(conn, "investment_records"),
            "account_valuations": table_count(conn, "account_valuations"),
            "import_jobs": table_count(conn, "import_jobs"),
            "categories": table_count(conn, "categories"),
        }
    print("demo.db 生成完成:")
    print(f"  source: {source}")
    print(f"  output: {output}")
    for key, value in counts.items():
        print(f"  {key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

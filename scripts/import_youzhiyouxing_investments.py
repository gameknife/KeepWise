#!/usr/bin/env python3
"""Import YouZhiYouXing exported investment records into SQLite.

Only keeps core fields:
- snapshot_date
- total_assets_cents
- transfer_amount_cents
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET


def parse_amount_to_cents(raw: str) -> int:
    text = (raw or "").strip().replace(",", "").replace("¥", "").replace("￥", "")
    if not text:
        return 0
    value = Decimal(text).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(value * 100)


def normalize_key(key: str) -> str:
    return re.sub(r"\s+", "", (key or "").strip().lower())


def normalize_date(raw: str) -> str:
    text = (raw or "").strip().replace("/", "-").replace(".", "-")
    if not text:
        raise ValueError("缺少日期字段")
    if re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", text):
        year, month, day = text.split("-")
        return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
    raise ValueError(f"日期格式不支持: {raw}")


def normalize_date_flexible(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        raise ValueError("缺少日期字段")

    try:
        return normalize_date(text)
    except ValueError:
        pass

    try:
        number = float(text)
        if number <= 0:
            raise ValueError
        days = int(number)
        d = datetime(1899, 12, 30) + timedelta(days=days)
        return d.strftime("%Y-%m-%d")
    except ValueError:
        raise ValueError(f"日期格式不支持: {raw}")


@dataclass
class ParsedInvestmentRow:
    snapshot_date: str
    account_name: str
    total_assets_cents: int
    transfer_amount_cents: int


SUMMARY_HEADER_ALIASES = {
    "snapshot_date": {"日期", "快照日期", "记录日期", "date", "记账时间"},
    "account_name": {"账户", "账户名称", "组合", "组合名称", "account", "accountname"},
    "total_assets": {"总资产", "总资产(元)", "资产总额", "市值", "totalassets", "总资产金额"},
    "transfer_amount": {"转入转出金额", "资金进出金额", "净转入金额", "转入转出", "transfer"},
    "external_in": {"外部转入", "外部入金", "净转入(入)", "externalin"},
    "external_out": {"外部转出", "外部出金", "净转入(出)", "externalout"},
}

MANUAL_HEADER_ALIASES = {
    "record_type": {"记录类型", "type"},
    "snapshot_date": {"记账时间", "日期", "记录日期", "date"},
    "transfer_amount": {"转入转出金额", "资金进出金额", "转入转出", "净转入金额"},
    "total_assets": {"总资产金额", "总资产", "总资产(元)", "市值"},
    "account_name": {"账户", "账户名称", "组合", "组合名称"},
}


def row_get(row: list[str], idx: int | None) -> str:
    if idx is None:
        return ""
    if idx < 0 or idx >= len(row):
        return ""
    return (row[idx] or "").strip()


def resolve_alias_mapping_from_row(row: list[str], aliases: dict[str, set[str]]) -> dict[str, int]:
    normalized: dict[str, int] = {}
    for idx, cell in enumerate(row):
        key = normalize_key(cell)
        if key and key not in normalized:
            normalized[key] = idx

    mapping: dict[str, int] = {}
    for field, field_aliases in aliases.items():
        for alias in field_aliases:
            key = normalize_key(alias)
            if key in normalized:
                mapping[field] = normalized[key]
                break
    return mapping


def find_header_row(
    rows: list[list[str]],
    aliases: dict[str, set[str]],
    required: set[str],
) -> tuple[int, dict[str, int]]:
    for idx, row in enumerate(rows):
        mapping = resolve_alias_mapping_from_row(row, aliases)
        if required.issubset(mapping.keys()):
            return idx, mapping
    raise ValueError(f"未找到必要表头: {', '.join(sorted(required))}")


def extract_account_name_hint(rows: list[list[str]], fallback: str = "有知有行投资账户") -> str:
    target_keys = {normalize_key("账户名称"), normalize_key("账户")}
    for i in range(len(rows) - 1):
        row = rows[i]
        next_row = rows[i + 1]
        for j, cell in enumerate(row):
            if normalize_key(cell) in target_keys and j < len(next_row):
                candidate = (next_row[j] or "").strip()
                if candidate:
                    return candidate
    return fallback


def parse_summary_rows(
    rows: list[list[str]],
    account_hint: str,
) -> tuple[list[ParsedInvestmentRow], list[str], dict[str, str]]:
    header_idx, mapping_idx = find_header_row(rows, SUMMARY_HEADER_ALIASES, {"snapshot_date"})
    has_total_assets = "total_assets" in mapping_idx
    has_transfer = "transfer_amount" in mapping_idx or (
        "external_in" in mapping_idx and "external_out" in mapping_idx
    )
    if not (has_total_assets and has_transfer):
        raise ValueError("摘要记录缺少必要列：需要日期、总资产以及转入转出金额（或外部转入/转出）")

    header = rows[header_idx]
    mapping = {field: header[idx] for field, idx in mapping_idx.items()}

    parsed: list[ParsedInvestmentRow] = []
    errors: list[str] = []
    for i, row in enumerate(rows[header_idx + 1 :], start=header_idx + 2):
        if not any((c or "").strip() for c in row):
            continue

        try:
            snapshot_raw = row_get(row, mapping_idx.get("snapshot_date"))
            if not snapshot_raw:
                continue
            snapshot_date = normalize_date_flexible(snapshot_raw)
            account_name = row_get(row, mapping_idx.get("account_name")) or account_hint

            total_assets_cents = parse_amount_to_cents(row_get(row, mapping_idx.get("total_assets")))
            transfer_text = row_get(row, mapping_idx.get("transfer_amount"))
            if transfer_text:
                transfer_amount_cents = parse_amount_to_cents(transfer_text)
            else:
                transfer_amount_cents = parse_amount_to_cents(row_get(row, mapping_idx.get("external_in"))) - parse_amount_to_cents(
                    row_get(row, mapping_idx.get("external_out"))
                )

            if total_assets_cents == 0 and transfer_amount_cents == 0:
                continue

            parsed.append(
                ParsedInvestmentRow(
                    snapshot_date=snapshot_date,
                    account_name=account_name,
                    total_assets_cents=total_assets_cents,
                    transfer_amount_cents=transfer_amount_cents,
                )
            )
        except (ValueError, InvalidOperation) as exc:
            errors.append(f"第{i}行: {exc}")

    return parsed, errors, mapping


def parse_manual_rows(
    rows: list[list[str]],
    account_hint: str,
) -> tuple[list[ParsedInvestmentRow], list[str], dict[str, str]]:
    header_idx, mapping_idx = find_header_row(rows, MANUAL_HEADER_ALIASES, {"record_type", "snapshot_date"})
    if "transfer_amount" not in mapping_idx and "total_assets" not in mapping_idx:
        raise ValueError("手动记录缺少转入转出金额或总资产金额列")

    header = rows[header_idx]
    mapping = {field: header[idx] for field, idx in mapping_idx.items()}

    buckets: dict[str, dict[str, Any]] = {}
    errors: list[str] = []

    for i, row in enumerate(rows[header_idx + 1 :], start=header_idx + 2):
        if not any((c or "").strip() for c in row):
            continue

        record_type = row_get(row, mapping_idx.get("record_type"))
        date_raw = row_get(row, mapping_idx.get("snapshot_date"))
        if not record_type and not date_raw:
            continue

        try:
            snapshot_date = normalize_date_flexible(date_raw)
            account_name = row_get(row, mapping_idx.get("account_name")) or account_hint

            bucket = buckets.setdefault(
                snapshot_date,
                {
                    "snapshot_date": snapshot_date,
                    "account_name": account_name,
                    "total_assets_cents": 0,
                    "transfer_amount_cents": 0,
                    "has_total_assets": False,
                },
            )
            if account_name:
                bucket["account_name"] = account_name

            transfer_text = row_get(row, mapping_idx.get("transfer_amount"))
            if transfer_text:
                bucket["transfer_amount_cents"] += parse_amount_to_cents(transfer_text)

            total_assets_text = row_get(row, mapping_idx.get("total_assets"))
            if total_assets_text:
                bucket["total_assets_cents"] = parse_amount_to_cents(total_assets_text)
                bucket["has_total_assets"] = True
        except (ValueError, InvalidOperation) as exc:
            errors.append(f"第{i}行: {exc}")

    parsed: list[ParsedInvestmentRow] = []
    last_known_assets_cents: int | None = None
    for snapshot_date in sorted(buckets.keys()):
        item = buckets[snapshot_date]
        if item["has_total_assets"]:
            last_known_assets_cents = item["total_assets_cents"]
        elif last_known_assets_cents is not None:
            # 手动流水里部分日期只有资金进出，没有总资产快照，沿用上一条总资产避免错误归零。
            item["total_assets_cents"] = last_known_assets_cents
        elif item["transfer_amount_cents"] != 0:
            errors.append(f"{snapshot_date}: 缺少总资产金额且无可继承历史值，已跳过该日期")
            continue

        if item["total_assets_cents"] == 0 and item["transfer_amount_cents"] == 0:
            continue
        parsed.append(
            ParsedInvestmentRow(
                snapshot_date=item["snapshot_date"],
                account_name=item["account_name"],
                total_assets_cents=item["total_assets_cents"],
                transfer_amount_cents=item["transfer_amount_cents"],
            )
        )

    return parsed, errors, mapping


def read_csv_rows(path: Path) -> list[list[str]]:
    with path.open("r", newline="", encoding="utf-8-sig") as f:
        return [[(c or "").strip() for c in row] for row in csv.reader(f)]


def column_ref_to_index(ref: str) -> int:
    col = "".join(ch for ch in ref if ch.isalpha())
    idx = 0
    for ch in col:
        idx = idx * 26 + (ord(ch.upper()) - 64)
    return idx


def read_xlsx_rows(path: Path) -> list[list[str]]:
    ns_main = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rel_attr = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

    with zipfile.ZipFile(path, "r") as z:
        names = set(z.namelist())

        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in names:
            shared_root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in shared_root.findall("x:si", ns_main):
                shared_strings.append("".join((t.text or "") for t in si.findall(".//x:t", ns_main)))

        workbook = ET.fromstring(z.read("xl/workbook.xml"))
        first_sheet = workbook.find("x:sheets/x:sheet", ns_main)
        if first_sheet is None:
            raise ValueError("xlsx 中未找到工作表")
        rel_id = first_sheet.attrib.get(rel_attr)
        if not rel_id:
            raise ValueError("xlsx 工作表关系丢失")

        rels_root = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = ""
        for rel in rels_root:
            if rel.attrib.get("Id") == rel_id:
                target = rel.attrib.get("Target", "")
                break
        if not target:
            raise ValueError("xlsx 工作表路径解析失败")

        if target.startswith("/"):
            sheet_path = target.lstrip("/")
        else:
            sheet_path = f"xl/{target}"

        sheet_root = ET.fromstring(z.read(sheet_path))
        rows: list[list[str]] = []
        for row_elem in sheet_root.findall("x:sheetData/x:row", ns_main):
            cells: dict[int, str] = {}
            for cell in row_elem.findall("x:c", ns_main):
                ref = cell.attrib.get("r", "A1")
                idx = column_ref_to_index(ref)
                cell_type = cell.attrib.get("t", "")

                value = ""
                if cell_type == "s":
                    v = cell.find("x:v", ns_main)
                    if v is not None and v.text:
                        si = int(v.text)
                        value = shared_strings[si] if si < len(shared_strings) else ""
                elif cell_type == "inlineStr":
                    value = "".join((t.text or "") for t in cell.findall("x:is//x:t", ns_main))
                else:
                    v = cell.find("x:v", ns_main)
                    value = (v.text or "") if v is not None else ""

                cells[idx] = value.strip()

            if cells:
                max_col = max(cells.keys())
                rows.append([cells.get(i, "") for i in range(1, max_col + 1)])

    return rows


def parse_input_file(file_path: Path) -> tuple[list[ParsedInvestmentRow], list[str], dict[str, str], str]:
    if not file_path.exists():
        raise FileNotFoundError(f"未找到导入文件: {file_path}")

    suffix = file_path.suffix.lower()
    if suffix == ".csv":
        rows = read_csv_rows(file_path)
    elif suffix == ".xlsx":
        rows = read_xlsx_rows(file_path)
    else:
        raise ValueError(f"不支持的文件格式: {file_path.suffix}（仅支持 .csv/.xlsx）")

    account_hint = extract_account_name_hint(rows, fallback="有知有行投资账户")

    try:
        manual_rows, manual_errors, manual_mapping = parse_manual_rows(rows, account_hint)
        if manual_rows or manual_errors:
            return manual_rows, manual_errors, manual_mapping, "manual_ledger"
    except ValueError:
        pass

    summary_rows, summary_errors, summary_mapping = parse_summary_rows(rows, account_hint)
    return summary_rows, summary_errors, summary_mapping, "summary"


def account_id_from_name(account_name: str) -> str:
    digest = uuid.uuid5(uuid.NAMESPACE_URL, f"keepwise:investment:{account_name}")
    return f"acct_inv_{str(digest).replace('-', '')[:12]}"


def ensure_schema_ready(conn: sqlite3.Connection) -> None:
    table_names = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('accounts', 'investment_records', 'import_jobs')"
        )
    }
    required_tables = {"accounts", "investment_records", "import_jobs"}
    missing_tables = required_tables - table_names
    if missing_tables:
        raise RuntimeError(f"数据库缺少必要表: {', '.join(sorted(missing_tables))}。请先执行迁移。")

    columns = {row[1] for row in conn.execute("PRAGMA table_info(investment_records)")}
    required_columns = {
        "account_id",
        "snapshot_date",
        "total_assets_cents",
        "transfer_amount_cents",
        "source_type",
        "source_file",
        "import_job_id",
    }
    missing_columns = required_columns - columns
    if missing_columns:
        raise RuntimeError(
            f"investment_records 缺少字段: {', '.join(sorted(missing_columns))}。请执行最新迁移。"
        )


def ensure_account(conn: sqlite3.Connection, account_id: str, account_name: str) -> None:
    conn.execute(
        """
        INSERT INTO accounts(id, name, account_type, currency, initial_balance_cents)
        VALUES (?, ?, 'investment', 'CNY', 0)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            updated_at=datetime('now')
        """,
        (account_id, account_name),
    )


def upsert_investment_record(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    row: ParsedInvestmentRow,
    source_type: str,
    source_file: str | None,
    import_job_id: str | None,
) -> None:
    rec_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{account_id}:{row.snapshot_date}:{source_type}"))
    conn.execute(
        """
        INSERT INTO investment_records(
            id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents,
            source_type, source_file, import_job_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, snapshot_date) DO UPDATE SET
            total_assets_cents=excluded.total_assets_cents,
            transfer_amount_cents=excluded.transfer_amount_cents,
            source_type=excluded.source_type,
            source_file=excluded.source_file,
            import_job_id=excluded.import_job_id,
            updated_at=datetime('now')
        """,
        (
            rec_id,
            account_id,
            row.snapshot_date,
            row.total_assets_cents,
            row.transfer_amount_cents,
            source_type,
            source_file or None,
            import_job_id or None,
        ),
    )


def preview_file(file_path: Path) -> dict:
    rows, errors, mapping, parser_kind = parse_input_file(file_path)
    preview = [
        {
            "snapshot_date": row.snapshot_date,
            "account_name": row.account_name,
            "total_assets_cents": row.total_assets_cents,
            "transfer_amount_cents": row.transfer_amount_cents,
        }
        for row in rows[:10]
    ]
    return {
        "file": str(file_path),
        "parser_kind": parser_kind,
        "mapping": mapping,
        "parsed_count": len(rows),
        "error_count": len(errors),
        "errors": errors[:20],
        "preview_rows": preview,
    }


def import_file(
    db_path: Path,
    file_path: Path,
    source_type: str = "youzhiyouxing_export",
) -> tuple[int, int, str]:
    rows, parse_errors, mapping, parser_kind = parse_input_file(file_path)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    ensure_schema_ready(conn)

    job_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    metadata_json = json.dumps(
        {
            "source_type": source_type,
            "source_file": str(file_path),
            "parser_kind": parser_kind,
            "mapping": mapping,
        },
        ensure_ascii=False,
    )

    with conn:
        conn.execute(
            """
            INSERT INTO import_jobs(id, source_type, source_file, status, started_at, total_count, imported_count, error_count, metadata_json)
            VALUES (?, ?, ?, 'running', ?, 0, 0, 0, ?)
            """,
            (job_id, source_type, str(file_path), started_at, metadata_json),
        )

    total_count = len(rows) + len(parse_errors)
    imported_count = 0
    error_count = len(parse_errors)

    try:
        for row in rows:
            try:
                account_id = account_id_from_name(row.account_name)
                with conn:
                    ensure_account(conn, account_id, row.account_name)
                    upsert_investment_record(
                        conn,
                        account_id=account_id,
                        row=row,
                        source_type=source_type,
                        source_file=str(file_path),
                        import_job_id=job_id,
                    )
                imported_count += 1
            except sqlite3.DatabaseError:
                error_count += 1

        finished_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        error_message = "\n".join(parse_errors[:20]) if parse_errors else None
        with conn:
            conn.execute(
                """
                UPDATE import_jobs
                SET status='success',
                    finished_at=?,
                    total_count=?,
                    imported_count=?,
                    error_count=?,
                    error_message=?
                WHERE id=?
                """,
                (finished_at, total_count, imported_count, error_count, error_message, job_id),
            )
        return imported_count, error_count, job_id
    except Exception as exc:
        finished_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with conn:
            conn.execute(
                """
                UPDATE import_jobs
                SET status='failed',
                    finished_at=?,
                    total_count=?,
                    imported_count=?,
                    error_count=?,
                    error_message=?
                WHERE id=?
                """,
                (finished_at, total_count, imported_count, error_count, str(exc), job_id),
            )
        raise
    finally:
        conn.close()


# Backward-compatible wrappers.
def preview_csv(csv_path: Path) -> dict:
    return preview_file(csv_path)


def import_csv(db_path: Path, csv_path: Path, source_type: str = "youzhiyouxing_export") -> tuple[int, int, str]:
    return import_file(db_path, csv_path, source_type=source_type)


def main() -> None:
    parser = argparse.ArgumentParser(description="导入有知有行投资记录文件（支持 CSV / XLSX）")
    parser.add_argument("--db", type=Path, default=Path("data/work/processed/ledger/keepwise.db"))
    parser.add_argument("--file", type=Path, help="有知有行导出文件路径（.csv/.xlsx）")
    parser.add_argument("--csv", type=Path, help="兼容旧参数：CSV 文件路径")
    parser.add_argument("--preview", action="store_true", help="仅预览，不写入数据库")
    args = parser.parse_args()

    input_file = args.file or args.csv
    if input_file is None:
        raise SystemExit("请提供 --file（或兼容参数 --csv）")

    if args.preview:
        print(json.dumps(preview_file(input_file), ensure_ascii=False, indent=2))
        return

    imported_count, error_count, job_id = import_file(args.db, input_file)
    print("导入完成。")
    print(f"数据库路径: {args.db}")
    print(f"导入任务ID: {job_id}")
    print(f"成功导入: {imported_count}")
    print(f"失败条数: {error_count}")


if __name__ == "__main__":
    main()

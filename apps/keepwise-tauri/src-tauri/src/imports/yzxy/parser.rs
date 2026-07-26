use super::*;

pub(super) fn finalize_rows_with_inferred_assets(
    buckets: BTreeMap<String, Bucket>,
    errors: &mut Vec<String>,
) -> Vec<ParsedInvestmentRow> {
    let mut parsed = Vec::new();
    let mut last_known_assets_cents: Option<i64> = None;

    for (snapshot_date, item) in buckets {
        let mut total_assets_cents = item.total_assets_cents;
        let transfer_amount_cents = item.transfer_amount_cents;
        let has_total_assets = item.has_total_assets;

        if has_total_assets {
            last_known_assets_cents = Some(total_assets_cents);
        } else if let Some(last) = last_known_assets_cents {
            total_assets_cents = last + transfer_amount_cents;
            last_known_assets_cents = Some(total_assets_cents);
        } else if transfer_amount_cents != 0 {
            errors.push(format!(
                "{snapshot_date}: 缺少总资产金额且无可继承历史值，已跳过该日期"
            ));
            continue;
        }

        if total_assets_cents == 0 && transfer_amount_cents == 0 {
            continue;
        }

        parsed.push(ParsedInvestmentRow {
            snapshot_date,
            account_name: item.account_name,
            total_assets_cents,
            transfer_amount_cents,
        });
    }

    parsed
}

pub(super) fn mapping_headers(
    header_row: &[String],
    mapping_idx: &HashMap<String, usize>,
) -> BTreeMap<String, String> {
    let mut mapping = BTreeMap::new();
    for (field, idx) in mapping_idx {
        if let Some(header) = header_row.get(*idx) {
            mapping.insert(field.clone(), trim_cell(header));
        }
    }
    mapping
}

pub(super) fn parse_summary_rows(
    rows: &[Vec<String>],
    account_hint: &str,
) -> Result<
    (
        Vec<ParsedInvestmentRow>,
        Vec<String>,
        BTreeMap<String, String>,
    ),
    String,
> {
    let (header_idx, mapping_idx) = find_header_row(rows, SUMMARY_ALIAS_SPECS, &["snapshot_date"])?;
    let has_total_assets = mapping_idx.contains_key("total_assets");
    let has_transfer = mapping_idx.contains_key("transfer_amount")
        || (mapping_idx.contains_key("external_in") && mapping_idx.contains_key("external_out"));
    if !(has_total_assets && has_transfer) {
        return Err(
            "摘要记录缺少必要列：需要日期、总资产以及转入转出金额（或外部转入/转出）".to_string(),
        );
    }

    let mapping = mapping_headers(&rows[header_idx], &mapping_idx);
    let mut buckets: BTreeMap<String, Bucket> = BTreeMap::new();
    let mut errors = Vec::new();

    for (offset, row) in rows[(header_idx + 1)..].iter().enumerate() {
        let line_no = header_idx + 2 + offset;
        if row.iter().all(|c| trim_cell(c).is_empty()) {
            continue;
        }
        let res: Result<(), String> = (|| {
            let snapshot_raw = row_get(row, mapping_idx.get("snapshot_date").copied());
            if snapshot_raw.is_empty() {
                return Ok(());
            }
            let snapshot_date = normalize_date_flexible(&snapshot_raw)?;
            let account_name = {
                let v = row_get(row, mapping_idx.get("account_name").copied());
                if v.is_empty() {
                    account_hint.to_string()
                } else {
                    v
                }
            };

            let bucket = buckets.entry(snapshot_date.clone()).or_default();
            if bucket.account_name.is_empty() && !account_name.is_empty() {
                bucket.account_name = account_name;
            } else if !account_name.is_empty() {
                bucket.account_name = account_name;
            }

            let total_assets_text = row_get(row, mapping_idx.get("total_assets").copied());
            if !total_assets_text.is_empty() {
                bucket.total_assets_cents = parse_amount_to_cents(&total_assets_text)?;
                bucket.has_total_assets = true;
            }

            let transfer_amount_cents = {
                let transfer_text = row_get(row, mapping_idx.get("transfer_amount").copied());
                if !transfer_text.is_empty() {
                    parse_amount_to_cents(&transfer_text)?
                } else {
                    parse_amount_to_cents(&row_get(row, mapping_idx.get("external_in").copied()))?
                        - parse_amount_to_cents(&row_get(
                            row,
                            mapping_idx.get("external_out").copied(),
                        ))?
                }
            };
            bucket.transfer_amount_cents += transfer_amount_cents;
            Ok(())
        })();
        if let Err(err) = res {
            errors.push(format!("第{line_no}行: {err}"));
        }
    }

    let parsed = finalize_rows_with_inferred_assets(buckets, &mut errors);
    Ok((parsed, errors, mapping))
}

pub(super) fn parse_manual_rows(
    rows: &[Vec<String>],
    account_hint: &str,
) -> Result<
    (
        Vec<ParsedInvestmentRow>,
        Vec<String>,
        BTreeMap<String, String>,
    ),
    String,
> {
    let (header_idx, mapping_idx) =
        find_header_row(rows, MANUAL_ALIAS_SPECS, &["record_type", "snapshot_date"])?;
    if !mapping_idx.contains_key("transfer_amount") && !mapping_idx.contains_key("total_assets") {
        return Err("手动记录缺少转入转出金额或总资产金额列".to_string());
    }

    let mapping = mapping_headers(&rows[header_idx], &mapping_idx);
    let mut buckets: BTreeMap<String, Bucket> = BTreeMap::new();
    let mut errors = Vec::new();

    for (offset, row) in rows[(header_idx + 1)..].iter().enumerate() {
        let line_no = header_idx + 2 + offset;
        if row.iter().all(|c| trim_cell(c).is_empty()) {
            continue;
        }

        let record_type = row_get(row, mapping_idx.get("record_type").copied());
        let date_raw = row_get(row, mapping_idx.get("snapshot_date").copied());
        if record_type.is_empty() && date_raw.is_empty() {
            continue;
        }

        let res: Result<(), String> = (|| {
            let snapshot_date = normalize_date_flexible(&date_raw)?;
            let account_name = {
                let v = row_get(row, mapping_idx.get("account_name").copied());
                if v.is_empty() {
                    account_hint.to_string()
                } else {
                    v
                }
            };

            let bucket = buckets.entry(snapshot_date.clone()).or_default();
            if !account_name.is_empty() {
                bucket.account_name = account_name;
            }

            let transfer_text = row_get(row, mapping_idx.get("transfer_amount").copied());
            if !transfer_text.is_empty() {
                bucket.transfer_amount_cents += parse_amount_to_cents(&transfer_text)?;
            }

            let total_assets_text = row_get(row, mapping_idx.get("total_assets").copied());
            if !total_assets_text.is_empty() {
                bucket.total_assets_cents = parse_amount_to_cents(&total_assets_text)?;
                bucket.has_total_assets = true;
            }
            Ok(())
        })();
        if let Err(err) = res {
            errors.push(format!("第{line_no}行: {err}"));
        }
    }

    let parsed = finalize_rows_with_inferred_assets(buckets, &mut errors);
    Ok((parsed, errors, mapping))
}

pub(super) fn read_csv_rows(path: &Path) -> Result<Vec<Vec<String>>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_path(path)
        .map_err(|e| format!("读取 CSV 失败: {e}"))?;

    let mut rows = Vec::new();
    for rec in reader.records() {
        let rec = rec.map_err(|e| format!("读取 CSV 行失败: {e}"))?;
        rows.push(rec.iter().map(trim_cell).collect());
    }
    Ok(rows)
}

pub(super) fn read_xlsx_rows(path: &Path) -> Result<Vec<Vec<String>>, String> {
    let mut workbook = open_workbook_auto(path).map_err(|e| format!("打开 xlsx 失败: {e}"))?;
    let sheet_names = workbook.sheet_names().to_owned();
    let first_sheet = sheet_names
        .first()
        .cloned()
        .ok_or_else(|| "xlsx 中未找到工作表".to_string())?;

    let range = workbook
        .worksheet_range(&first_sheet)
        .map_err(|e| format!("读取 xlsx 工作表失败: {e}"))?;

    let rows = range
        .rows()
        .map(|row| {
            row.iter()
                .map(|cell| trim_cell(&cell.to_string()))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    Ok(rows)
}

pub(super) fn parse_input_file(file_path: &Path) -> Result<ParseInputFileResult, String> {
    if !file_path.exists() {
        return Err(format!("未找到导入文件: {}", file_path.to_string_lossy()));
    }
    if !file_path.is_file() {
        return Err(format!("导入路径不是文件: {}", file_path.to_string_lossy()));
    }

    let suffix = file_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let rows = match suffix.as_str() {
        "csv" => read_csv_rows(file_path)?,
        "xlsx" => read_xlsx_rows(file_path)?,
        _ => {
            return Err(format!(
                "不支持的文件格式: .{}（仅支持 .csv/.xlsx）",
                suffix
            ))
        }
    };

    let account_hint = extract_account_name_hint(&rows, "有知有行投资账户");

    if let Ok((manual_rows, manual_errors, manual_mapping)) =
        parse_manual_rows(&rows, &account_hint)
    {
        if !manual_rows.is_empty() || !manual_errors.is_empty() {
            return Ok(ParseInputFileResult {
                rows: manual_rows,
                errors: manual_errors,
                mapping: manual_mapping,
                parser_kind: "manual_ledger".to_string(),
            });
        }
    }

    let (summary_rows, summary_errors, summary_mapping) = parse_summary_rows(&rows, &account_hint)?;
    Ok(ParseInputFileResult {
        rows: summary_rows,
        errors: summary_errors,
        mapping: summary_mapping,
        parser_kind: "summary".to_string(),
    })
}

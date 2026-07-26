use super::*;

pub(super) fn collect_eml_files(input_path: &Path) -> Result<(Vec<PathBuf>, PathBuf), String> {
    if !input_path.exists() {
        return Err(format!("未找到路径: {}", input_path.to_string_lossy()));
    }
    if input_path.is_file() {
        let is_eml = input_path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("eml"))
            .unwrap_or(false);
        if !is_eml {
            return Err("仅支持 .eml 文件或包含 .eml 的目录".to_string());
        }
        let root = input_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        return Ok((vec![input_path.to_path_buf()], root));
    }
    if !input_path.is_dir() {
        return Err(format!(
            "不支持的路径类型: {}",
            input_path.to_string_lossy()
        ));
    }

    let mut files = WalkDir::new(input_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| {
            p.extension()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case("eml"))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    files.sort();
    if files.is_empty() {
        return Err("没有可解析的 .eml 文件".to_string());
    }
    Ok((files, input_path.to_path_buf()))
}

pub(super) fn extract_best_body(mail: &ParsedMail) -> Option<String> {
    pub(super) fn walk(mail: &ParsedMail, want_html: bool) -> Option<String> {
        let mime = mail.ctype.mimetype.to_ascii_lowercase();
        if (want_html && mime == "text/html") || (!want_html && mime == "text/plain") {
            if let Ok(body) = mail.get_body() {
                return Some(body);
            }
        }
        for part in &mail.subparts {
            if let Some(body) = walk(part, want_html) {
                return Some(body);
            }
        }
        None
    }

    walk(mail, true).or_else(|| walk(mail, false))
}

pub(super) fn extract_table_rows(html: &str) -> Vec<Vec<String>> {
    let doc = Html::parse_document(html);
    let mut rows = Vec::new();
    for tr in doc.select(tr_selector()) {
        let row = tr
            .children()
            .filter_map(scraper::ElementRef::wrap)
            .filter(|cell| {
                let name = cell.value().name();
                name.eq_ignore_ascii_case("td") || name.eq_ignore_ascii_case("th")
            })
            .map(|cell| trim_text(&cell.text().collect::<Vec<_>>().join(" ")))
            .collect::<Vec<_>>();
        if row.iter().any(|c| !c.is_empty()) {
            rows.push(row);
        }
    }
    rows
}

pub(super) fn parse_statement_year_month(rows: &[Vec<String>]) -> Result<(i32, u32), String> {
    for row in rows {
        let text = row.join(" ");
        if let Some(caps) = year_month_re().captures(&text) {
            let year = caps
                .get(1)
                .and_then(|m| m.as_str().parse::<i32>().ok())
                .ok_or_else(|| "无法识别账单年份".to_string())?;
            let month = caps
                .get(2)
                .and_then(|m| m.as_str().parse::<u32>().ok())
                .ok_or_else(|| "无法识别账单月份".to_string())?;
            return Ok((year, month));
        }
    }
    Err("无法识别账单年月。".to_string())
}

pub(super) fn find_transaction_header_index(rows: &[Vec<String>]) -> Result<usize, String> {
    for (idx, row) in rows.iter().enumerate() {
        let line = row.join(" ");
        if HEADER_KEYWORDS.iter().all(|kw| line.contains(kw)) {
            return Ok(idx);
        }
    }
    Err("未找到交易明细表头。".to_string())
}

pub(super) fn parse_amount_to_cents_from_text(raw: &str) -> Option<i64> {
    let stripped = raw.replace('¥', "").replace('￥', "");
    let m = amount_re().find(&stripped)?;
    parse_amount_text_to_cents(m.as_str()).ok()
}

pub(super) fn parse_amount_text_to_cents(raw: &str) -> Result<i64, String> {
    let mut s = raw.trim().replace(',', "");
    if s.is_empty() {
        return Ok(0);
    }
    let negative = s.starts_with('-');
    if s.starts_with('-') || s.starts_with('+') {
        s = s[1..].to_string();
    }
    if s.is_empty() {
        return Err("金额格式不合法".to_string());
    }
    let parts = s.split('.').collect::<Vec<_>>();
    if parts.len() > 2 {
        return Err("金额格式不合法".to_string());
    }
    let int_part = if parts[0].is_empty() { "0" } else { parts[0] };
    if !int_part.chars().all(|c| c.is_ascii_digit()) {
        return Err("金额格式不合法".to_string());
    }
    let frac_part = if parts.len() == 2 { parts[1] } else { "" };
    if !frac_part.chars().all(|c| c.is_ascii_digit()) || frac_part.len() > 2 {
        return Err("金额格式不合法".to_string());
    }
    let int_val = int_part
        .parse::<i64>()
        .map_err(|_| "金额超范围".to_string())?;
    let frac_val = match frac_part.len() {
        0 => 0,
        1 => {
            frac_part
                .parse::<i64>()
                .map_err(|_| "金额格式不合法".to_string())?
                * 10
        }
        2 => frac_part
            .parse::<i64>()
            .map_err(|_| "金额格式不合法".to_string())?,
        _ => 0,
    };
    let mut cents = int_val
        .checked_mul(100)
        .and_then(|v| v.checked_add(frac_val))
        .ok_or_else(|| "金额超范围".to_string())?;
    if negative {
        cents = -cents;
    }
    Ok(cents)
}

pub(super) fn normalize_mmdd(mmdd: &str, statement_year: i32, statement_month: u32) -> String {
    let text = mmdd.trim();
    if text.len() != 4 || !text.chars().all(|c| c.is_ascii_digit()) {
        return String::new();
    }
    let month = text[0..2].parse::<u32>().ok();
    let day = text[2..4].parse::<u32>().ok();
    let (month, day) = match (month, day) {
        (Some(m), Some(d)) => (m, d),
        _ => return String::new(),
    };
    let year = if month > statement_month {
        statement_year - 1
    } else {
        statement_year
    };
    chrono::NaiveDate::from_ymd_opt(year, month, day)
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

pub(super) fn extract_card_last4(raw: &str) -> Option<String> {
    let text = trim_text(raw);
    if text.is_empty() {
        return None;
    }
    if text.chars().all(|c| c.is_ascii_digit()) && text.len() == 4 {
        return Some(text);
    }
    card_last4_re()
        .find_iter(&text)
        .last()
        .map(|m| m.as_str().to_string())
}

pub(super) fn parse_single_eml(
    path: &Path,
    root_for_rel: &Path,
) -> Result<Vec<ParsedEmlTransaction>, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取 eml 失败: {e}"))?;
    let mail = parse_mail(&bytes).map_err(|e| format!("解析 eml MIME 失败: {e}"))?;
    let body =
        extract_best_body(&mail).ok_or_else(|| "邮件不包含可解析正文（html/plain）".to_string())?;

    let rows = extract_table_rows(&body);
    let (statement_year, statement_month) = parse_statement_year_month(&rows)?;
    let header_idx = find_transaction_header_index(&rows)?;

    let mut current_statement_category = "未分类".to_string();
    let mut out = Vec::new();
    for (source_row_index, row) in rows.iter().enumerate().skip(header_idx + 1) {
        let non_empty = row
            .iter()
            .filter(|c| !c.is_empty())
            .cloned()
            .collect::<Vec<_>>();
        if non_empty.is_empty() {
            continue;
        }
        if non_empty.len() == 1 && stat_category_set().contains(non_empty[0].as_str()) {
            current_statement_category = non_empty[0].clone();
            continue;
        }
        let line = non_empty.join(" ");
        if line.contains('★') {
            break;
        }
        if row.len() < 7 {
            continue;
        }

        let country = row[row.len() - 1].trim().to_string();
        let original_amount = row[row.len() - 2].trim().to_string();
        let card_last4 = row[row.len() - 3].trim().to_string();
        let amount_text = row[row.len() - 4].trim().to_string();
        let description = row[row.len() - 5].trim().to_string();
        let post_raw = row[row.len() - 6].trim().to_string();
        let trans_raw = row[row.len() - 7].trim().to_string();

        let Some(amount_cents) = parse_amount_to_cents_from_text(&amount_text) else {
            continue;
        };
        let trans_date = normalize_mmdd(&trans_raw, statement_year, statement_month);
        let post_date = normalize_mmdd(&post_raw, statement_year, statement_month);
        let Some(card_last4) = extract_card_last4(&card_last4) else {
            continue;
        };
        // Guard against segmented/non-transaction rows that happen to contain a numeric amount.
        if trans_date.is_empty() && post_date.is_empty() {
            continue;
        }

        let rel_path = path
            .strip_prefix(root_for_rel)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        out.push(ParsedEmlTransaction {
            source_file: path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string(),
            source_path: rel_path,
            source_row_index,
            statement_year,
            statement_month,
            statement_category: current_statement_category.clone(),
            trans_date,
            post_date,
            description,
            amount_cents,
            card_last4,
            original_amount,
            country_area: country,
        });
    }
    Ok(out)
}

use super::*;

pub(super) fn extract_header(first_page_text: &str) -> Result<PdfHeader, String> {
    let account_no = account_no_re()
        .captures(first_page_text)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
        .ok_or_else(|| "无法识别招商银行流水 PDF 头部信息（账号/日期范围）".to_string())?;
    let caps = date_range_re()
        .captures(first_page_text)
        .ok_or_else(|| "无法识别招商银行流水 PDF 头部信息（账号/日期范围）".to_string())?;
    let range_start = caps
        .get(1)
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    let range_end = caps
        .get(2)
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    Ok(PdfHeader {
        account_last4: account_no
            .chars()
            .rev()
            .take(4)
            .collect::<String>()
            .chars()
            .rev()
            .collect(),
        range_start,
        range_end,
    })
}

pub(super) fn parse_summary_and_counterparty(raw_detail: &str) -> (String, String) {
    let text = raw_detail.trim();
    if text.is_empty() {
        return (String::new(), String::new());
    }
    for prefix in SUMMARY_PREFIXES {
        if text.starts_with(prefix) {
            return (
                (*prefix).to_string(),
                text[prefix.len()..].trim().to_string(),
            );
        }
    }
    let mut split = text.splitn(2, ' ');
    let token = split.next().unwrap_or_default().trim().to_string();
    let rest = split.next().unwrap_or_default().trim().to_string();
    (token, rest)
}

pub(super) fn parse_pdf(pdf_path: &Path) -> Result<(PdfHeader, Vec<BankPdfTransaction>), String> {
    if !pdf_path.exists() || !pdf_path.is_file() {
        return Err(format!("未找到 PDF 文件: {}", pdf_path.to_string_lossy()));
    }

    let full_text = extract_text(pdf_path).map_err(|e| format!("读取 PDF 文本失败: {e}"))?;
    let pages = full_text
        .split('\u{000C}')
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty())
        .collect::<Vec<_>>();
    if pages.is_empty() {
        return Err("PDF 无页面内容".to_string());
    }

    let header = extract_header(&pages[0])?;
    let mut records = Vec::<BankPdfTransaction>::new();

    let skip_prefixes = [
        "记账日期 货币 交易金额 联机余额 交易摘要 对手信息",
        "Date Currency Transaction",
        "Amount Balance Transaction Type Counter Party",
    ];
    let meta_prefixes = [
        "户 名：",
        "户 名:",
        "户\u{00a0}\u{00a0}名：",
        "账户类型：",
        "申请时间：",
        "账号：",
        "开 户 行：",
        "验 证 码：",
    ];
    let meta_exact = [
        "招商银行交易流水",
        "Transaction Statement of China Merchants Bank",
        "Name",
        "Account Type",
        "Date",
        "Account No",
        "Sub Branch",
        "Verification Code",
    ];

    #[derive(Default)]
    struct PendingRow {
        page: i64,
        date: String,
        currency: String,
        amount_text: String,
        balance_text: String,
        raw_detail: String,
    }

    let mut current: Option<PendingRow> = None;
    let flush_current = |current: &mut Option<PendingRow>,
                         out: &mut Vec<BankPdfTransaction>|
     -> Result<(), String> {
        if let Some(p) = current.take() {
            let (summary, counterparty) = parse_summary_and_counterparty(&p.raw_detail);
            let amount_cents = parse_amount_to_cents(&p.amount_text)?;
            out.push(BankPdfTransaction {
                page: p.page,
                date: p.date,
                currency: p.currency,
                amount_text: p.amount_text,
                amount_cents,
                balance_text: p.balance_text,
                raw_detail: p.raw_detail.trim().to_string(),
                summary,
                counterparty,
            });
        }
        Ok(())
    };

    for (page_idx, page_text) in pages.iter().enumerate() {
        for raw_line in page_text.lines() {
            let line = normalize_line(raw_line);
            if line.is_empty() {
                continue;
            }
            if Regex::new(r"^\d+/\d+$")
                .expect("page regex")
                .is_match(&line)
            {
                continue;
            }
            if meta_exact.contains(&line.as_str()) {
                continue;
            }
            if skip_prefixes.iter().any(|p| line.starts_with(p)) {
                continue;
            }
            if meta_prefixes.iter().any(|p| line.starts_with(p)) {
                continue;
            }
            if date_range_re().is_match(&line) && line.contains("--") {
                continue;
            }

            if let Some(m) = row_start_re().captures(&line) {
                flush_current(&mut current, &mut records)?;
                current = Some(PendingRow {
                    page: (page_idx + 1) as i64,
                    date: m.get(1).map(|v| v.as_str().to_string()).unwrap_or_default(),
                    currency: m.get(2).map(|v| v.as_str().to_string()).unwrap_or_default(),
                    amount_text: m.get(3).map(|v| v.as_str().to_string()).unwrap_or_default(),
                    balance_text: m.get(4).map(|v| v.as_str().to_string()).unwrap_or_default(),
                    raw_detail: m.get(5).map(|v| v.as_str().to_string()).unwrap_or_default(),
                });
                continue;
            }

            if let Some(cur) = current.as_mut() {
                cur.raw_detail = format!("{} {}", cur.raw_detail, line).trim().to_string();
            }
        }
    }
    flush_current(&mut current, &mut records)?;
    Ok((header, records))
}

use super::*;

pub(super) fn looks_like_person_counterparty(counterparty: &str) -> Option<String> {
    let text = normalize_counterparty(counterparty);
    if text.is_empty() {
        return None;
    }
    if WECHAT_TRANSFER_PREFIXES.iter().any(|p| text.starts_with(p)) {
        return None;
    }
    let merchant_markers = [
        "公司",
        "银行",
        "基金",
        "理财",
        "中心",
        "管理",
        "有限",
        "科技",
        "股份",
        "平台",
        "商户",
        "机场",
        "高速",
        "停车",
        "美团",
        "肯德基",
        "面馆",
        "智泊",
    ];
    if merchant_markers.iter().any(|m| text.contains(m)) {
        return None;
    }
    person_name_re()
        .captures(&text)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

pub(super) fn loan_key(counterparty: &str) -> String {
    loan_id_re()
        .captures(counterparty)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
        .unwrap_or_else(|| "unknown".to_string())
}

pub(super) fn median_i64(values: &mut [i64]) -> i64 {
    values.sort_unstable();
    let n = values.len();
    if n == 0 {
        return 0;
    }
    if n % 2 == 1 {
        values[n / 2]
    } else {
        let a = values[(n / 2) - 1];
        let b = values[n / 2];
        ((a as i128 + b as i128) / 2) as i64
    }
}

pub(super) fn mortgage_fixed_profiles(
    records: &[BankPdfTransaction],
    historical_records: &[BankPdfTransaction],
) -> HashMap<String, MortgageProfile> {
    let mut grouped: HashMap<String, Vec<i64>> = HashMap::new();
    for rec in records.iter().chain(historical_records.iter()) {
        if rec.currency == "CNY" && rec.summary == "个贷交易" && rec.amount_cents < 0 {
            grouped
                .entry(loan_key(&rec.counterparty))
                .or_default()
                .push(rec.amount_cents.abs());
        }
    }
    let mut out = HashMap::new();
    for (k, mut amounts) in grouped {
        if amounts.is_empty() {
            continue;
        }
        let med = median_i64(&mut amounts);
        let threshold = std::cmp::max((med as f64 * 1.8).round() as i64, med + 300_000);
        out.insert(
            k,
            MortgageProfile {
                count: amounts.len(),
                median_abs_amount_cents: med,
                fixed_threshold_cents: threshold,
            },
        );
    }
    out
}

pub(super) fn load_merchant_map(path: &Path) -> HashMap<String, (String, f64)> {
    let mut out = HashMap::new();
    let Ok(mut rdr) = csv::Reader::from_path(path) else {
        return out;
    };
    for row in rdr.deserialize::<HashMap<String, String>>().flatten() {
        let merchant = row
            .get("merchant_normalized")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let category = row
            .get("expense_category")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        if merchant.is_empty() || category.is_empty() {
            continue;
        }
        let confidence = row
            .get("confidence")
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|v| (0.0..=1.0).contains(v))
            .unwrap_or(0.95);
        out.insert(merchant, (category, confidence));
    }
    out
}

pub(super) fn load_category_rules(path: &Path) -> Vec<CategoryRule> {
    let mut out = Vec::new();
    let Ok(mut rdr) = csv::Reader::from_path(path) else {
        return out;
    };
    for row in rdr.deserialize::<HashMap<String, String>>().flatten() {
        let pattern = row
            .get("pattern")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let expense_category = row
            .get("expense_category")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        if pattern.is_empty() || expense_category.is_empty() {
            continue;
        }
        out.push(CategoryRule {
            priority: row
                .get("priority")
                .and_then(|v| v.trim().parse::<i64>().ok())
                .unwrap_or(999),
            match_type: row
                .get("match_type")
                .map(|s| s.trim().to_lowercase())
                .unwrap_or_else(|| "contains".to_string()),
            pattern,
            expense_category,
            confidence: row
                .get("confidence")
                .and_then(|v| v.trim().parse::<f64>().ok())
                .unwrap_or(0.7)
                .clamp(0.0, 1.0),
        });
    }
    out.sort_by_key(|r| r.priority);
    out
}

pub(super) fn boolish_text(s: &str) -> bool {
    matches!(
        s.trim().to_lowercase().as_str(),
        "1" | "true" | "yes" | "y" | "on"
    )
}

pub(super) fn load_bank_transfer_whitelist_names(path: &Path) -> HashSet<String> {
    let mut names = HashSet::new();
    if let Ok(mut rdr) = csv::Reader::from_path(path) {
        for row in rdr.deserialize::<HashMap<String, String>>().flatten() {
            let name = row
                .get("name")
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            let active = row
                .get("is_active")
                .map(|s| boolish_text(s))
                .unwrap_or(true);
            if active {
                names.insert(name);
            }
        }
    }
    if names.is_empty() {
        for n in DEFAULT_PERSONAL_TRANSFER_WHITELIST {
            names.insert((*n).to_string());
        }
    }
    names
}

pub(super) fn match_rule(rule: &CategoryRule, merchant: &str) -> bool {
    let target = merchant.to_lowercase();
    match rule.match_type.as_str() {
        "exact" => target == rule.pattern.to_lowercase(),
        "prefix" => target.starts_with(&rule.pattern.to_lowercase()),
        "regex" => Regex::new(&rule.pattern)
            .ok()
            .map(|re| re.is_match(merchant))
            .unwrap_or(false),
        _ => rule
            .pattern
            .split('|')
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .any(|part| target.contains(&part.to_lowercase())),
    }
}

pub(super) fn classify_debit_merchant_spend(
    counterparty: &str,
    merchant_map: &HashMap<String, (String, f64)>,
    category_rules: &[CategoryRule],
    review_threshold: f64,
    fallback_category: &str,
) -> (String, f64, i64, String) {
    let merchant = normalize_merchant(&normalize_counterparty(counterparty));
    if merchant_map.is_empty() && category_rules.is_empty() {
        return (
            fallback_category.to_string(),
            0.92,
            0,
            "fallback".to_string(),
        );
    }
    if let Some((category, confidence)) = merchant_map.get(&merchant) {
        return (
            category.clone(),
            *confidence,
            if *confidence < review_threshold { 1 } else { 0 },
            "merchant_map".to_string(),
        );
    }
    for rule in category_rules {
        if match_rule(rule, &merchant) {
            return (
                rule.expense_category.clone(),
                rule.confidence,
                if rule.confidence < review_threshold {
                    1
                } else {
                    0
                },
                "keyword_rule".to_string(),
            );
        }
    }
    ("待分类".to_string(), 0.0, 1, "unmatched".to_string())
}

pub(super) fn is_skip_summary(summary: &str) -> bool {
    INVESTMENT_OR_FX_SUMMARIES.contains(&summary) || SKIP_SUMMARIES_EXTRA.contains(&summary)
}

pub(super) fn classify_transactions(
    header: &PdfHeader,
    records: &[BankPdfTransaction],
    historical_mortgage_records: &[BankPdfTransaction],
    transfer_whitelist: &HashSet<String>,
    merchant_map: &HashMap<String, (String, f64)>,
    category_rules: &[CategoryRule],
    review_threshold: f64,
) -> (Vec<ClassifiedPdfRow>, Value) {
    let _ = header;
    let mortgage_profiles = mortgage_fixed_profiles(records, historical_mortgage_records);
    let mut rows = Vec::<ClassifiedPdfRow>::new();
    let mut counters: BTreeMap<String, i64> = BTreeMap::new();
    let mut amount_cents_by_tag: BTreeMap<String, i64> = BTreeMap::new();

    let mut bump = |tag: &str, amount_cents: Option<i64>| {
        *counters.entry(tag.to_string()).or_insert(0) += 1;
        if let Some(v) = amount_cents {
            *amount_cents_by_tag.entry(tag.to_string()).or_insert(0) += v;
        }
    };

    for tx in records {
        if tx.currency != "CNY" {
            rows.push(ClassifiedPdfRow {
                tx: tx.clone(),
                include_in_import: false,
                include_in_expense_analysis: false,
                rule_tag: "skip_non_cny".to_string(),
                expense_category: "非人民币交易".to_string(),
                direction: "other".to_string(),
                confidence: 1.0,
                needs_review: 0,
                excluded_in_analysis: 1,
                exclude_reason: "非人民币交易，当前版本暂不导入".to_string(),
            });
            bump("skip_non_cny", None);
            continue;
        }

        if tx.summary == "代发工资" && tx.amount_cents > 0 {
            rows.push(ClassifiedPdfRow {
                tx: tx.clone(),
                include_in_import: true,
                include_in_expense_analysis: false,
                rule_tag: "salary".to_string(),
                expense_category: "工资收入".to_string(),
                direction: "income".to_string(),
                confidence: 0.99,
                needs_review: 0,
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
            bump("salary", Some(tx.amount_cents));
            continue;
        }

        if tx.summary == "代发住房公积金" && tx.amount_cents > 0 {
            rows.push(ClassifiedPdfRow {
                tx: tx.clone(),
                include_in_import: true,
                include_in_expense_analysis: false,
                rule_tag: "housing_fund_income".to_string(),
                expense_category: "公积金收入".to_string(),
                direction: "income".to_string(),
                confidence: 0.99,
                needs_review: 0,
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
            bump("housing_fund_income", Some(tx.amount_cents));
            continue;
        }

        if tx.summary == "个贷交易" && tx.amount_cents < 0 {
            let key = loan_key(&tx.counterparty);
            let profile = mortgage_profiles.get(&key);
            let is_fixed = profile
                .map(|p| p.count >= 3 && tx.amount_cents.abs() <= p.fixed_threshold_cents)
                .unwrap_or(false);
            if is_fixed {
                rows.push(ClassifiedPdfRow {
                    tx: tx.clone(),
                    include_in_import: true,
                    include_in_expense_analysis: true,
                    rule_tag: "mortgage_fixed".to_string(),
                    expense_category: "房贷固定还款".to_string(),
                    direction: "expense".to_string(),
                    confidence: 0.95,
                    needs_review: 0,
                    excluded_in_analysis: 0,
                    exclude_reason: String::new(),
                });
                bump("mortgage_fixed", Some(tx.amount_cents));
            } else {
                rows.push(ClassifiedPdfRow {
                    tx: tx.clone(),
                    include_in_import: false,
                    include_in_expense_analysis: false,
                    rule_tag: "skip_mortgage_early_or_unknown".to_string(),
                    expense_category: "房贷提前还款/异常".to_string(),
                    direction: "expense".to_string(),
                    confidence: 0.9,
                    needs_review: 0,
                    excluded_in_analysis: 1,
                    exclude_reason: "仅统计固定月供；提前还贷/异常金额已忽略".to_string(),
                });
                bump("skip_mortgage_early_or_unknown", Some(tx.amount_cents));
            }
            continue;
        }

        if tx.summary == "本行ATM无卡取款" && tx.amount_cents < 0 {
            rows.push(ClassifiedPdfRow {
                tx: tx.clone(),
                include_in_import: true,
                include_in_expense_analysis: true,
                rule_tag: "atm_cash".to_string(),
                expense_category: "ATM取现".to_string(),
                direction: "expense".to_string(),
                confidence: 0.99,
                needs_review: 0,
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
            bump("atm_cash", Some(tx.amount_cents));
            continue;
        }

        if BANK_TRANSFER_OUT_SUMMARIES.contains(&tx.summary.as_str()) && tx.amount_cents < 0 {
            if let Some(person_name) = looks_like_person_counterparty(&tx.counterparty) {
                if transfer_whitelist.contains(&person_name) {
                    rows.push(ClassifiedPdfRow {
                        tx: tx.clone(),
                        include_in_import: true,
                        include_in_expense_analysis: true,
                        rule_tag: "bank_transfer_whitelist".to_string(),
                        expense_category: format!("个人转账(白名单:{person_name})"),
                        direction: "expense".to_string(),
                        confidence: 0.95,
                        needs_review: 0,
                        excluded_in_analysis: 0,
                        exclude_reason: String::new(),
                    });
                    bump("bank_transfer_whitelist", Some(tx.amount_cents));
                } else {
                    rows.push(ClassifiedPdfRow {
                        tx: tx.clone(),
                        include_in_import: false,
                        include_in_expense_analysis: false,
                        rule_tag: "skip_bank_transfer_non_whitelist".to_string(),
                        expense_category: "银行卡个人转账(非白名单)".to_string(),
                        direction: "transfer".to_string(),
                        confidence: 0.9,
                        needs_review: 0,
                        excluded_in_analysis: 1,
                        exclude_reason: "银行卡个人转账仅统计白名单对象".to_string(),
                    });
                    bump("skip_bank_transfer_non_whitelist", Some(tx.amount_cents));
                }
                continue;
            }
        }

        if DEBIT_PAYMENT_SUMMARIES.contains(&tx.summary.as_str()) && tx.amount_cents < 0 {
            let counterparty = normalize_counterparty(&tx.counterparty);
            let is_wechat_p2p = ["快捷支付", "银联快捷支付"].contains(&tx.summary.as_str())
                && WECHAT_TRANSFER_PREFIXES
                    .iter()
                    .any(|p| counterparty.starts_with(p));
            if is_wechat_p2p {
                rows.push(ClassifiedPdfRow {
                    tx: tx.clone(),
                    include_in_import: true,
                    include_in_expense_analysis: true,
                    rule_tag: "wechat_transfer_redpacket".to_string(),
                    expense_category: "微信转账/红包".to_string(),
                    direction: "expense".to_string(),
                    confidence: 0.95,
                    needs_review: 0,
                    excluded_in_analysis: 0,
                    exclude_reason: String::new(),
                });
                bump("wechat_transfer_redpacket", Some(tx.amount_cents));
                continue;
            }

            let allow_quickpay_person_heuristic =
                QUICKPAY_PERSON_DETECTION_SUMMARIES.contains(&tx.summary.as_str());
            if allow_quickpay_person_heuristic {
                if let Some(person_name) = looks_like_person_counterparty(&counterparty) {
                    rows.push(ClassifiedPdfRow {
                        tx: tx.clone(),
                        include_in_import: false,
                        include_in_expense_analysis: false,
                        rule_tag: "skip_quickpay_person_non_whitelist".to_string(),
                        expense_category: format!("个人转账(非白名单:{person_name})"),
                        direction: "transfer".to_string(),
                        confidence: 0.85,
                        needs_review: 0,
                        excluded_in_analysis: 1,
                        exclude_reason: "个人转账仅统计微信转账/红包；快捷支付实名个人默认忽略"
                            .to_string(),
                    });
                    bump("skip_quickpay_person_non_whitelist", Some(tx.amount_cents));
                    continue;
                }
            }

            let fallback_category = if ["快捷支付", "银联快捷支付"].contains(&tx.summary.as_str())
            {
                "借记卡商户消费"
            } else {
                "借记卡直接商户消费"
            };
            let (category, conf, needs_review, match_source) = classify_debit_merchant_spend(
                &counterparty,
                merchant_map,
                category_rules,
                review_threshold,
                fallback_category,
            );
            rows.push(ClassifiedPdfRow {
                tx: tx.clone(),
                include_in_import: true,
                include_in_expense_analysis: true,
                rule_tag: if match_source == "fallback" {
                    "debit_merchant_spend".to_string()
                } else {
                    format!("debit_merchant_spend_{match_source}")
                },
                expense_category: category,
                direction: "expense".to_string(),
                confidence: conf,
                needs_review,
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
            bump("debit_merchant_spend", Some(tx.amount_cents));
            continue;
        }

        if is_skip_summary(&tx.summary) {
            rows.push(ClassifiedPdfRow {
                tx: tx.clone(),
                include_in_import: false,
                include_in_expense_analysis: false,
                rule_tag: "skip_irrelevant_summary".to_string(),
                expense_category: "忽略项".to_string(),
                direction: "other".to_string(),
                confidence: 0.99,
                needs_review: 0,
                excluded_in_analysis: 1,
                exclude_reason: "按规则忽略（投资/还款/转入等）".to_string(),
            });
            bump("skip_irrelevant_summary", Some(tx.amount_cents));
            continue;
        }

        rows.push(ClassifiedPdfRow {
            tx: tx.clone(),
            include_in_import: false,
            include_in_expense_analysis: false,
            rule_tag: "skip_unclassified".to_string(),
            expense_category: "未纳入口径".to_string(),
            direction: "other".to_string(),
            confidence: 0.5,
            needs_review: 1,
            excluded_in_analysis: 1,
            exclude_reason: "当前规则未纳入该类型".to_string(),
        });
        bump("skip_unclassified", Some(tx.amount_cents));
    }

    let total_records = records.len();
    let cny_records = records.iter().filter(|t| t.currency == "CNY").count();
    let non_cny_records = total_records.saturating_sub(cny_records);
    let import_rows_count = rows.iter().filter(|r| r.include_in_import).count();
    let expense_rows_count = rows
        .iter()
        .filter(|r| r.include_in_import && r.direction == "expense")
        .count();
    let income_rows_count = rows
        .iter()
        .filter(|r| r.include_in_import && r.direction == "income")
        .count();
    let expense_total_cents: i64 = rows
        .iter()
        .filter(|r| r.include_in_import && r.direction == "expense")
        .map(|r| r.tx.amount_cents)
        .sum();
    let income_total_cents: i64 = rows
        .iter()
        .filter(|r| r.include_in_import && r.direction == "income")
        .map(|r| r.tx.amount_cents)
        .sum();

    let samples_by_tag = |tag: &str| {
        rows.iter()
            .filter(|r| r.rule_tag == tag)
            .take(8)
            .map(|r| {
                json!({
                    "date": r.tx.date,
                    "amount": r.tx.amount_text,
                    "counterparty": r.tx.counterparty,
                })
            })
            .collect::<Vec<_>>()
    };

    let mortgage_profiles_json = mortgage_profiles
        .iter()
        .map(|(k, p)| {
            (
                k.clone(),
                json!({
                    "count": p.count,
                    "median_abs_amount_cents": p.median_abs_amount_cents,
                    "fixed_threshold_cents": p.fixed_threshold_cents,
                }),
            )
        })
        .collect::<serde_json::Map<String, Value>>();

    let preview = json!({
        "header": {
            "account_last4": header.account_last4,
            "range_start": header.range_start,
            "range_end": header.range_end,
        },
        "summary": {
            "total_records": total_records,
            "cny_records": cny_records,
            "non_cny_records": non_cny_records,
            "import_rows_count": import_rows_count,
            "expense_rows_count": expense_rows_count,
            "income_rows_count": income_rows_count,
            "expense_total_cents": expense_total_cents,
            "income_total_cents": income_total_cents,
            "skipped_rows_count": total_records.saturating_sub(import_rows_count),
            "date_start": records.first().map(|r| r.date.clone()),
            "date_end": records.last().map(|r| r.date.clone()),
        },
        "rule_counts": counters,
        "rule_amount_cents": amount_cents_by_tag,
        "mortgage_profiles": mortgage_profiles_json,
        "samples": {
            "salary": samples_by_tag("salary"),
            "mortgage_skipped": samples_by_tag("skip_mortgage_early_or_unknown"),
            "bank_transfer_whitelist": samples_by_tag("bank_transfer_whitelist"),
        }
    });

    (rows, preview)
}

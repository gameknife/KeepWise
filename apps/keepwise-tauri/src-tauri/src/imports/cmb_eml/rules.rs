use super::*;

pub(super) fn normalize_merchant(text: &str) -> String {
    let mut merchant = trim_text(text);
    merchant = rate_suffix_re().replace(&merchant, "").trim().to_string();
    if let Some(rest) = merchant.strip_prefix("ULT-") {
        merchant = rest.trim().to_string();
    }
    loop {
        let next = channel_prefix_re()
            .replace(&merchant, "")
            .trim()
            .to_string();
        if next == merchant {
            break;
        }
        merchant = next;
    }
    merchant
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
        let priority = row
            .get("priority")
            .and_then(|v| v.trim().parse::<i64>().ok())
            .unwrap_or(999);
        let match_type = row
            .get("match_type")
            .map(|s| s.trim().to_lowercase())
            .unwrap_or_else(|| "contains".to_string());
        let pattern = row
            .get("pattern")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let expense_category = row
            .get("expense_category")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let confidence = row
            .get("confidence")
            .and_then(|v| v.trim().parse::<f64>().ok())
            .unwrap_or(0.7)
            .clamp(0.0, 1.0);
        if pattern.is_empty() || expense_category.is_empty() {
            continue;
        }
        out.push(CategoryRule {
            priority,
            match_type,
            pattern,
            expense_category,
            confidence,
        });
    }
    out.sort_by_key(|r| r.priority);
    out
}

pub(super) fn parse_enabled_flag(raw: &str) -> bool {
    matches!(
        raw.trim().to_lowercase().as_str(),
        "1" | "true" | "yes" | "y" | "on"
    )
}

pub(super) fn load_analysis_exclusion_rules(path: &Path) -> Vec<AnalysisExclusionRule> {
    let mut out = Vec::new();
    let Ok(mut rdr) = csv::Reader::from_path(path) else {
        return out;
    };
    for row in rdr.deserialize::<HashMap<String, String>>().flatten() {
        if !parse_enabled_flag(row.get("enabled").map(String::as_str).unwrap_or("")) {
            continue;
        }
        let min_amount_cents = row
            .get("min_amount")
            .map(String::as_str)
            .unwrap_or("")
            .trim()
            .strip_prefix('￥')
            .unwrap_or(row.get("min_amount").map(String::as_str).unwrap_or(""))
            .trim()
            .to_string();
        let max_amount_cents = row
            .get("max_amount")
            .map(String::as_str)
            .unwrap_or("")
            .trim()
            .strip_prefix('￥')
            .unwrap_or(row.get("max_amount").map(String::as_str).unwrap_or(""))
            .trim()
            .to_string();

        out.push(AnalysisExclusionRule {
            rule_name: row
                .get("rule_name")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            merchant_contains: row
                .get("merchant_contains")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            description_contains: row
                .get("description_contains")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            expense_category: row
                .get("expense_category")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            min_amount_cents: if min_amount_cents.is_empty() {
                None
            } else {
                parse_amount_text_to_cents(&min_amount_cents).ok()
            },
            max_amount_cents: if max_amount_cents.is_empty() {
                None
            } else {
                parse_amount_text_to_cents(&max_amount_cents).ok()
            },
            start_date: row
                .get("start_date")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            end_date: row
                .get("end_date")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            reason: row
                .get("reason")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "排除分析".to_string()),
        });
    }
    out
}

pub(super) fn match_rule(rule: &CategoryRule, merchant: &str) -> bool {
    let target = merchant.to_lowercase();
    match rule.match_type.as_str() {
        "exact" => target == rule.pattern.to_lowercase(),
        "prefix" => target.starts_with(&rule.pattern.to_lowercase()),
        "regex" => Regex::new(&rule.pattern)
            .ok()
            .and_then(|re| re.is_match(merchant).then_some(true))
            .unwrap_or(false),
        _ => rule
            .pattern
            .split('|')
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .any(|part| target.contains(&part.to_lowercase())),
    }
}

pub(super) fn classify_transactions(
    records: Vec<ParsedEmlTransaction>,
    merchant_map: &HashMap<String, (String, f64)>,
    rules: &[CategoryRule],
    review_threshold: f64,
) -> Vec<ClassifiedTransaction> {
    let mut out = Vec::with_capacity(records.len());
    for txn in records {
        let merchant = normalize_merchant(&txn.description);
        if txn.statement_category != "消费" {
            let statement_category = txn.statement_category.clone();
            out.push(ClassifiedTransaction {
                txn,
                merchant_normalized: merchant,
                expense_category: format!("非消费/{statement_category}"),
                classify_source: "statement_category".to_string(),
                confidence: 1.0,
                needs_review: 0,
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
            continue;
        }

        if let Some((category, confidence)) = merchant_map.get(&merchant) {
            out.push(ClassifiedTransaction {
                txn,
                merchant_normalized: merchant,
                expense_category: category.clone(),
                classify_source: "merchant_map".to_string(),
                confidence: *confidence,
                needs_review: if *confidence < review_threshold { 1 } else { 0 },
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
            continue;
        }

        let mut matched: Option<(&CategoryRule, String)> = None;
        for rule in rules {
            if match_rule(rule, &merchant) {
                matched = Some((rule, format!("rule:{}:{}", rule.match_type, rule.pattern)));
                break;
            }
        }

        if let Some((rule, source)) = matched {
            out.push(ClassifiedTransaction {
                txn,
                merchant_normalized: merchant,
                expense_category: rule.expense_category.clone(),
                classify_source: source,
                confidence: rule.confidence,
                needs_review: if rule.confidence < review_threshold {
                    1
                } else {
                    0
                },
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
        } else {
            out.push(ClassifiedTransaction {
                txn,
                merchant_normalized: merchant,
                expense_category: "待分类".to_string(),
                classify_source: "unmatched".to_string(),
                confidence: 0.0,
                needs_review: 1,
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
        }
    }
    out
}

pub(super) fn in_date_range(post_date: &str, start_date: &str, end_date: &str) -> bool {
    if post_date.is_empty() {
        return false;
    }
    if !start_date.is_empty() && post_date < start_date {
        return false;
    }
    if !end_date.is_empty() && post_date > end_date {
        return false;
    }
    true
}

pub(super) fn matches_exclusion_rule(
    rec: &ClassifiedTransaction,
    rule: &AnalysisExclusionRule,
) -> bool {
    if rec.txn.statement_category != "消费" {
        return false;
    }
    if !rule.expense_category.is_empty() && rec.expense_category != rule.expense_category {
        return false;
    }
    if !rule.merchant_contains.is_empty()
        && !rec
            .merchant_normalized
            .to_lowercase()
            .contains(&rule.merchant_contains.to_lowercase())
    {
        return false;
    }
    if !rule.description_contains.is_empty()
        && !rec
            .txn
            .description
            .to_lowercase()
            .contains(&rule.description_contains.to_lowercase())
    {
        return false;
    }
    if let Some(min) = rule.min_amount_cents {
        if rec.txn.amount_cents < min {
            return false;
        }
    }
    if let Some(max) = rule.max_amount_cents {
        if rec.txn.amount_cents > max {
            return false;
        }
    }
    if (!rule.start_date.is_empty() || !rule.end_date.is_empty())
        && !in_date_range(&rec.txn.post_date, &rule.start_date, &rule.end_date)
    {
        return false;
    }
    true
}

pub(super) fn apply_analysis_exclusions(
    records: &mut [ClassifiedTransaction],
    rules: &[AnalysisExclusionRule],
) {
    if rules.is_empty() {
        return;
    }
    for rec in records.iter_mut() {
        rec.excluded_in_analysis = 0;
        rec.exclude_reason.clear();
        for rule in rules {
            if matches_exclusion_rule(rec, rule) {
                rec.excluded_in_analysis = 1;
                rec.exclude_reason = format!(
                    "{}: {}",
                    if rule.rule_name.is_empty() {
                        "custom"
                    } else {
                        &rule.rule_name
                    },
                    rule.reason
                );
                break;
            }
        }
    }
}

pub(super) fn load_rules_bundle(
    rules_dir: &Path,
) -> (
    HashMap<String, (String, f64)>,
    Vec<CategoryRule>,
    Vec<AnalysisExclusionRule>,
) {
    (
        load_merchant_map(&rules_dir.join("merchant_map.csv")),
        load_category_rules(&rules_dir.join("category_rules.csv")),
        load_analysis_exclusion_rules(&rules_dir.join("analysis_exclusions.csv")),
    )
}

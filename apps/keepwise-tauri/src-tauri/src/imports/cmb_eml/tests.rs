use super::*;
use crate::test_support::{apply_all_migrations_for_test, create_temp_test_db};
use std::collections::BTreeSet;

fn fixture_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/cmb_eml")
        .join(relative)
}

fn rules_seed_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("seeds/rules")
}

#[test]
fn parses_2025_sample_with_stable_card_last4_set() {
    let sample_dir = fixture_path("2025");
    if !sample_dir.exists() {
        return;
    }
    let (classified, summary) = parse_and_classify_emls(&sample_dir, DEFAULT_REVIEW_THRESHOLD)
        .expect("parse sample eml dir");
    assert!(
        !classified.is_empty(),
        "expected parsed transactions from sample dir"
    );
    assert!(
        summary.input_files_count > 0,
        "expected sample dir to contain eml files"
    );

    let mut card_set = BTreeSet::new();
    for row in &classified {
        let last4 = row.txn.card_last4.trim();
        assert_eq!(
            last4.len(),
            4,
            "unexpected card_last4 length from row: {:?}",
            row.txn
        );
        assert!(
            last4.chars().all(|c| c.is_ascii_digit()),
            "unexpected non-digit card_last4 from row: {:?}",
            row.txn
        );
        card_set.insert(last4.to_string());
    }

    // Current 2025 sample set should be a very small number of credit card tails.
    assert!(
        card_set.len() <= 4,
        "too many distinct card tails parsed from sample: {:?}",
        card_set
    );
}

#[test]
fn sample_2025_transaction_ids_are_unique_and_stable_across_parses() {
    let sample_dir = fixture_path("2025");
    if !sample_dir.exists() {
        return;
    }

    let (classified_a, _) =
        parse_and_classify_emls(&sample_dir, DEFAULT_REVIEW_THRESHOLD).expect("first parse");
    let (classified_b, _) =
        parse_and_classify_emls(&sample_dir, DEFAULT_REVIEW_THRESHOLD).expect("second parse");

    let ids_a = classified_a
        .iter()
        .map(|rec| transaction_id(rec, DEFAULT_SOURCE_TYPE))
        .collect::<Vec<_>>();
    let ids_b = classified_b
        .iter()
        .map(|rec| transaction_id(rec, DEFAULT_SOURCE_TYPE))
        .collect::<Vec<_>>();

    assert_eq!(
        ids_a, ids_b,
        "transaction id sequence should be stable across repeated parses"
    );

    let unique = ids_a.iter().collect::<BTreeSet<_>>();
    assert_eq!(
        unique.len(),
        ids_a.len(),
        "transaction ids should be unique within parsed sample"
    );
}

#[test]
fn importing_same_2025_samples_twice_is_idempotent_for_transactions() {
    let sample_dir = fixture_path("2025");
    if !sample_dir.exists() {
        return;
    }

    let db_path = create_temp_test_db();
    apply_all_migrations_for_test(&db_path);
    let rules_dir = rules_seed_dir();

    let import1 = cmb_eml_import_at_db_path(
        &db_path,
        &sample_dir,
        DEFAULT_REVIEW_THRESHOLD,
        DEFAULT_SOURCE_TYPE,
        &rules_dir,
    )
    .expect("first import");
    let import2 = cmb_eml_import_at_db_path(
        &db_path,
        &sample_dir,
        DEFAULT_REVIEW_THRESHOLD,
        DEFAULT_SOURCE_TYPE,
        &rules_dir,
    )
    .expect("second import");

    let conn = Connection::open(&db_path).expect("open temp db for count");
    let total_tx: i64 = conn
        .query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0))
        .expect("count transactions");

    let imported1 = import1
        .get("imported_count")
        .and_then(Value::as_i64)
        .expect("import1.imported_count");
    let imported2 = import2
        .get("imported_count")
        .and_then(Value::as_i64)
        .expect("import2.imported_count");

    assert!(
        imported1 > 0,
        "first import should import sample transactions"
    );
    assert_eq!(
        total_tx, imported1,
        "second import should upsert existing transactions instead of creating duplicates"
    );
    assert_eq!(
        imported2, imported1,
        "second import still processes all rows, but should not increase transaction row count"
    );

    let _ = fs::remove_file(&db_path);
}

#[test]
fn parses_problematic_2026_sample_file_with_expected_row_count() {
    let sample_file = fixture_path("2026/招商银行信用卡电子账单 (12).eml");
    if !sample_file.exists() {
        return;
    }
    let rows = parse_single_eml(&sample_file, sample_file.parent().expect("parent"))
        .expect("parse problematic 2026 sample file");
    assert_eq!(
        rows.len(),
        118,
        "parser row count for known problematic sample drifted; likely table extraction regressed"
    );
}

#[test]
fn preview_problematic_2026_sample_summary_matches_expected_counts() {
    let sample_file = fixture_path("2026/招商银行信用卡电子账单 (12).eml");
    if !sample_file.exists() {
        return;
    }
    let rules_dir = rules_seed_dir();
    let preview =
        cmb_eml_preview_at_path_with_rules_dir(&sample_file, DEFAULT_REVIEW_THRESHOLD, &rules_dir)
            .expect("preview problematic 2026 sample");
    let summary = preview
        .get("summary")
        .and_then(Value::as_object)
        .expect("preview.summary object");
    assert_eq!(
        summary.get("records_count").and_then(Value::as_u64),
        Some(118),
        "records_count drifted for known problematic sample"
    );
    assert_eq!(
        summary.get("consume_count").and_then(Value::as_u64),
        Some(113),
        "consume_count drifted for known problematic sample"
    );
    assert_eq!(
        summary.get("needs_review_count").and_then(Value::as_u64),
        Some(22),
        "needs_review_count drifted for known problematic sample"
    );
}

#[test]
#[ignore]
fn debug_problematic_2026_sample_preview_summary() {
    let sample_file = fixture_path("2026/招商银行信用卡电子账单 (12).eml");
    if !sample_file.exists() {
        return;
    }
    let (_classified, summary) =
        parse_and_classify_emls(&sample_file, DEFAULT_REVIEW_THRESHOLD).expect("preview summary");
    eprintln!(
        "records={} consume={} review={} excluded={}",
        summary.records_count,
        summary.consume_count,
        summary.needs_review_count,
        summary.excluded_count
    );
}

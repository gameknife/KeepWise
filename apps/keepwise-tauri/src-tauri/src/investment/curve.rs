use super::*;

pub(super) fn interpolate_i64(start: i64, end: i64, ratio: f64) -> i64 {
    round_to(start as f64 + (end - start) as f64 * ratio, 0) as i64
}

pub(super) fn interpolate_opt_f64(start: Option<f64>, end: Option<f64>, ratio: f64) -> Option<f64> {
    match (start, end) {
        (Some(a), Some(b)) => Some(round_to(a + (b - a) * ratio, 8)),
        (Some(a), None) => Some(round_to(a, 8)),
        (None, Some(b)) => Some(round_to(b, 8)),
        (None, None) => None,
    }
}

pub(super) fn curve_row_to_json(
    row: &CurveAnchorRow,
    is_interpolated: bool,
    anchor_from_date: NaiveDate,
    anchor_to_date: NaiveDate,
) -> Value {
    let row_is_interpolated = is_interpolated || !row.is_observed;
    let mut payload = json!({
        "snapshot_date": row.snapshot_date.format("%Y-%m-%d").to_string(),
        "effective_snapshot_date": row.effective_snapshot_date.format("%Y-%m-%d").to_string(),
        "total_assets_cents": row.total_assets_cents,
        "total_assets_yuan": cents_to_yuan_text(row.total_assets_cents),
        "transfer_amount_cents": row.transfer_amount_cents,
        "transfer_amount_yuan": cents_to_yuan_text(row.transfer_amount_cents),
        "cumulative_net_growth_cents": row.cumulative_net_growth_cents,
        "cumulative_net_growth_yuan": cents_to_yuan_text(row.cumulative_net_growth_cents),
        "cumulative_return_rate": row.cumulative_return_rate,
        "cumulative_return_pct": row
            .cumulative_return_rate
            .map(|value| round_to(value * 100.0, 4)),
        "cumulative_return_pct_text": row
            .cumulative_return_rate
            .map(|value| format!("{:.2}%", value * 100.0)),
        "is_interpolated": row_is_interpolated,
        "anchor_from_snapshot_date": anchor_from_date.format("%Y-%m-%d").to_string(),
        "anchor_to_snapshot_date": anchor_to_date.format("%Y-%m-%d").to_string(),
    });
    if !row.transfer_details.is_empty() {
        payload["transfer_details"] = json!(row
            .transfer_details
            .iter()
            .map(|detail| {
                json!({
                    "account_id": detail.account_id,
                    "account_name": detail.account_name,
                    "transfer_amount_cents": detail.transfer_amount_cents,
                    "transfer_amount_yuan": cents_to_yuan_text(detail.transfer_amount_cents),
                })
            })
            .collect::<Vec<_>>());
    }
    payload
}

pub(super) fn interpolate_curve_rows_daily(anchors: &[CurveAnchorRow]) -> Vec<Value> {
    if anchors.is_empty() {
        return Vec::new();
    }

    let mut rows = Vec::<Value>::new();
    for (index, anchor) in anchors.iter().enumerate() {
        rows.push(curve_row_to_json(
            anchor,
            false,
            anchor.snapshot_date,
            anchor.snapshot_date,
        ));

        let Some(next_anchor) = anchors.get(index + 1) else {
            continue;
        };
        let gap_days = (next_anchor.snapshot_date - anchor.snapshot_date).num_days();
        if gap_days <= 1 {
            continue;
        }

        for day_offset in 1..gap_days {
            let snapshot_date = anchor.snapshot_date + Duration::days(day_offset);
            let ratio = day_offset as f64 / gap_days as f64;
            let interpolated_row = CurveAnchorRow {
                snapshot_date,
                effective_snapshot_date: snapshot_date,
                total_assets_cents: interpolate_i64(
                    anchor.total_assets_cents,
                    next_anchor.total_assets_cents,
                    ratio,
                ),
                transfer_amount_cents: 0,
                transfer_details: Vec::new(),
                cumulative_net_growth_cents: interpolate_i64(
                    anchor.cumulative_net_growth_cents,
                    next_anchor.cumulative_net_growth_cents,
                    ratio,
                ),
                cumulative_return_rate: interpolate_opt_f64(
                    anchor.cumulative_return_rate,
                    next_anchor.cumulative_return_rate,
                    ratio,
                ),
                is_observed: false,
            };
            rows.push(curve_row_to_json(
                &interpolated_row,
                true,
                anchor.snapshot_date,
                next_anchor.snapshot_date,
            ));
        }
    }

    rows
}

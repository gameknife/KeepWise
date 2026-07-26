pub(crate) mod cmb_eml;
pub(crate) mod cmb_pdf;
pub(crate) mod yzxy;

fn resolve_review_threshold(raw: Option<f64>, default_value: f64) -> Result<f64, String> {
    let value = raw.unwrap_or(default_value);
    if !(0.0..=1.0).contains(&value) {
        return Err("review_threshold 必须在 0~1 之间".to_string());
    }
    Ok(value)
}

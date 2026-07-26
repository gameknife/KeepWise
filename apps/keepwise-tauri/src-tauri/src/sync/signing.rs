use super::*;

pub(super) fn is_unreserved(ch: u8) -> bool {
    ch.is_ascii_alphanumeric() || ch == b'-' || ch == b'_' || ch == b'.' || ch == b'~'
}

pub(super) fn encode_rfc3986(input: &str) -> String {
    let mut out = String::new();
    for b in input.as_bytes() {
        if is_unreserved(*b) {
            out.push(*b as char);
        } else {
            out.push('%');
            out.push_str(&format!("{:02X}", b));
        }
    }
    out
}

pub(super) fn encode_uri_path(path: &str) -> String {
    let mut out = String::new();
    for b in path.as_bytes() {
        if *b == b'/' || is_unreserved(*b) {
            out.push(*b as char);
        } else {
            out.push('%');
            out.push_str(&format!("{:02X}", b));
        }
    }
    if out.is_empty() {
        "/".to_string()
    } else {
        out
    }
}

pub(super) fn build_canonical_query(query: &[(String, String)]) -> String {
    let mut encoded = query
        .iter()
        .map(|(k, v)| (encode_rfc3986(k), encode_rfc3986(v)))
        .collect::<Vec<_>>();
    encoded.sort_by(|a, b| {
        if a.0 == b.0 {
            a.1.cmp(&b.1)
        } else {
            a.0.cmp(&b.0)
        }
    });
    encoded
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&")
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub(super) fn hmac_sign(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let mut mac =
        <HmacSha256 as Mac>::new_from_slice(key).map_err(|e| format!("初始化 HMAC 失败: {e}"))?;
    mac.update(data);
    Ok(mac.finalize().into_bytes().to_vec())
}

pub(super) fn build_signing_key(
    secret_key: &str,
    date_stamp: &str,
    region: &str,
) -> Result<Vec<u8>, String> {
    let k_date = hmac_sign(
        format!("AWS4{}", secret_key).as_bytes(),
        date_stamp.as_bytes(),
    )?;
    let k_region = hmac_sign(&k_date, region.as_bytes())?;
    let k_service = hmac_sign(&k_region, SERVICE_NAME_S3.as_bytes())?;
    hmac_sign(&k_service, b"aws4_request")
}

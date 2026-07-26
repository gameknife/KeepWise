use super::*;

impl<'a> S3Client<'a> {
    pub(super) fn new(cfg: &'a PersistedSyncConfig) -> Result<Self, String> {
        let client = Client::builder()
            .connect_timeout(StdDuration::from_secs(5))
            .timeout(StdDuration::from_secs(20))
            .build()
            .map_err(|e| format!("初始化 HTTP 客户端失败: {e}"))?;
        Ok(Self { cfg, client })
    }

    pub(super) fn build_target(&self, object_key: Option<&str>) -> Result<S3Target, String> {
        let endpoint = self.cfg.endpoint.trim();
        if endpoint.is_empty() {
            return Err("endpoint 不能为空".to_string());
        }
        let parsed = Url::parse(endpoint).map_err(|e| format!("endpoint 非法: {e}"))?;
        let scheme = parsed.scheme();
        let base_host = parsed
            .host_str()
            .ok_or_else(|| "endpoint 缺少 host".to_string())?;
        let host_with_port = if let Some(port) = parsed.port() {
            format!("{base_host}:{port}")
        } else {
            base_host.to_string()
        };
        let base_path = {
            let raw = parsed.path().trim_end_matches('/');
            if raw == "/" {
                "".to_string()
            } else {
                raw.to_string()
            }
        };
        let key = object_key.unwrap_or("").trim_start_matches('/');

        let force_virtual_host = object_key.is_none();
        let (host_for_url, host_header, raw_path) = if self.cfg.path_style && !force_virtual_host {
            let mut path = String::new();
            if !base_path.is_empty() {
                path.push_str(&base_path);
            }
            path.push('/');
            path.push_str(self.cfg.bucket.trim());
            if !key.is_empty() {
                path.push('/');
                path.push_str(key);
            }
            if path.is_empty() {
                path.push('/');
            }
            (host_with_port.clone(), host_with_port, path)
        } else {
            let host_core = if let Some((host, _)) = host_with_port.split_once(':') {
                host.to_string()
            } else {
                host_with_port.clone()
            };
            let host_vhost = if let Some((_, port)) = host_with_port.split_once(':') {
                format!("{}.{}:{port}", self.cfg.bucket.trim(), host_core)
            } else {
                format!("{}.{}", self.cfg.bucket.trim(), host_core)
            };
            let mut path = String::new();
            if !base_path.is_empty() {
                path.push_str(&base_path);
            }
            if !path.ends_with('/') {
                path.push('/');
            }
            if !key.is_empty() {
                path.push_str(key);
            }
            if path.is_empty() {
                path.push('/');
            }
            (host_vhost.clone(), host_vhost, path)
        };

        let canonical_uri = encode_uri_path(&raw_path);
        let url = format!("{scheme}://{host_for_url}{canonical_uri}");
        Ok(S3Target {
            url,
            host: host_header,
            canonical_uri,
        })
    }

    pub(super) fn signed_request(
        &self,
        method: &str,
        object_key: Option<&str>,
        query: &[(String, String)],
        body: &[u8],
        content_type: Option<&str>,
    ) -> Result<S3Response, String> {
        let target = self.build_target(object_key)?;
        let canonical_query = build_canonical_query(query);
        let request_url = if canonical_query.is_empty() {
            target.url.clone()
        } else {
            format!("{}?{}", target.url, canonical_query)
        };

        for attempt in 0..S3_REQUEST_MAX_ATTEMPTS {
            let amz_date = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
            let date_stamp = Utc::now().format("%Y%m%d").to_string();
            let payload_hash = sha256_hex(body);

            let mut canonical_headers = BTreeMap::<String, String>::new();
            canonical_headers.insert("host".to_string(), target.host.clone());
            canonical_headers.insert("x-amz-content-sha256".to_string(), payload_hash.clone());
            canonical_headers.insert("x-amz-date".to_string(), amz_date.clone());
            if let Some(app_id) = self.cfg.app_id.as_ref() {
                let appid = app_id.trim();
                if !appid.is_empty() {
                    canonical_headers.insert("appid".to_string(), appid.to_string());
                    canonical_headers.insert("x-cos-appid".to_string(), appid.to_string());
                }
            }
            if let Some(token) = self.cfg.session_token.as_ref() {
                if !token.trim().is_empty() {
                    canonical_headers
                        .insert("x-amz-security-token".to_string(), token.trim().to_string());
                }
            }

            let signed_headers = canonical_headers
                .keys()
                .map(|k| k.as_str())
                .collect::<Vec<_>>()
                .join(";");
            let canonical_headers_text = canonical_headers
                .iter()
                .map(|(k, v)| format!("{}:{}\n", k, v.trim()))
                .collect::<String>();

            let canonical_request = format!(
                "{}\n{}\n{}\n{}\n{}\n{}",
                method.to_uppercase(),
                target.canonical_uri,
                canonical_query,
                canonical_headers_text,
                signed_headers,
                payload_hash
            );
            let credential_scope = format!(
                "{}/{}/{}/aws4_request",
                date_stamp,
                self.cfg.region.trim(),
                SERVICE_NAME_S3
            );
            let string_to_sign = format!(
                "AWS4-HMAC-SHA256\n{}\n{}\n{}",
                amz_date,
                credential_scope,
                sha256_hex(canonical_request.as_bytes())
            );
            let signing_key =
                build_signing_key(&self.cfg.secret_key, &date_stamp, self.cfg.region.trim())?;
            let signature = hex::encode(hmac_sign(&signing_key, string_to_sign.as_bytes())?);
            let authorization = format!(
                "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
                self.cfg.access_key_id.trim(),
                credential_scope,
                signed_headers,
                signature
            );

            let method_parsed = Method::from_bytes(method.as_bytes())
                .map_err(|e| format!("HTTP method 不合法: {e}"))?;
            let mut builder = self
                .client
                .request(method_parsed, request_url.clone())
                .header("x-amz-date", amz_date)
                .header("x-amz-content-sha256", payload_hash)
                .header("Authorization", authorization)
                .header("Host", target.host.clone());
            if let Some(app_id) = self.cfg.app_id.as_ref() {
                let appid = app_id.trim();
                if !appid.is_empty() {
                    builder = builder.header("Appid", appid).header("x-cos-appid", appid);
                }
            }
            if let Some(token) = self.cfg.session_token.as_ref() {
                if !token.trim().is_empty() {
                    builder = builder.header("x-amz-security-token", token.trim());
                }
            }
            if let Some(ct) = content_type {
                builder = builder.header("Content-Type", ct);
            }
            if !body.is_empty() {
                builder = builder.body(body.to_vec());
            }

            let response = match builder.send() {
                Ok(resp) => resp,
                Err(e) => {
                    if should_retry_request_error(&e) && attempt + 1 < S3_REQUEST_MAX_ATTEMPTS {
                        let backoff_ms = S3_REQUEST_RETRY_BASE_MS * u64::from(attempt + 1);
                        std::thread::sleep(StdDuration::from_millis(backoff_ms));
                        continue;
                    }
                    return Err(format!("请求对象存储失败: {e}"));
                }
            };
            let status = response.status().as_u16();
            let body = response
                .bytes()
                .map_err(|e| format!("读取对象存储响应失败: {e}"))?
                .to_vec();
            return Ok(S3Response { status, body });
        }

        Err("请求对象存储失败：超过重试次数".to_string())
    }

    pub(super) fn put_bucket_if_missing(&self) -> Result<(), String> {
        let probe = self.signed_request(
            "GET",
            None,
            &[
                ("list-type".to_string(), "2".to_string()),
                ("max-keys".to_string(), "1".to_string()),
            ],
            &[],
            None,
        )?;
        if (200..300).contains(&probe.status) {
            return Ok(());
        }

        if probe.status == 404 {
            let create = self.signed_request("PUT", None, &[], &[], None)?;
            if (200..300).contains(&create.status) || create.status == 409 {
                return self.wait_bucket_ready_after_create();
            }
            return Err(format!(
                "创建 bucket 失败 (status={}): {}",
                create.status,
                summarize_body(&create.body)
            ));
        }

        Err(format!(
            "访问 bucket 失败 (status={}): {}",
            probe.status,
            summarize_body(&probe.body)
        ))
    }

    pub(super) fn wait_bucket_ready_after_create(&self) -> Result<(), String> {
        let mut last_err: Option<String> = None;
        for _ in 0..6 {
            match self.ensure_bucket_accessible() {
                Ok(()) => return Ok(()),
                Err(err) => {
                    last_err = Some(err);
                    std::thread::sleep(StdDuration::from_millis(600));
                }
            }
        }
        Err(match last_err {
            Some(err) => format!("bucket 创建后尚未就绪: {err}"),
            None => "bucket 创建后尚未就绪".to_string(),
        })
    }

    pub(super) fn ensure_bucket_accessible(&self) -> Result<(), String> {
        let probe = self.signed_request(
            "GET",
            None,
            &[
                ("list-type".to_string(), "2".to_string()),
                ("max-keys".to_string(), "1".to_string()),
            ],
            &[],
            None,
        )?;
        if (200..300).contains(&probe.status) {
            return Ok(());
        }
        Err(format!(
            "访问 bucket 失败 (status={}): {}",
            probe.status,
            summarize_body(&probe.body)
        ))
    }

    pub(super) fn put_object(
        &self,
        key: &str,
        body: &[u8],
        content_type: Option<&str>,
    ) -> Result<(), String> {
        let resp = self.signed_request("PUT", Some(key), &[], body, content_type)?;
        if (200..300).contains(&resp.status) {
            return Ok(());
        }
        Err(format!(
            "上传对象失败 (key={}, status={}): {}",
            key,
            resp.status,
            summarize_body(&resp.body)
        ))
    }

    pub(super) fn get_object_optional(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        let resp = self.signed_request("GET", Some(key), &[], &[], None)?;
        if (200..300).contains(&resp.status) {
            return Ok(Some(resp.body));
        }
        if resp.status == 404 {
            return Ok(None);
        }
        Err(format!(
            "读取对象失败 (key={}, status={}): {}",
            key,
            resp.status,
            summarize_body(&resp.body)
        ))
    }

    pub(super) fn list_objects(&self, prefix: &str) -> Result<Vec<RemoteSnapshotObject>, String> {
        let mut out = Vec::<RemoteSnapshotObject>::new();
        let mut continuation_token: Option<String> = None;

        loop {
            let mut query = vec![
                ("list-type".to_string(), "2".to_string()),
                ("prefix".to_string(), prefix.to_string()),
                ("max-keys".to_string(), "1000".to_string()),
            ];
            if let Some(token) = continuation_token.as_ref() {
                query.push(("continuation-token".to_string(), token.clone()));
            }

            let resp = self.signed_request("GET", None, &query, &[], None)?;
            if !(200..300).contains(&resp.status) {
                return Err(format!(
                    "列出远端对象失败 (prefix={}, status={}): {}",
                    prefix,
                    resp.status,
                    summarize_body(&resp.body)
                ));
            }

            let body = String::from_utf8_lossy(&resp.body);
            out.extend(parse_list_objects_snapshot_entries(&body));
            if !xml_first_tag_text(&body, "IsTruncated")
                .map(|v| v.eq_ignore_ascii_case("true"))
                .unwrap_or(false)
            {
                break;
            }
            continuation_token = xml_first_tag_text(&body, "NextContinuationToken");
            if continuation_token.is_none() {
                break;
            }
        }

        Ok(out)
    }

    pub(super) fn delete_object(&self, key: &str) -> Result<(), String> {
        let resp = self.signed_request("DELETE", Some(key), &[], &[], None)?;
        if (200..300).contains(&resp.status) || resp.status == 404 {
            return Ok(());
        }
        Err(format!(
            "删除远端对象失败 (key={}, status={}): {}",
            key,
            resp.status,
            summarize_body(&resp.body)
        ))
    }
}

pub(super) fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub(super) fn summarize_body(body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body).trim().to_string();
    if text.len() > 280 {
        format!("{}...", &text[..280])
    } else {
        text
    }
}

pub(super) fn xml_unescape_text(input: &str) -> String {
    input
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

pub(super) fn xml_first_tag_text(input: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = input.find(&open)? + open.len();
    let end = input[start..].find(&close)? + start;
    Some(xml_unescape_text(input[start..end].trim()))
}

pub(super) fn parse_list_objects_snapshot_entries(input: &str) -> Vec<RemoteSnapshotObject> {
    let mut out = Vec::<RemoteSnapshotObject>::new();
    let mut rest = input;
    while let Some(start) = rest.find("<Contents>") {
        let after_start = &rest[start + "<Contents>".len()..];
        let Some(end) = after_start.find("</Contents>") else {
            break;
        };
        let block = &after_start[..end];
        if let (Some(key), Some(last_modified)) = (
            xml_first_tag_text(block, "Key"),
            xml_first_tag_text(block, "LastModified"),
        ) {
            if key.ends_with(".kwsnap") {
                out.push(RemoteSnapshotObject { key, last_modified });
            }
        }
        rest = &after_start[end + "</Contents>".len()..];
    }
    out
}

pub(super) fn is_no_such_bucket_error_text(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("nosuchbucket")
        || lower.contains("the specified bucket does not exist")
        || lower.contains("bucket does not exist")
}

pub(super) fn should_retry_request_error(err: &reqwest::Error) -> bool {
    if err.is_timeout() || err.is_connect() {
        return true;
    }
    let lower = err.to_string().to_ascii_lowercase();
    lower.contains("error sending request")
        || lower.contains("connection reset")
        || lower.contains("broken pipe")
        || lower.contains("failed to lookup address")
        || lower.contains("dns")
        || lower.contains("timed out")
}

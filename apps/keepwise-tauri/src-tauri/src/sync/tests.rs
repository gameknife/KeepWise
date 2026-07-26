use super::{
    build_snapshot_bytes, decrypt_share_payload, derive_workspace_sync_key, encode_rfc3986,
    encrypt_share_payload, now_iso, parse_list_objects_snapshot_entries,
    parse_snapshot_bytes_for_ref, xml_first_tag_text, LocalSyncMaterial, RuleFileBinary,
    ShareCodePayload, SYNC_PROVIDER,
};

#[test]
fn share_code_roundtrip_ok() {
    let payload = ShareCodePayload {
        provider: SYNC_PROVIDER.to_string(),
        endpoint: "https://cos.ap-shanghai.myqcloud.com".to_string(),
        region: "ap-shanghai".to_string(),
        bucket: "keepwise-sync-ap-shanghai-1234567890".to_string(),
        prefix: "keepwise-sync".to_string(),
        workspace_id: "ws-1".to_string(),
        access_key_id: "AKIDEXAMPLE".to_string(),
        secret_key: "SECRETEXAMPLE".to_string(),
        app_id: Some("1234567890".to_string()),
        session_token: None,
        path_style: true,
        issued_at: now_iso(),
    };
    let code = encrypt_share_payload("pass-123", &payload).expect("encrypt");
    let decoded = decrypt_share_payload("pass-123", &code).expect("decrypt");
    assert_eq!(decoded.endpoint, payload.endpoint);
    assert_eq!(decoded.bucket, payload.bucket);
    assert_eq!(decoded.secret_key, payload.secret_key);
}

#[test]
fn share_code_wrong_password_should_fail() {
    let payload = ShareCodePayload {
        provider: SYNC_PROVIDER.to_string(),
        endpoint: "https://cos.ap-shanghai.myqcloud.com".to_string(),
        region: "ap-shanghai".to_string(),
        bucket: "keepwise-sync-ap-shanghai-1234567890".to_string(),
        prefix: "keepwise-sync".to_string(),
        workspace_id: "ws-1".to_string(),
        access_key_id: "AKIDEXAMPLE".to_string(),
        secret_key: "SECRETEXAMPLE".to_string(),
        app_id: Some("1234567890".to_string()),
        session_token: None,
        path_style: true,
        issued_at: now_iso(),
    };
    let code = encrypt_share_payload("pass-123", &payload).expect("encrypt");
    let err = decrypt_share_payload("pass-456", &code).expect_err("must fail");
    assert!(err.contains("同步密码错误") || err.contains("损坏"));
}

#[test]
fn snapshot_roundtrip_ok() {
    let key = derive_workspace_sync_key("sync-pass", "ws-1").expect("derive");
    let material = LocalSyncMaterial {
        db_bytes: b"db-bytes".to_vec(),
        rules: vec![RuleFileBinary {
            name: "merchant_map.csv".to_string(),
            bytes: b"a,b,c".to_vec(),
        }],
    };
    let snap = build_snapshot_bytes(&material, &key, "snap-test", None, "device-a")
        .expect("build snapshot");
    let decoded = parse_snapshot_bytes_for_ref(
        &snap.bytes,
        &key,
        Some("snap-test"),
        None,
        Some(&snap.plain_hash),
    )
    .expect("parse snapshot");
    assert_eq!(decoded.db_bytes, material.db_bytes);
    assert_eq!(decoded.rules.len(), 1);
    assert_eq!(decoded.rules[0].name, "merchant_map.csv");
}

#[test]
fn encode_rfc3986_should_escape_slash_in_query() {
    assert_eq!(encode_rfc3986("a/b"), "a%2Fb");
}

#[test]
fn parse_list_objects_snapshot_entries_reads_kwsnap_keys() {
    let xml = r#"
            <ListBucketResult>
              <IsTruncated>false</IsTruncated>
              <Contents>
                <Key>keepwise-sync/ws/snapshots/snap-a.kwsnap</Key>
                <LastModified>2026-05-25T10:00:00.000Z</LastModified>
              </Contents>
              <Contents>
                <Key>keepwise-sync/ws/refs/head.json</Key>
                <LastModified>2026-05-25T10:01:00.000Z</LastModified>
              </Contents>
              <Contents>
                <Key>keepwise-sync/ws/snapshots/snap-b.kwsnap</Key>
                <LastModified>2026-05-25T10:02:00.000Z</LastModified>
              </Contents>
            </ListBucketResult>
        "#;
    let entries = parse_list_objects_snapshot_entries(xml);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].key, "keepwise-sync/ws/snapshots/snap-a.kwsnap");
    assert_eq!(entries[1].last_modified, "2026-05-25T10:02:00.000Z");
    assert_eq!(
        xml_first_tag_text(xml, "IsTruncated").as_deref(),
        Some("false")
    );
}

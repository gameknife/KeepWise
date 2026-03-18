# KeepWise 多端同步计划（精简实现版，COS/S3）

## 1. 目标

- 只做 `Tencent COS（S3 兼容）`。
- 全流程仅在 App 客户端完成。
- 能自动同步（启动自动 + 周期自动）。
- 所有上云数据为密文，KeepWise 不托管用户数据。

## 2. V1 范围

- 同步对象：`ledger/keepwise.db` + `rules/*.csv`。
- 同步能力：创建同步库、链接已有同步库、自动同步、冲突处理、状态查看。
- 链接方式：支持“同步链接码 + 二维码扫码链接”。
- 不做：Folder/WebDAV、行级自动 merge、多人协作权限。

## 3. 低输入参数策略（重点）

创建同步库时，用户默认只填：

- `SecretId`
- `SecretKey`
- `Region`
- `AppID`
- `同步密码`（passphrase）

App 自动完成：

- 推导 `endpoint`
- 创建或复用 bucket（命名规则如 `keepwise-sync-<uin>-<region>`）
- 创建 `prefix/workspace_id`
- 初始化 `manifest.json` 与 `refs/head.json`

链接已有同步库时，用户默认只填：

- `同步密码`
- 通过“扫码二维码”或“粘贴同步链接码”导入连接信息

说明：

- 提供“高级模式”手工填写 endpoint/bucket/prefix（仅故障排查使用）。
- 同步链接码包含完整连接参数（endpoint/region/bucket/prefix/workspace_id/access_key_id/secret_key/path_style 等），并使用“同步密码派生密钥”加密封装。
- App 在创建成功后同时展示：`同步链接码文本` + `二维码`（二维码内容即同步链接码）。
- 用户更换设备时不再手填 COS 参数，只需扫码（或粘贴链接码）+ 输入同步密码。

## 4. 同步与自动化策略（重点）

- 启动自动同步：App 启动后 `5s` 触发一次 `reconcile`（pull-first）。
- 周期自动同步：默认每 `5 分钟` 自动同步一次（可配置开关与间隔）。
- 本地变更自动同步：本地数据变更后 debounce `15s` 触发一次同步。
- 网络恢复自动同步：离线转在线时立即触发一次。
- 并发控制：同一时刻仅允许一个同步任务在跑。

失败策略：

- 单次失败仅记录，不破坏本地数据。
- 连续失败显示告警，但不阻塞用户正常使用。

## 5. 远端布局与一致性

```text
s3://<bucket>/<prefix>/keepwise-sync/<workspace_id>/
  manifest.json
  refs/head.json
  snapshots/<snapshot_id>.kwsnap
  locks/<device_id>.lock
```

- push 前校验 `remote_head == known_head`。
- 不一致即冲突，不静默覆盖。
- 冲突策略：远端优先 / 本地优先 / 保留双份后拉取。

## 6. 安全要求（固定）

- KDF：`Argon2id`
- 加密：`XChaCha20-Poly1305`（或 AES-256-GCM）
- 完整性：`BLAKE3/SHA-256`
- 密钥默认仅内存驻留（可选系统安全存储）
- 同步链接码不明文暴露 COS 连接参数，必须输入同步密码后才能解封装。

## 7. 接口最小集（IPC）

- `sync_setup_create`（创建并绑定同步库）
- `sync_share_code_generate`（生成同步链接码）
- `sync_share_code_parse`（解析/校验同步链接码）
- `sync_setup_link`（通过同步链接码链接已有同步库）
- `sync_test_connection`
- `sync_status`
- `sync_reconcile`（统一 push/pull）
- `sync_resolve_conflict`
- `sync_set_auto_policy`

`sync_status` 必含：

- `workspace_id`
- `device_id`
- `local_head`
- `remote_head`
- `syncing`
- `last_sync_at`
- `last_error`
- `conflict`
- `auto_sync_enabled`
- `next_sync_at`

## 8. 执行阶段（简化）

### Phase A（7-10 天）

- S3/COS 驱动 + SigV4 + 错误映射。
- 实现“低输入参数”建库能力（自动创建资源）。
- 实现同步链接码生成/解析（含二维码展示数据源）。

验收：创建端仅填最少参数；创建后可得到可扫码的同步二维码。

### Phase B（7-10 天）

- 端到端快照同步闭环（打包、加密、上传、下载、恢复）。
- 冲突检测与三策略处理。

验收：两台设备自动/手动同步均可用；错误密码与篡改快照被拒绝。

### Phase C（5-7 天）

- 自动同步调度（启动、周期、变更后、网络恢复）。
- App 状态卡片与错误提示完善。
- App 链接流程支持“扫码二维码/粘贴链接码”，仅要求输入同步密码。

验收：无终端操作，用户仅靠 App 完成全部流程并可持续看到状态。

### Phase D（3-5 天）

- 跨平台回归、故障文档、发布加固。

验收：`npm run desktop:release:check` 通过。

## 9. 最终用户流程（App 内）

### 9.1 首台设备：创建同步库

1. 在腾讯云开通 COS，并获取 `SecretId/SecretKey`。  
2. App 打开：`设置 -> 云同步（COS） -> 创建同步库`。  
3. 输入：`SecretId`、`SecretKey`、`Region`、`AppID`、`同步密码`。  
4. 点击 `创建并绑定`（App 自动创建/复用 bucket + workspace）。  
5. 创建成功后，App 显示 `同步链接码` 与 `二维码`（用于其他设备链接）。

### 9.2 第二台及更多设备：链接已有同步库

1. App 打开：`设置 -> 云同步（COS） -> 链接已有同步库`。  
2. 扫描首台设备展示的二维码（或粘贴同步链接码）。  
3. 输入：`同步密码`。  
4. 点击 `链接并同步`，App 自动读取远端状态并拉取。

### 9.3 日常使用（自动）

- App 启动自动同步一次。
- 运行中按间隔自动同步。
- 本地有改动后自动同步。
- 用户可在状态卡片看到：是否同步中、最近同步时间、是否冲突、最近错误。

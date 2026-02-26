# Tauri Diff Adapter CLI Protocol (Concise)

用于差分 runner 调用 Rust（或其他语言）实现。

## 调用方式

- runner 通过 `stdin` 发送 JSON
- adapter 通过 `stdout` 返回 JSON
- 非 0 退出码表示执行失败（runner 记录错误）

## 输入 JSON（核心字段）

- `case.id`：用例 ID
- `endpoint.path`：目标接口路径（如 `/api/analytics/investment-return`）
- `query`：查询参数
- `dataset.db_path`：测试数据库路径
- `runtime`：运行时元信息（可选）

## 输出 JSON

### 成功

```json
{"status":"success","payload":{}}
```

### 失败

```json
{"status":"error","error":{"category":"INVALID_RANGE_ERROR","message":"...","type":"..."}}
```

## 当前实现

- Rust adapter：`kw_migration_adapter`（支持核心 4 接口）
- Python mock / Python adapter：用于协议验证与迁移初期对照

## 设计原则

- 协议层只做路由与序列化，不承载业务口径
- 错误比较优先 `category`，错误文案只做辅助比对

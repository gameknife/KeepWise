# KeepWise 差分测试 Rust Adapter CLI 协议（v1）

更新时间：2026-02-23
状态：可用（已由 Python 参考实现验证）
适用组件：`tools/migration/run_diff_regression.py`

## 1. 目的

定义 `run_diff_regression.py --rust-adapter-cmd` 调用的外部适配器协议，用于让 Rust（或其他语言）实现按统一方式接入差分测试。

适配器职责：

- 接收单个 case 的执行请求（stdin JSON）
- 调用目标实现（未来为 Rust 分析实现）
- 输出标准化结果（stdout JSON）

## 2. 调用方式

Runner 会为每个 case 启动一次外部进程，并通过 `stdin` 发送 JSON 请求。

命令示例（当前可用）：

```bash
python3 tools/migration/run_diff_regression.py \
  --rust-adapter-cmd "python3 tools/migration/python_adapter_cli.py"
```

## 3. 输入协议（stdin JSON）

### 3.1 顶层结构

```json
{
  "schema_version": 1,
  "case": {
    "id": "inv_return_single_custom",
    "tags": ["p1-a", "success", "investment-return", "single", "custom-range"],
    "expected_outcome": "success"
  },
  "endpoint": {
    "profile": "investment_return_v1",
    "method": "GET",
    "path": "/api/analytics/investment-return",
    "contract": "tests/contracts/analytics/investment-return.contract.md"
  },
  "query": {
    "account_id": "acct_inv_regression",
    "preset": "custom",
    "from": "2026-01-01",
    "to": "2026-01-31"
  },
  "dataset": {
    "ref": "m1_analytics_minimal",
    "db_path": "/tmp/kw_diff_xxx/keepwise_diff.db",
    "fixtures": {
      "inv_account_id": "acct_inv_regression"
    }
  },
  "runtime": {
    "root_dir": "/Users/gameknife/github/BeyondYZYX"
  }
}
```

### 3.2 字段说明（关键）

- `schema_version`
  - 当前固定为 `1`
- `case`
  - 用例元数据，便于 adapter 做日志与调试
- `endpoint`
  - 要调用的接口信息（路径是主路由键）
- `query`
  - 解析后的 query 参数键值（标量为主）
- `dataset.db_path`
  - 差分 runner 已经准备好的临时 SQLite 数据库路径
- `dataset.fixtures`
  - 该数据集的 fixture 值（可选用）

## 4. 输出协议（stdout JSON）

适配器必须输出 JSON 对象，且必须包含 `status` 字段。

### 4.1 成功响应

```json
{
  "status": "success",
  "payload": {
    "...": "接口返回 JSON"
  }
}
```

说明：

- `payload` 应为目标接口的 JSON 响应对象（与契约一致）
- runner 会根据 `endpoint_profiles.compare` 执行字段级差分

### 4.2 错误响应

```json
{
  "status": "error",
  "error": {
    "category": "VALIDATION_ERROR",
    "message": "account_id 必填",
    "type": "ValueError"
  }
}
```

字段要求：

- `error.category`：建议提供（如 `VALIDATION_ERROR` / `NO_DATA_ERROR` / `INVALID_RANGE_ERROR`）
- `error.message`：建议提供
- `error.type`：可选但建议提供（便于调试）

说明：

- Phase 1 中 runner 对错误对比优先比 `category`，文案差异可降级 warning

### 4.3 协议错误（不建议）

如果 adapter 自身发生异常，建议仍输出 `status="error"` 且给出可识别 `category`，而不是直接非 0 退出。

但当前 runner 也能处理：

- 进程非 0 退出
- stdout 非 JSON
- 缺少 `status`

这些会被归类为 `ADAPTER_EXEC_ERROR` / `ADAPTER_PROTOCOL_ERROR`。

## 5. 参考实现

已提供两个参考实现：

- Python 参考 adapter（真实函数调用，协议等价于未来 Rust adapter）
  - `tools/migration/python_adapter_cli.py`
- Mock adapter（回放 `<case_id>.json`，用于协议验证）
  - `tools/migration/mock_rust_adapter.py`

## 6. 本地验证示例

### 6.1 使用 Python 参考 adapter（推荐）

```bash
python3 tools/migration/run_diff_regression.py \
  --rust-adapter-cmd "python3 tools/migration/python_adapter_cli.py"
```

### 6.2 使用 Mock adapter 回放

先导出 baseline：

```bash
python3 tools/migration/run_diff_regression.py \
  --emit-python-case-json-dir /tmp/kw_py
```

再回放：

```bash
python3 tools/migration/run_diff_regression.py \
  --rust-adapter-cmd "python3 tools/migration/mock_rust_adapter.py --replay-json-dir /tmp/kw_py"
```

## 7. Rust 实现建议（下阶段）

Rust adapter CLI（未来建议）最小职责：

1. 从 stdin 读取 JSON 请求
2. 解析 `endpoint.path` 与 `query`
3. 使用 `dataset.db_path` 初始化 Rust 侧 DB 访问
4. 调用对应 Rust 分析函数
5. 输出 `status=success/error` JSON

建议优先支持顺序：

1. `/api/analytics/investment-return`
2. `/api/analytics/investment-curve`
3. `/api/analytics/wealth-overview`
4. `/api/analytics/wealth-curve`

---

注：本协议文件是 Phase 1 差分工具链的“执行协议”，后续若字段扩展请升级 `schema_version` 或确保向后兼容。

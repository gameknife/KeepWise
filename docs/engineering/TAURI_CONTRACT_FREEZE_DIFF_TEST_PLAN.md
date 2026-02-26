# Contract Freeze & Diff Test Plan (Current Baseline)

## 目标

使用差分回归锁定核心分析口径，确保 Python -> Rust 迁移不改变关键计算结果。

## 当前基线（已完成）

已冻结并验证的核心接口（4个）：

1. `investment-return`
2. `investment-curve`
3. `wealth-overview`
4. `wealth-curve`

当前结果：
- `25/25` case `PASS`
- `2/2` cross-case checks `PASS`

## 关键文件

- 差分 runner：`/Users/gameknife/github/BeyondYZYX/tools/migration/run_diff_regression.py`
- 用例清单：`/Users/gameknife/github/BeyondYZYX/tools/migration/cases/analytics_core.yaml`
- Rust adapter：`/Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri/src-tauri/src/bin/kw_migration_adapter.rs`
- 契约模板：`/Users/gameknife/github/BeyondYZYX/tests/contracts/analytics`

## 当前运行方式

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run test:diff:core
```

或直接：

```bash
python3 /Users/gameknife/github/BeyondYZYX/tools/migration/run_diff_regression.py \
  --rust-adapter-cmd "/Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri/src-tauri/target/debug/kw_migration_adapter"
```

## 下一步（建议）

- 将更多分析能力纳入差分或 Rust fixture 回归（如 `investment-returns`）
- 保持核心 4 接口为发布前必跑项

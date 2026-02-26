# BeyondYZYX / KeepWise

KeepWise 已进入 **Tauri Desktop（React + Rust）产品化阶段**。当前桌面端主功能已基本完成迁移（约 90%+），核心导入、分析、规则管理、查询维护均可在桌面端运行，且核心分析接口已完成 Python vs Rust 差分回归。

## 当前状态（简版）

- `desktop` 主链路：可用（Tauri + Rust + SQLite）
- 核心分析（4 个接口）：Rust 已迁移，差分通过（`25/25 case + 2/2 cross-check`）
- 导入链路：Rust 已支持
  - 有知有行 `CSV/XLSX`
  - 招行信用卡 `EML`
  - 招行银行流水 `PDF`
- 规则管理：Rust 已支持（商户映射、分类规则、白名单、分析排除、商户建议）
- UI：桌面端产品化进行中（左侧 TAB、隐私开关、设置、图表重构）
- 发布：本地/CI 检查链路已建立；签名/公证模板已就绪（未正式启用）

## 仓库结构（常用）

- 桌面应用：`/Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri`
- 迁移与工程文档：`/Users/gameknife/github/BeyondYZYX/docs/engineering`
- 产品基础文档：`/Users/gameknife/github/BeyondYZYX/docs/foundation`
- 差分工具与用例：`/Users/gameknife/github/BeyondYZYX/tools/migration`
- 测试契约（人工参考）：`/Users/gameknife/github/BeyondYZYX/tests/contracts/analytics`
- 旧版脚本/Web 工作台：`/Users/gameknife/github/BeyondYZYX/apps/keepwise-legacy`

## 快速开始（桌面端，推荐）

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm install
npm run tauri dev
```

首次使用建议：

1. 打开 `导入中心`
2. 导入已有 `keepwise.db`（或使用三类导入器）
3. 在 `财富总览 / 投资收益 / FIRE进度 / 消费分析` 做功能验证

## 校验与回归（常用命令）

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run desktop:release:check
npm run test:rust:regression
npm run test:diff:core
```

## 文档入口（精简）

- 迁移总览：`/Users/gameknife/github/BeyondYZYX/docs/engineering/TAURI_STACK_MIGRATION_MASTER_PLAN.md`
- 技术选型（已定版）：`/Users/gameknife/github/BeyondYZYX/docs/engineering/TAURI_TECH_SELECTION_DECISION_MATRIX.md`
- 构建与发布运行手册：`/Users/gameknife/github/BeyondYZYX/docs/engineering/TAURI_DESKTOP_BUILD_RUNBOOK.md`
- 用户回归清单：`/Users/gameknife/github/BeyondYZYX/docs/engineering/TAURI_DESKTOP_USER_REGRESSION_CHECKLIST.md`

## 仍未完成（短期重点）

- 桌面端 UI 最后收口（文案、交互、信息层级）
- 更大范围自动化回归覆盖（导入/预算/FIRE/收入/消费）
- 正式发布签名与公证（macOS），以及 Windows/Linux 打包流程收口
- 移动端（Android/iOS）后续阶段再推进

# KeepWise 代码库重构执行报告

> 执行日期：2026-07-16
> 起点 commit：`4a16bf1`
> 环境：Node `v25.8.1`、Rust `1.93.1`

## 结果摘要

六个 Wave 的主要结构工作已落地，并保持 78 个 Tauri command、数据库 migration、导入稳定 ID、同步格式、设置 key 和中文错误边界兼容。

| 指标 | 计划起点 | 当前 |
|---|---:|---:|
| 核心 diff | 22/25，cross-check skipped | 25/25 + 2/2 |
| Rust tests | 43 discovered | 52 discovered（51 pass，1 ignored） |
| frontend tests | 0 | 13 pass |
| `LoosePayload` references | 46 aliases / 多处消费 | 0 |
| feature `Record<string, any>` | 约 106 次 any、13 个宽边界文件 | 0 |
| desktop API | 992 行单文件 | 14 个 domain client + 单一 invoke entry |
| CSS | 4567 行单文件 | 9 个有序样式层 |
| entry JS | 714.71 kB | 400.96 kB（gzip 114.91 kB） |
| large Rust domains | 7 个 1000–2800 行混合文件 | 7 个职责模块目录 |
| `src/app/App.tsx` | 3569 行 / 192 个 `useState` | 516 行 / 2 个直接 `useState` |

## 已完成内容

- 明确 `transfer_details` 为兼容新增字段并恢复 25 cases + 2 cross-check 全绿。
- Vitest、边界脚本、CI/release gate 集成；补 request、隐私格式、设置解析、Markdown、async hook 和 controller 测试。
- IPC 按 accounts/investment/wealth/budget/import/rules/sync/export/system 等域拆分；删除 `src/lib/desktopApi.ts`。
- 导入、同步、预算/FIRE/收入、消费、投资、财富、账户目录、记录、手工录入和 admin/runtime/validation 状态进入域 controller；benchmark hydration 保留 request sequence。
- 壳层视口、移动返回栈、设置持久化与导航动画进入 `useAppShellController`；侧栏指标和自动刷新分别由 `useSidebarMetrics`、`useAppAutoRefresh` 编排。
- 删除所有公开 feature 的宽松 any prop 边界，页面直接导入共享 UI。
- Rust budget、investment、wealth、analysis export、sync 和三个 importer 按职责拆分。
- 新增 read queries、record mutations、rules、ledger migration characterization tests 和低风险 `AppError/AppResult` pilot。
- CSS 按原 cascade 顺序机械拆分；admin/import/export lazy-load，入口 chunk 低于 500 kB。
- desktop 与 forced-mobile 浏览器 smoke：移动首页、页面进入/返回、390px 无横向溢出通过。

## 兼容性验证

- command inventory：78，脚本与 IPC 文档一致。
- migration：`0001`–`0007`，embedded migration 重复执行幂等。
- import：YZXY、CMB EML/PDF fixture 的幂等、稳定 ID 和重叠账单测试通过。
- sync：share code、错误密码、snapshot roundtrip、签名/对象解析 fixture 通过。
- analytics：25 个冻结 case 与 2 个 cross-check 通过。
- settings/localStorage：现有 parser/default 测试通过，storage key 未改变。

## 明确偏差与保留项

`src/app/App.tsx` 为 516 行、2 个直接 `useState`，达到计划“约 500 行/15 个”的目标区间。剩余职责仅包括 controller 安装、精确的跨域刷新/失效协调、tab 装配和 lazy 页面挂载；不再包含业务表单、CRUD、请求构造器或图表指标派生。`AdminSections` 的平铺宽参数已改为领域 controller 边界，`WorkspaceContentPanels` 只保留轻量 tab switch 与页面装配。

计划内没有遗留的结构阻塞项。仍保留的动态 `unknown` 只位于松散外部数据的单点收窄边缘；Rust 外部 command 继续返回兼容的 `serde_json::Value`，内部 `AppError/AppResult` 按低风险 pilot 使用，没有为了形式统一改写全部错误文本或 DTO。这些是明确的兼容性取舍，不是未完成执行卡。

Web-only Vite 预览缺少 Tauri `invoke/listen` 宿主桥接，因此数据态视觉回归仍以原生 Tauri 人工验证为准；forced-mobile 的无数据 shell 已自动巡检。

最终自动门禁：boundary `78 commands / 0 LoosePayload / 0 wide feature props`，frontend `13/13`，core diff `25/25 + 2/2`，Rust `51 pass / 1 ignored`，`desktop:release:check` 全绿。

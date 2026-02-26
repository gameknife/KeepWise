# BeyondYZYX - Session Notes / Agent Quickstart

本文件用于帮助后续会话快速接手，内容只保留当前有效状态（精简版）。

## 当前结论（2026-02）

项目主线已从早期 Python/Web 工作台迁移到 **Tauri Desktop（React + Rust）**。

当前桌面端已经具备：

- 本地 SQLite 账本迁移与管理
- 三类导入（YZXY CSV/XLSX、招行 EML、招行银行流水 PDF）
- 核心分析（投资收益、投资曲线、财富总览、财富曲线）
- 规则管理（商户映射、分类规则、白名单、分析排除、商户建议）
- 高级管理（数据库健康、查询维护、管理员操作）
- 产品化 UI（TAB 工作台、设置、隐私模式、图表）

## 当前主线目标（桌面端）

1. 产品化 UI 收尾（降低调试感）
2. 自动化回归覆盖扩展
3. 桌面发布流程收口（签名/公证）
4. 移动端后续再做

## 常用路径（接手必看）

- 桌面应用：`/Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri`
- Rust 端：`/Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri/src-tauri`
- 工程文档：`/Users/gameknife/github/BeyondYZYX/docs/engineering`
- 差分工具：`/Users/gameknife/github/BeyondYZYX/tools/migration`
- 导入/旧脚本：`/Users/gameknife/github/BeyondYZYX/scripts`

## 常用命令

```bash
# 启动桌面应用
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run tauri dev

# 桌面端综合检查（推荐）
npm run desktop:release:check

# 核心 4 分析接口差分
npm run test:diff:core

# Rust 回归子集
npm run test:rust:regression
```

## 关键工程事实（避免重复踩坑）

- 核心 4 分析接口已完成 Python vs Rust 差分（当前基线通过）。
- `CMB EML` 导入已修复：
  - HTML 行解析重复计数问题
  - 二次导入重复交易（ID 不稳定）问题
- `CMB PDF` 导入已修复中文短商户误判“个人转账”问题。
- 规则运行时目录已切到 app 本地规则目录（首次从仓库 `data/rules` seed）。

## 当前 UI 约定（桌面端）

- 左侧 TAB 为产品入口；`更新收益` 为快捷弹窗入口（不切页）
- 调试类能力默认收敛在 `高级管理`，部分需开发者模式显示
- 设置项已支持 `localStorage` 持久化（隐私模式、着色方案、动画开关）

## 文档入口

- `/Users/gameknife/github/BeyondYZYX/README.md`
- `/Users/gameknife/github/BeyondYZYX/docs/engineering/TAURI_STACK_MIGRATION_MASTER_PLAN.md`
- `/Users/gameknife/github/BeyondYZYX/docs/engineering/TAURI_DESKTOP_BUILD_RUNBOOK.md`

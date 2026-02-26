# Tauri Tech Selection Decision Matrix (Finalized, Concise)

本文件保留当前已拍板技术选型（精简版）。

## 已确认选型

- 桌面壳：`Tauri v2`
- 前端：`React + TypeScript + Vite`
- 后端：`Rust`
- 数据库：`SQLite`（桌面本地）
- Rust SQLite：`rusqlite`
- 图表策略：轻量优先（复杂场景可专用库，如 `d3-sankey`）
- 核心口径验证：`Python vs Rust` 差分回归
- 桌面导入终态：**不依赖 Python**

## 已落地的工程决策

- 核心 4 分析接口已完成 Rust 实现，并纳入差分回归
- YZXY/EML/PDF 导入已做 Rust 原生实现
- 规则运行时目录已迁到 app 本地目录（首次 seed 仓库规则）
- UI 不再使用内嵌 HTML 承载分析页（消费总览已重构）

## 保留的过渡/模板策略

- 签名/公证流程目前以模板脚本 + workflow 骨架形式存在，待证书与凭证接入后启用
- 移动端相关选型暂不进入执行阶段（桌面优先）

## 当前不再争议的点

- `React + Vite` 方案已稳定，不再回退 Web-only 工作台
- Rust 可覆盖导入链路，不需要长期 Python bridge
- 自动化差分是核心收益，不应移除

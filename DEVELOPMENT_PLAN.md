# KeepWise Development Plan (Current)

本计划替代旧版阶段文档的“执行视图”，只保留当前还有效的路线。

## 当前阶段

- 阶段：**Tauri Desktop 收尾与发布前工程化**
- 状态：**核心功能已迁移，产品化与发布流程进行中**

## 已完成（摘要）

- Tauri Desktop 基座（React + Rust + SQLite）
- 核心分析 4 接口 Rust 化 + 差分回归
- 三类导入 Rust 化（YZXY / CMB EML / CMB PDF）
- 规则管理 Rust 化
- 消费总览重构为数据渲染（非内嵌 HTML）
- 预算/FIRE/收入分析基础能力迁移
- 左侧 TAB 产品化工作台 + 设置/隐私系统
- 本地/CI 回归检查链路、RC workflow、发布准备脚本

## 进行中（高优先级）

1. UI 产品化细节收口
- 文案层级、信息密度、交互一致性
- 高级管理与普通用户视图继续分层

2. 自动化回归补齐
- 导入链路 preview/import fixture 测试扩展
- 预算/FIRE/收入/消费总览回归覆盖增强

3. 发布流程收口
- 签名/公证（macOS）正式化
- RC -> 发布执行流程稳定化

## 后续阶段（暂缓）

- Android / iOS 迁移与适配
- 云同步与多端一致性
- 更复杂自动化/智能建议

## 每次提交前建议执行

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run desktop:release:check
```

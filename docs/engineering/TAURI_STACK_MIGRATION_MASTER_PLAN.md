# Tauri Stack Migration Master Plan (Current)

## 一句话结论

Tauri Desktop 迁移已完成约 **90%+**。当前重点不再是“能否迁移”，而是：

1. 产品化 UI 收尾
2. 自动化回归补齐
3. 发布流程（签名/公证）收口

## 当前完成度（按主线）

### 已完成（主干）
- Tauri Desktop 基座（React + Rust + SQLite）
- 核心分析 4 接口 Rust 化并差分通过
- 三类导入 Rust 化（YZXY / CMB EML / CMB PDF）
- 规则管理 Rust 化（含商户建议）
- 消费总览改为数据渲染（非内嵌 HTML）
- 预算/FIRE/收入分析基础能力迁移
- 高级管理与查询维护基础能力迁移
- 桌面 UI 进入产品化阶段（TAB、图表、设置、隐私）

### 进行中（尾部工作）
- UI 细节收口（文案、层级、交互一致性）
- 自动化回归覆盖扩展（导入/预算/FIRE/消费等）
- 桌面发布流程正式化（签名/公证）

### 暂缓
- Android / iOS 迁移与适配
- 移动端打包与平台权限细节

## 已验证的关键技术结论

- Rust 完全可以承担导入链路（不需要 Python 作为终态依赖）
- 核心分析口径可通过差分回归稳定锁定
- Tauri Desktop 的产品化 UI 可以直接替代旧 Web 工作台验证路径

## 当前工作方式（推荐）

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run tauri dev
npm run desktop:release:check
```

## 下一阶段（建议顺序）

1. 完成桌面端 UI 产品化最后一轮收口
2. 补齐导入/分析模块的 Rust 回归测试
3. 启用签名/公证流程（先模板，再真实证书）
4. 再启动 Android（按已确认策略）

# KeepWise Tauri Desktop App

Tauri Desktop 版 KeepWise（React + TypeScript + Rust）。

## 开发运行

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm install
npm run tauri dev
```

## 常用命令

```bash
npm run build
npm run test:rust:regression
npm run test:diff:core
npm run desktop:release:check
npm run desktop:release:prepare -- 0.2.0-rc.1
```

## 当前能力（摘要）

- 导入中心：YZXY / 招行 EML / 招行 PDF
- 投资收益、财富总览、FIRE进度、收入分析、消费分析
- 高级管理：数据库健康、查询维护、规则管理、开发者工具（部分）
- 设置与隐私控制（本地持久化）

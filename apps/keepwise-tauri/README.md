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
npm run tauri:dev:mobile-preview
npm run tauri:ios:init
npm run tauri:ios:dev
npm run tauri:android:init
npm run tauri:android:dev
npm run tauri:android:build:internal
npm run tauri:android:run
npm run test:rust:regression
npm run test:diff:core
npm run desktop:release:check
npm run desktop:release:prepare -- 0.2.0-rc.1
```

`tauri:dev:mobile-preview` 会强制移动模式，并将窗口锁定为 iPhone 17 Pro Max 竖屏预览尺寸（440x956）。

## Android 开发前置

- JDK 17（建议 Android Studio 内置 JBR）
- Android SDK（包含 `platform-tools`、`build-tools`、`platforms`）
- Android NDK（Tauri Android 构建必需）
- `adb` 可用（用于设备发现与安装）
- Rust target：`aarch64-linux-android`

建议环境变量：

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

## Android 标准命令流（内部包）

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm install
npm run tauri:android:init
npm run tauri:android:dev
npm run tauri:android:build:internal
```

`tauri:android:build:internal` 固定使用 `--target aarch64 --apk --aab`，用于内部测试分发包。

## Android 常见问题

- `sdkmanager not found`：通常是 Android cmdline-tools 未安装，或 `ANDROID_HOME/ANDROID_SDK_ROOT` 未指向有效 SDK 目录。
- `no devices/emulators found`：先执行 `adb devices` 确认真机/模拟器在线，再运行 `tauri:android:dev`。
- `target aarch64-linux-android not installed`：执行 `rustup target add aarch64-linux-android`。
- Release 签名：当前默认用于内部测试构建；Google Play 正式签名/上架不在本阶段范围。

## 当前能力（摘要）

- 导入中心：YZXY / 招行 EML / 招行 PDF
- 投资收益、财富总览、FIRE进度、收入分析、消费分析
- 高级管理：数据库健康、查询维护、规则管理、开发者工具（部分）
- 设置与隐私控制（本地持久化）

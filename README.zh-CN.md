# DevTree

[English](README.md) | [简体中文](README.zh-CN.md)

[![CI](https://img.shields.io/github/actions/workflow/status/Naughty-Otters/DevTree/ci.yml?branch=main&label=CI&logo=github)](https://github.com/Naughty-Otters/DevTree/actions/workflows/ci.yml?query=branch%3Amain)
[![Version](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Naughty-Otters/DevTree/main/.github/badges/version.json)](https://github.com/Naughty-Otters/DevTree/releases)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Naughty-Otters/DevTree/main/.github/badges/coverage.json)](https://github.com/Naughty-Otters/DevTree/actions/workflows/ci.yml?query=branch%3Amain)
[![npm](https://img.shields.io/npm/v/devtree-ai.svg)](https://www.npmjs.com/package/devtree-ai)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

**把 vibe coding 的 Demo 质量，拉到可上线的生产质量。给你持续交付加上护栏。**

DevTree 是面向 AI 辅助开发的桌面「看门狗」——架构图谱、DSM 健康度、确定性规则、Linter/LSP，以及 AI 评审镜头（安全、性能、整洁代码）都集中在一处。指向仓库，立即运行（或监听文件 / 定时）分析，在上线前看清 vibe 漏掉了什么。

应用内界面语言可在 **设置 → 通用** 切换 English / 简体中文。

<p align="center">
  <img src="media/video/video_run_app.gif" alt="在 DevTree 中打开项目并运行分析" width="720" />
</p>

**许可证：** [AGPL-3.0](LICENSE) · **为何需要 / 规则目录：** [docs/FOR_VIBE_CODERS.md](docs/FOR_VIBE_CODERS.md) · **贡献：** [CONTRIBUTING.md](CONTRIBUTING.md) · **分发：** [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md)

---

## 为什么需要 DevTree

| Vibe / Demo 现实 | 生产 / CD 需求 | DevTree |
| --- | --- | --- |
| Agent 写得多、写得快 | 需要第二双眼睛盯结构和风险 | 规则面板 + AI 镜头 |
| 「能跑」≠「能上线」 | 健康度、环依赖、耦合、设计规则 | 图谱 · DSM · 模块化评分 |
| 评审散落在聊天与各种工具里 | 每次交付都有同一道门槛 | 架构 · 评审 · 安全 · 性能，**一个应用**搞定 |
| CD 不停往前冲 | 持续护栏 | 立即运行 · 文件监听 · 定时任务 |

<p align="center">
  <img src="media/pic/pic_watch_list.png" alt="分析规则：架构、质量、可维护性、AI 校验" width="640" />
</p>

<p align="center"><em>CD 护栏看板 — 架构、质量、可维护性与 AI 评审（大量可开关镜头）。</em></p>

### 你可以检查什么

**确定性：** 模块化 · 依赖深度 · 循环依赖 · 类型覆盖 · 测试覆盖 · 文件大小 · 命名 · 语言 Linter · 语言诊断 · LDM 设计规则  

**AI 架构评估：** 模式 · 系统设计 · 可扩展性 · 技术栈 · 集成 · 安全 · 性能 · 数据 · 技术债  

**AI 代码评审镜头：** 性能 · 安全 · 质量 · 常见缺陷 · SQL 注入 · XSS · N+1 · 错误处理 · 异步/并发 · 反模式 · 日志  

**AI 整洁代码（基于 git diff）：** 命名 · 函数 · 单一职责 · DRY · 注释 · 错误 · 边界 · 单元测试 · 类/数据 · 坏味道 · 童子军规则  

完整表格 → **[docs/FOR_VIBE_CODERS.md](docs/FOR_VIBE_CODERS.md)**。

---

## 看见代码结构，而不只是聊天记录

包与文件的依赖图谱——帮你判断 Agent 是糊在一起，还是真的守住了分层边界。

<p align="center">
  <img src="media/pic/pic_package_dep.png" alt="DevTree 中的包依赖图谱" width="720" />
</p>

<p align="center">
  <img src="media/pic/OpenCodeModuleAnalysis.png" alt="DevTree 分析 OpenCode：模块图谱、项目树与已完成的分析流水线" width="720" />
</p>

<p align="center"><em>示例：OpenCode 工作区 — 图谱上的包、侧栏模块，以及 Progress 中已完成的分析。</em></p>

需要数字而不是感觉时，用 DSM + 健康度评分：

<p align="center">
  <img src="media/pic/pic_dsk_healthy.png" alt="DSM 视图与模块化健康度仪表盘" width="720" />
</p>

---

## 能落到编辑器里的 AI 评审

对工作区运行 AI 代码评审 / 整洁代码 / 架构评审。发现会出现在文件旁边——未使用参数、热点路径、安全异味——而不是埋在另一段聊天记录里。

<p align="center">
  <img src="media/video/video_ai_review.gif" alt="Progress 面板中流式输出的 AI 评审" width="720" />
</p>

<p align="center">
  <img src="media/pic/pic_review_details.png" alt="文件查看器中高亮的评审发现" width="720" />
</p>

分析过程中跟踪失败与警告：

<p align="center">
  <img src="media/video/video_error_tracking.gif" alt="分析过程中的错误与警告跟踪" width="720" />
</p>

更多截图、Demo→生产说明，以及**完整规则目录**： **[docs/FOR_VIBE_CODERS.md](docs/FOR_VIBE_CODERS.md)**。

---

## 下载安装

### 一键安装（CLI + 桌面端）

```bash
curl -fsSL https://raw.githubusercontent.com/Naughty-Otters/DevTree/main/install/install.sh | bash
```

### npm CLI（会下载桌面应用）

```bash
npm i -g devtree-ai@latest
devtree install          # 拉取与本机 OS/架构匹配的 GitHub Release 构建
devtree open             # 启动已安装的应用
devtree doctor
```

### Homebrew（macOS）

```bash
brew tap Naughty-Otters/tap
brew install --cask devtree
```

### 手动安装

macOS / Windows 安装包：[GitHub Releases](https://github.com/Naughty-Otters/DevTree/releases)。

---

## 从源码构建

**前置条件：** Rust（stable）+ `wasm32-unknown-unknown`、Node.js 20+、[wasm-pack](https://rustwasm.github.io/wasm-pack/)、[Tauri 系统依赖](https://tauri.app/start/prerequisites/)。可选语言服务器（`rust-analyzer`、`typescript-language-server` / `vtsls`、`gopls`、`basedpyright`、`jdtls`）可改善诊断与符号图谱。

```bash
npm install
npm run tauri dev
```

仅前端（浏览器，无原生窗口）：`npm run dev` → 打开 `http://localhost:1420`。

```bash
npm run test:all      # 逐文件门禁 + Rust + TypeScript 覆盖率
npm run tauri build   # 可分发应用
```

`main` 分支上的 CI 会跑带覆盖率的测试、构建 macOS（Apple Silicon）与 Windows 产物，并更新 [`.github/badges/`](.github/badges/) 下的 README 徽章。

### 发布

**手动（Actions UI）：** GitHub → **Actions** → **Release** → **Run workflow** → 输入版本（如 `0.1.0`）→ Run。为 `v{version}` 创建草稿 GitHub Release，**并**把同一套安装包上传为该次运行的 **Actions artifacts**（可在 workflow 摘要页下载）。

**推送 tag：**

```bash
npm run sync:version
git tag v0.1.0
git push origin v0.1.0
```

或在已登录 `gh` 的机器上：

```bash
gh workflow run Release -f version=0.1.0 -f draft=true
```

Release 构建使用与 OpenFDE 相同的 `MAC_*` / `WIN_*` 密钥进行签名/公证（GitHub Environment **`release`**）。设置 `NPM_TOKEN` / `HOMEBREW_TAP_TOKEN` 时，会可选更新 npm / Homebrew tap。详见 [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md)。

### 项目结构

```
DevTree/
├── crates/devtree-core/   # 图谱 + 布局（native + wasm）
├── src-tauri/             # Tauri Rust 后端
├── src/                   # Vite + TypeScript UI
├── media/                 # README 截图与 GIF
└── packages/cli/          # npm 包 devtree-ai
```

### 排障

- **`wasm-pack` 报 `the --artifact-dir flag is unstable`：** 用 `cargo install wasm-pack --force` 升级。
- **移动仓库后出现过期绝对路径：** `rm -rf target && cargo build --workspace`。

### 推荐 IDE 设置

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)。

# threedog.js（中文说明）

> **早期预览版。** 接口和名字还会改，尚未发布到 npm；正式 v0.1.0 之前可能有不兼容的改动。MIT 许可。

用 three.js 0.187 写的低模网页 3D 游戏引擎，分三层：**核心**（渲染、主循环、输入、声音、存档、界面）→ **模块**（地形、天空天气、物理、角色、对话、背包、任务……按需安装）→ **风格包**（所有美术）。
引擎只提供机制，不写死美术。自带一个低模风格包和两个示例：开放世界摄影慢生活（`/`）、没有地形和风格包的俯视角小城（`/city.html`）。English: [README.md](README.md)。

仓库是 npm workspaces：`packages/engine`（引擎包 `threedog`）、`packages/tools`（工具 `@threedog/tools`，命令行 `threedog`）、`games/*`（每个游戏一个文件夹）。

## 跑起来
1. 安装 [Node.js](https://nodejs.org)（LTS 版本）。
2. 在这个文件夹打开终端：`npm install`，然后 `npm run dev`。
3. 浏览器打开终端里显示的地址（通常 http://localhost:5173），小城示例在 `/city.html`。
4. 打开某个游戏：`npm run dev -w games/<游戏>`（或 `npm run dev -- 名字的一部分`）。

按键（开放世界示例）：WASD 移动 · Shift 跑 · 拖动转视角 · E 交互 · I 背包 · J 任务 · P 拍照 · Esc 设置 · F3 性能面板。

## 文档在哪
引擎用法（写给 AI 读）在 `packages/engine/docs/AI.md`，按任务的做法在 `packages/engine/docs/recipes/`，接口索引 `API.md`，性能 `PERF.md`；开发引擎本身的规则在 `CLAUDE.md` 和 `.claude/rules/`。文档以英文为主。

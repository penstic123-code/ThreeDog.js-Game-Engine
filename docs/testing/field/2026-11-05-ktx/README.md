# 2026-11-05 `assets optimize` 不装 ktx：用 npm 的 wasm 编码器压 KTX2

分支 `fix/ktx-wasm`。本机没有 `ktx`（KTX-Software 的 Windows 版是安装器），之前带贴图的模型一跑就报错，这一步从来没真跑过。

## 选了哪个包，为什么

`ktx2-encoder` 0.6.0（npm，最新版，2026-07-19 发布，距今约 3.5 个月）。

- 许可：自己是 MIT；内置的 Basis Universal 编码器（wasm）是 Apache-2.0，包里附了 `THIRD_PARTY_NOTICES.md`，MIT 项目可以带。
- Node 里能跑：入口 `dist/node`，wasm 随包带，不联网；Windows 11 / Node 实测能编出 KTX2（见下）。唯一的依赖是 `ktx-parse`；Node 里解码 PNG 用的 `sharp` 本来就随 `@gltf-transform/cli` 装好。
- 它自带的 gltf-transform 步骤对所有贴图用同一组参数，会把法线图当颜色压，所以没用它，只用它的 `encodeToKTX2`，按槽位一张张编（`packages/tools/assets-ktx.mjs`）：法线 / 遮挡 / 粗糙金属度走 UASTC + 线性，基础色 / 自发光走 ETC1S + sRGB。
- 没试 Basis Universal 原版 wasm 和 KTX-Software wasm：第一个候选已通过全部检查。

装法：`npm i -D ktx2-encoder`（可选 peer，不装也不影响别的命令）。`ktx` 在 PATH 上时仍然优先用它；输出第二行写明哪个编码器跑了（`Texture encoder: ...`）。

## 实测模型

`make-model.mjs` 生成：砖面 UV 球，基础色 2048x2048、法线 2048x2048（由同一张砖高度图算出）、粗糙金属度 1024x1024，都是真 PNG 像素。放进一个临时游戏（`game-main.js` 是它的加载代码，已删），`threedog assets optimize -w games/ktxdemo` 真跑：

| | 原始 | 优化后 |
|---|---|---|
| 文件大小 | 16749.6 KB | 6631.5 KB（40%） |
| 贴图 GPU 内存（页面里按实际数据量算） | 48.0 MB（RGBA8 + mip） | 12.0 MB（KTX2：5.33 + 5.33 + 1.33） |
| 编码耗时 | | 总 134.8 s，其中编码贴图 132.9 s（单线程 wasm，2 张 2048² + 1 张 1024²） |

- 第二次运行：`unchanged brick.glb`，`Nothing to do`（缓存有效，工具键里含编码器版本）。
- 读回检查（原有的）0 个问题：法线图是 UASTC + 线性，基础色是 ETC1S + sRGB；页面里法线 / 粗糙金属度贴图 colorSpace 是线性，基础色是 srgb。
- 报告：`optimize-report.json`。

## 真 WebGPU 页面

`node packages/tools/real-webgpu.mjs --game=games/ktxdemo "--urls=/index.html?m=orig,/index.html?m=opt" --shots=<本目录> --eval=eval.js`：系统 Chrome 156，适配器 nvidia/blackwell（RTX 5060 Laptop），`backend=webgpu`，两页都 PASS，没有控制台错误和 GPU 警告。`eval.js` 读出：原图 3 张贴图都是未压缩，优化后 3 张都是 `isCompressedTexture`；模型加载 371 ms（原）对 263 ms（优化）。

截图 `index_html_m_orig.png`（原图）和 `index_html_m_opt.png`（KTX2）：肉眼看砖色、灰缝、法线凹凸一致，球两边的明暗一致；`diff.mjs` 量模型像素：平均绝对差 2 / 255，平均亮度 78.2 对 77.9，超过 24 的像素 0%。压缩后砖面的颗粒略软，这是 ETC1S 的正常代价。

## 没证明的

- 没和 `ktx` 命令的输出比（本机没有）：质量和耗时只和原图比。
- 编码慢：两张 2048² 约两分钟多。只改了一张贴图的模型整个重做；还没有按贴图缓存。
- 只在 Windows / Node 上跑；没在 macOS / Linux 试。
- 一个模型，一台 GPU；手机没试。

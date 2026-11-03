# 工具输出大小（给 AI 看的命令）

规则：先给答案，细节按需要再取。每个命令默认输出控制在约 40 行、4 KB 以内，最重要的事实和问题放前面，并说明怎样拿到更多（`--full`、`--limit N`、`describe <名字>`、下一条命令）。守卫测试：`npm test -- "tool output sizes"`（`packages/tools/tests/tool-output-sizes.mjs`），每个命令有自己的字节上限。

测法：在引擎包上起开发服务器，用无头页面跑 `execute()`（命令行和 MCP 用的是同一个入口），记录文字的字节数和行数；"MCP 结果"是 `{ content: [text], structuredContent }` 整个 JSON 的字节数。页面：world（引擎示例世界，`/`）、city（`/tests/city/index.html`）、styletest（`/styletest.html`）。2026-11-03 测量。

## 改动前后（字节 / 行）

| 命令 | 页面 | 改动前 | 改动后 | 改动前 MCP 结果 | 改动后 MCP 结果 |
|---|---|---|---|---|---|
| `scene` | world | 14717 / 145 | 2974 / 30 | 46423 | 约 6000（data 压到 3 KB 内） |
| `scene` | city | 12051 / 144 | 2549 / 31 | 41392 | 约 5500 |
| `scene` | styletest | 13069 / 137 | 3122 / 32 | 42744 | 约 6100 |
| `catalog` | world | 3139 / 50 | 1210 / 11 | 9691 | 约 4500 |
| `catalog` | styletest | 2713 / 44 | 1027 / 9 | 8464 | 约 4300 |
| `describe --full`（describeText 摘要） | world | 2349 / 30 | 2342 / 30 | 2666 | 2659 |
| `errors latest 20` | styletest | 3039 / 10 | 3039 / 10 | 6762 | 约 6000 |
| `verify barter` | world | 1797 / 12 | 1797 / 12 | 6231 | 约 4800 |
| `engine.describe()` 整个对象 | world | 43235 | 43235（新增 `describe('look')` 等按段取） | — | — |

`describe --full` 字节数没怎么变，变的是内容：以前引擎自己的账本表（shared、slots、owned、look……）占了 10 行左右，30 行一截，游戏用 `describe.add` 登记的状态被截掉了；现在游戏自己的段排在模块行前面，账本表合成一行计数（`Engine tables: shared 112, slots 30, …`），被截掉的模块会点名。

## 本来就在预算内的（没改）

| 命令 | world 页面（字节 / 行） |
|---|---|
| `status` | 150 / 3 |
| `describe` | 293 / 4 |
| `inspect` / `inspect 10,-4` | 290 / 3、361 / 3 |
| `inspect materials` | 2116 / 26（上限 2000 字符截断） |
| `inspect perf` | 847 / 10 |
| `ops` | 544 / 3 |
| `errors` | 1059 / 6 |
| `loading` | 118 / 2 |
| `pick 480,270` | 393 / 3 |
| `thing player` | 588 / 38（500 字符截断） |
| `explain quest first-light` | 230 / 2 |
| `catalog inventory` | 2139 / 20 |
| `scenario barter` | 697 / 5 |
| `snap`（含画面检查） | 748 / 9 |
| `threedog check`（全仓库） | 2463 / 29（警告按规则一行计数，`--verbose` 列全） |
| `threedog how describe` | 1901 / 12 |
| `threedog map` | 1283 / 9 |

`describe --all` 约 38 KB、`describeText({ full: true })` 约 38 KB：这是明确要"全部"时才给的，保持不变。

## 还没做的

- `errors latest N` 的文字可以再按错误种类合并重复行。
- `inspect materials` 相同的材质行（同类型、同用途、同补丁）可以合成一行 `×N`。
- `engine.describe()` 现在是先算全部再挑段；如果以后每步都按段取，可以改成只算要的那几段。

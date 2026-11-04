# 审查 C：工具、玩法模块、模板、文档（2026-11-04）

基线提交 `8690e1ac`，分支 `review/tools-docs`。没有改代码。

做法：用模板新建一个游戏，只照模板、`CLAUDE.md`、`AI.md` 和它们指向的 recipe 写。场景是第三人称，有 NPC、按 E 拾取加计数、带箭头的任务、存档和 Esc 暂停。然后用 Playwright 在页面里真实按键走一遍。`--open-world` 和 `--example` 各走了一遍短流程。

文档名字、README 和图的扫描交给了一个只读助手。其中 `recipes/01`、`recipes/20` 和 `Engine.js` 的 style 报错我亲自核对过。第 3 节和第 5 节里其余条目是它查到的，我没有逐条复核，修之前请再看一眼。

## 结论

- 照 recipe 63 和模板写出来的游戏，**按 E 没有任何反应**。而 `check`、冒烟测试、`describe`、`ops` 全部说没问题。这是本次最重要的问题。
- 补上按键绑定后，拾取、计数、对话、任务、存档、继续游戏、新游戏全部工作正常。
- 鼠标锁定时，胜负窗口用鼠标点不到，只能用键盘。
- 第一篇 recipe（01）还在教已删除的 `createEngine({ style })`，照抄直接抛错。

## 1. 严重

### 1.1 照文档做，E 键没有绑定，所有工具都报通过

- **位置**
  - `packages/engine/docs/recipes/63-third-person-start.md:14` 只绑了 `presets.bindings.walk`，`:50` 加 interactions 时没提按键。
  - `packages/tools/templates/game/main.js:23-28` 的现成注释行同样没提，`:24` 只说 walk。
  - `packages/tools/templates/game/CLAUDE.md:17` 写的是 “Press E on any mesh”。
  - `recipes/03-items-pickups.md` 开头的 Pick and count 也没写。
  - `templates/openworld/main.js:13` 列出可加的 `interactions()`，那里同样只绑了 walk 和 debug。
- **现象**：提示显示 `· Pick up`，键名是空的。按 E 后计数不变，对话不开始。`quests` 的 J 键也没绑，控制台反复出现 `input-unbound` 警告。
- **复现**：`new-game`，取消注释模板那几行，把 `shell` 补上，点 Start，走到旁边按 E，`Coins` 仍是 0。
- **各工具的说法**

| 工具 | 输出 | 是否属实 |
|---|---|---|
| `npm run check` | 只报 GAMEMAP 过期，没有按键问题 | 漏报 |
| `threedog test -w` 冒烟 | 6 项通过，0 失败 | 假通过 |
| `threedog describe` | `Nearby: Pick up 1 m (interactable)` | 误导 |
| `threedog ops` | `✓ interaction.use id=interaction1` | 误导，op 能跑但玩家按不到 |
| `threedog press KeyE` | `✓ Pressed KeyE` | 键确实按了，但什么也没发生，输出没有说明 |
| `threedog press interact` | `✗ action "interact" has no keyboard key` | **属实** |
| 浏览器控制台 | `input-unbound` 警告 | 属实，但冒烟测试不算它 |

- **在所属层修**
  1. 模板和 recipe 63：`bindings` 写成 `{ ...presets.bindings.walk, ...presets.bindings.interact, ...presets.bindings.quests }`。这一行放进模板现成行，recipe 03 同步。
  2. 冒烟测试：`describe().input.unbound` 非空时判失败，或至少明确提示。`input-unbound` 算测试失败。
  3. `describe` 和 `ops`：动作没有键时写明 “no key bound”，不要写 interactable。
  4. 提示部件：没有键时显示 “无按键”，不要留空。

### 1.2 第一篇 recipe 教已删除的入口，照抄就抛错

- `recipes/01-new-game.md:74,79` 和 `19-shooting-picking.md:12,15` 教 `import style from './style/index.js'` 和 `createEngine({ style })`。`core/Engine.js` 对这个选项直接抛错，模板里也没有 `style/`。19 还标着 “copy it and it runs”。
- `recipes/20-content-actions-save.md:105` 写 `interactions({ pick: fn, keys: ['KeyE'] })`。我注入到游戏代码里，`check` 报 `keys is not a known option`。
- `recipes/55-mods-time-wrap.md:45` 层表还有 `style` 层，`core/sharedPoint.js:33` 的 LAYERS 已经没有。
- 修法：01 和 19 改用 `createLook`（写法照 63），20 删 `keys`，55 删那一行。01 改完后指向 63，不再维护两份开局写法。

### 1.3 鼠标锁定时，胜负窗口用鼠标点不到

- **位置**：`packages/engine/ui/UI.js:87` 的 `toggle` 打开窗口时不放开鼠标锁。`recipes/26-ui-parts.md:142` 却写 “works with the keyboard, a gamepad and the mouse”。
- **复现**：`followCamera({ pointerLock: true })`，锁定鼠标后按 recipe 26 的写法打开 results 窗口。
  - `document.pointerLockElement` 仍是画布，光标看不见。
  - 鼠标点 Again 的位置，窗口不动，`clicks` 没增加。
  - 按 Enter 能按下 Again（光标默认就在 Again 上）。
  - 第一次 Esc 放开鼠标，窗口还在。第二次 Esc 关掉窗口，游戏回到 `running`，没有走重玩。
- **结论**：胜负窗口用键盘和手柄能到达，用鼠标必须先按一次 Esc，而且没有任何提示。鼠标玩家会以为卡死了。默认的 Esc 关闭还会让输掉的玩家绕过结局窗口回到游戏，recipe 没有提醒，胜负窗口应该给 `onCancel`。
- **同类**：`engine.settings.open()` 在锁定时打开（代码调用，或手柄 B 走的同一条路）锁不放开，已复现。背包窗口 `ui-inventory` 打开时锁也不放开，已复现。
- **修法**：放在 `ui/Focus.js` 一处。带 `nav` 的条目入栈时调用 `engine.page.releaseLock()`（`byEngine` 已有，不会被当成 Esc），关闭后下次点击再锁。这样窗口、设置、背包、对话选项一起解决。

### 1.4 `--open-world` 和 `--example` 模板丢掉 `content/places.js`

- **位置**：`templates/openworld/main.js:22`、`templates/example/main.js:21` 写 `engine.content.load(data, { places: { home } })`。`content/places.js` 自己的注释说要写 `{ ...data.places, home }`。
- **复现**：`--open-world` 游戏里给 places.js 加 `well`，`threedog shot --at well` 失败：`no such place. Places: home`。写在 places.js 的地点运行时全部不存在。
- **修法**：两处都改成 `{ places: { ...data.places, home } }`。

## 2. 中等

### 2.1 游戏自己调用 `document.exitPointerLock()` 会弹出暂停菜单

- **位置**：`packages/engine/ui/Focus.js:60-64`。
- 这段的注释说，游戏自己放开鼠标时不能盖住它的窗口。但只有引擎内部的 `page.releaseLock()` 算 `byEngine`，而它标着 `@internal`，文档也没教。
- **复现**：运行中调用 `document.exitPointerLock()`，设置菜单打开，状态变 `paused`。
- 只有焦点栈非空时才不受影响。游戏用自己画的 DOM 且没有 `uiFocus.push` 时一定中招。
- **修法**：公开一个放开鼠标的入口（比如 `engine.page.releaseLock` 去掉 internal，写进 recipe 21），或在 recipe 07 写清必须先 push。

### 2.2 Focus.js 这次改动的其他副作用

已确认没问题：
- 标题画面不会弹菜单，状态不是 `running`。
- 窗口打开时 Esc 只放开鼠标，不会再开设置。
- 设置窗口打开后 Esc 能关上。
- 关闭后下次点击重新锁定。
- `settings` 不冻结世界时，焦点栈的判断仍然挡得住。

没有验证：
- 切换窗口时 `blur` 和 `pointerlockchange` 的先后。如果后者先到，切走会弹菜单，影响不大但不是有意的。
- 真实浏览器的 Esc。无头 Chromium 不走浏览器自身的 Esc 处理，我用 `document.exitPointerLock()` 模拟，真实键盘路径需要人工按一次。

### 2.3 recipe 63 关于计数存档的说法自相矛盾

- `recipes/63-third-person-start.md:63` 说计数值放在 `game` 里，由你的 `register` 保存。
- 同一节 `:55` 的注释和 recipes/03 说 `once` 和 `counter` 由模块保存，代码也是（`Interactions.js:89`）。
- 实测不写 `register` 时计数能恢复。两边都存可能重复计数，这一点是从代码推断的，我没有跑。
- 修法：删掉 `:63` 里 “counter by your register” 的说法。

### 2.4 现成代码行里的 `shell` 没有定义

- `templates/game/main.js:28` 和 `recipes/63:55` 用了 `shell`，前后都没有定义。取消注释后是未定义变量。
- recipe 63 的文字讲 crate，代码讲 coins 和 shell，对不上。
- 修法：补一行建 mesh 的代码。

### 2.5 `threedog lib pull` 给错接入方式

- **复现**：`lib pull rain`。这是 `[look]` 类型的特效，输出却让你写 `engine.assets.manifest({ name: 'art', models: { rain } })`。
- **位置**：`packages/tools/art.mjs:195`，把导出的函数都当模型生成器，由 `lib.mjs:281` 打印。
- **修法**：`look` 类型不打印 Register，只打印 `use` 行。

### 2.6 文档还写着已删除的东西

名单见第 3 节。AI 按错误提示走也会走错：`core/errorCodes.js:309` 还写 `look.<part>.manual`。

## 3. 文档里已过时的名字（助手扫描）

- `recipes/16-dev-bridge.md:201` 的 `look.<part>.manual(key)`，应为 `engine.view.manual(key)`。
- `recipes/54-three-idioms.md:16-17` 的 `engine.look.<part>`，写成“弃用”，其实已删除。
- `recipes/52-look.md:152` 的 `describe().look...`，`core/Describe.js` 已无此节。`types/core.d.ts:2025,2039,2276` 同样过时，这些注释会进 docs/api。
- `CONVENTIONS.md:167,184,195` 的 `style/`、`look.<part>.set`。
- `COMMANDS.md:122` 的 `examples/world/style/` 不存在，`:91` 说 api-count 统计 look parts，已没有。
- 失效锚点：`recipes/08:21`、`56:149` 的 `52-look.md#tsl-forms`；`60:26`；`60:31`。规则提示 `rules/R26-render-entry.mjs:22` 的 “recipe 09 §2c” 不存在。
- `recipes/41:79`、`46:111`、`templates/game/DESIGN.md:40` 的 “material role”；`36:48` 的 `// style:`；`52:174`。
- `types/core.d.ts` 的 EngineUniforms 缺 `uWindAmp`，运行时有，文档也在教。
- `MIGRATING-0.6.md` 缺 `look.water`、`look.materials`、`look.surface`、`look.shadow`、`createEngine({ style })`、`makeMaterial`、`defineLookPart`、`threedog style`、`engine.styleWorkbench`、`style` 层。开头写 “is going away”，实际已删。没有入口文档链接它。
- recipe 指向：`templates/game/CLAUDE.md:18` 任务写 26，应为 04。`:19` 和 `main.js:33` 的 10 §4 应为 05 §2e。`:12` 的 26 §5 只讲标题画面，`makeWindow` 在 “A window” 小节。
- `AI.md` 没有指向 53、59、60、61，部署和判断画面从索引页找不到。

**R18 为什么漏掉这些**：它不查选项键；跳过 js 代码块；成员只查两层，且只匹配 `engine.`；含 `<part>` 的当占位符放过；不查字符串值、`describe().look` 这种调用后的链、无扩展名路径、`#锚点`、`§` 章节；不读模板 .js 注释、d.ts 注释和错误文案。文档里的代码块没有被真正类型检查过，这是 1.2 漏掉的根因。修法是让 R13 把 recipe 的 js 代码块当成游戏代码检查未知选项和找不到的 import。

## 4. 应该合并的 recipe（助手只看了标题和开头，合并前再读正文）

- 40 和 41：最该合并，都讲场景里有什么、存档留什么。
- 34 和 38：应合并，再和 09 §1b、62 §1 去重。09 §0 和 62 §0 都讲 `look/`，留 62。
- 36/37/38/44 各管一块，不算重复，但文件名里的 “look-hooks” 已过时。
- 52 的 “How look values stack” 和 55 重复，留 55。`52-look` 这个名字也该改。
- 47 是拼盘：圆边并入 42，雪和季节并入 08。
- 01 和 63 都讲开新游戏，保留一份为主。
- 20 和 23、52 和 60 不重复。

## 5. README 和图（助手扫描）

文字（中英行号相同）：`:33` “a material for a role”；`:35`、`:86` 拿灯光强度和雾当例子，引擎现在不写这些；`:41`、`:60`、`:88`、`:90` 的 style；`:98`、`:100` 整段讲 look part 的动词，要重写；`:104` 写 two sets，表格是 3 组；`:178` 只提 0.5。`README.zh-CN.md:141` 还写空的 `style/` 文件夹，`:100` 还讲画风包。

`docs/brand/diagrams/`（源是 `draw.mjs`，改后重新生成 10 张）：

| 图 | README 位置 | 问题 |
|---|---|---|
| `look.png` / `look.zh.png` | `:98` | 整张过时：Style pack、Look parts、`look.*.set`，要重画 |
| `layers.png` / `layers.zh.png` | `:88` | 多一层 style，一行字挤出了框 |
| `arch.png` / `arch.zh.png` | `:58` | Your game 写着 style |
| `design.png` / `design.zh.png` | `:31` | “look values” 过时 |
| `module.png` / `module.zh.png` | `:70` | 没问题 |

版本：4 个包都是 0.5.0，互相一致。但代码已经是 0.6 的 API，`MIGRATING-0.6` 也在。发版时要一次改齐 package.json、模板依赖、`lib/scaffold.mjs:38`、`COMMANDS.md:36`、两个包的 README。这份清单没有测试守着，建议写进 `docs/plans/release-checklist.md`。

## 6. 轻微

- `threedog status` 在新页面上报旧错误：我加载过 `?at=nosuch` 之后换了页面，仍显示 `✗ Ready ... 1 page error`，这是一条过期的失败。
- `threedog lib add look/palette.js` 把它标成 `[module]`，`use` 为空（`lib.mjs:121` 的推断），文件头说 look/ 下的单文件是 `look` 类型。
- `shot` 的阴影提示：地面没开 `receiveShadow` 时，它报 “shadows on but none measurable”，矛盾说得对，但原因写 “no shadow setting stands out”，没有点出最常见的原因。
- recipe 26 的窗口代码放进 `// @ts-check` 的模板，`ev.target.closest` 会出 `!` 提示，不影响运行。
- `collision.addObject(obj, { pad, occluder })`（`Collision.js:127`）不校验选项，写错键静默忽略，别的 add 都校验。这条是读代码得到的。

## 7. 查过没问题

真实按键（绑好 E 之后）：
- 第三人称：W 行走、点击锁定鼠标、E 拾取（模型隐藏，计数 +1）、E 对话、Enter 选对话项、标记显示距离、两步任务完成。
- 存档后刷新，Continue 恢复位置、计数、旗标、任务和隐藏状态。
- `engine.session.newGame()` 全部复位。
- Esc 暂停（模拟鼠标解锁）开设置，Esc 关闭。
- `?at=well` 跳过标题到达该处，`?at=nosuch` 明确报错并列出地点。
- `--example`：走路、E 拾取苹果、I 开关背包、Esc 暂停，没有错误。
- `--open-world`：走路、Esc 暂停，没有错误。

工具：
- 注入错误后 `check` 能报（退出码 1）：未知选项 `keys`、`bogus`、`style`，还有找不到的 import。游戏代码这边没有假通过。
- `new-game` 三种模式都一次成功，自带的 map 和 check 通过，tracked 文件没有被改动。
- `shot`：标题盖住画面时会说明；`--play` 能拍到标题后面的画面；`--at` 失败时说清原因。
- `art board`：报出 `nosuchmodel` 缺失和 `default` 材质未用，数字属实。
- `lib list` 和 `lib pull nosuch`：属实，后者报错。
- `picture compare` 和 `palette`：数字和声明都老实，写明不是相似度。
- `threedog how "press e pickup counter"`：第一条就指到正确的行。
- `verify` 的文档写明 `real-browser-input 0 (not verified)`，这一点是诚实的（只读了文档，没跑 verify）。

## 8. 这次没做到的

- `packages/tools/panel` 没有看。
- 50 条规则没有逐条审，只做了注入测试和 R18 分析。
- 碰撞形状（`collide: 'box' | 'circle' | { circle }`、`addBox`、`addCircle`）只读了代码和 recipe 30，没有实际跑。走进墙里的测试没做。
- `dialogue`、`quests`、`hud` 只跑了主流程，没有按改动逐行读。
- 没有看任务标记在画面外时的箭头，只看到了画面内的圆点和距离。
- 真实浏览器 Esc、切换窗口、手柄都没测。`?at` 在生产构建里的行为没测。
- 根目录完整 `npm run check` 和 `npm test` 没有跑。

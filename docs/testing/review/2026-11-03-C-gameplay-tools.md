# 复审 C：玩法模块与工具（master `cb85ad58`）

范围：`packages/engine/modules/`（地形/植被数据和分块、HLOD、寻路、物理和碰撞同步、角色/相机、交互、背包、任务、过场、日历、天气数据、水、粒子、拍照、网格、联机、操作和契约、内容数据）以及 `packages/tools/`（`threedog` 命令和 MCP、rules/、测试运行器、how、lib、perf、gallery、新游戏模板）。

做了什么：读了设计文档和这几块的主要代码；跑了 `npm run check`（通过，0 个错误，123 个警告）；单独跑了几条规则，看了警告明细；`threedog how` 试了两次；另写了一个只读脚本，对照"契约里列的方法"和"别的模块实际调用的方法"。没开开发服务器，没跑浏览器测试。

总的看法：结构比设计文档写的要好。design.md 第 13 节里好几条"没做到"其实已经做完了（见最后的核对）。真正的问题集中在三处：**换掉一个模块时契约兜不住**、**插件文件夹和素材库连起来会出错**、**新游戏模板还在教旧写法**。另外测试运行器和规则各有几处会漏报。

---

## 一、最要紧的问题（按根因分组）

### 1. 契约没列全，换掉背包后联机和内容改名会崩（中，真 bug）

- **是什么**：`modules/gameplay/inventory.contract.js:10` 的 `api` 只列了 12 个方法。可是别的模块还调了三个契约里没有的：
  - `modules/net/sync.js:30` `e.inventory.contents()`，`:77` `e.inventory.setContents(...)`。注释原话是"public API only: any module that provides 'inventory' syncs the same"，也就是说它默认任何背包都有这两个方法；
  - `modules/content/ids.js:74` `e.inventory?.renameIds(map)`（`?.` 只防"没装背包"，不防"背包没有这个方法"）。
- **为什么要紧**：契约检查的意思是"能不能换成自己的"有一个是或否的答案。现在 AI 自己写的背包能通过 `runContract`，装进联机游戏后第一次同步就报 `TypeError: e.inventory.contents is not a function`，内容文件里写了改名表（`renames`）时一加载也一样崩。这就是检查报了通过、实际却坏了。
- **场景**：合作联机游戏，AI 按菜谱 55 换上自己的背包（`replaces: 'inventory'`），跑契约全绿；进了联机，主机第一次发容器内容就崩。
- **怎么修（在契约层）**：把 `contents / setContents / renameIds` 加进背包契约，并在 probe 里补一次"contents 取出、setContents 放回、值不变"。根上的办法是加一条规则或工具测试：扫 `modules/**` 里 `e.<插槽名>.<成员>` 的用法，凡是不在该插槽契约 `api/fields` 里的就报错。我写的脚本只扫出了这一处真缺口（对话的 `bubbles` 已经用 `?.()` 防着；日历扫出的三个是 `Sky.js` 改名表里的字符串，不算）。所以这条规则现在加上就是绿的，以后防止再漏。
- **大小**：契约补全是小活，加规则也是小活。

### 2. 素材库拉下来的代码放进 `plugins/` 后，开局就报错（中，真 bug）

- **是什么**：`threedog lib pull` 把代码类条目（shader / material / effect / module）默认放进游戏的 `plugins/`（`packages/tools/lib.mjs:151`）。插件文件夹按导出的东西接入：没有默认导出时，**每个具名导出**都必须是可接的形状，否则开发时抛 `plugin-shape`（`packages/engine/core/plugins.js:70-72`）。可是素材库里的代码，最自然的样子是导出一个工厂函数。工具自己的测试样例就是这样：`tests/lib.mjs:26` 的 `export function sparks(...)`，`:30` 的 `export const glow = () => new THREE.ShaderMaterial(...)`。测试只核对了文件有没有拷对（`:56`），没跑过游戏开局。
- **更糟的一处**：`core/plugins.js:29` 在 WebGPU 下把**任何函数**都当成后期节点工序（`typeof v === 'function' → 'post'`）。拉下来的 `glow` 工厂函数在 WebGL 下会报一个看得懂的错；在 WebGPU 下却被当成后期工序挂进去，以 `(input, ctx)` 调用，返回的是一个材质。结果是画面坏掉或报一个看不懂的错。同一个文件，两种渲染方式下行为不同，违反第 8 条（两种渲染方式要一致）。
- **场景**：上一个游戏 `lib add` 了一个 `toonMaterial()` 工厂，新游戏 `lib pull toon`。`npm run dev` 开局报 `plugins/toon exports a function`；换成 WebGPU 则画面坏掉。拉取时打印的那句"If the file exports a function, export its result instead"（`lib.mjs:207`）只是事后提示，没有拦住。
- **怎么修**：
  1. 插件形状只认显式的标记。函数只在被明确标成后期节点工序时才当工序（例如 `export default postNode(fn)`，或要求导出名叫 `pass`），否则两种渲染方式下一律报同一个"不是插件"的错；
  2. `lib pull` 拉代码时检查形状：不是可接形状的，就生成一个 `_` 开头的帮手文件，再加一个只有一行的接入文件（`export default sparks()`）；或者放进 `art/`，并打印要手写的那一行；
  3. `tests/lib.mjs` 加一项：拉下来的游戏能开局。
- **大小**：中。

### 3. 新游戏模板还在教已经被替换的写法（中）

- `templates/game/style/index.js` 最后几行写着 `post: [], // post effects in order, e.g. bloom() from @threedog/post-effects`。按 `docs/plans/2026-11-03-style-bundle.md` 的迁移表，"画风里放后期 Pass 绕到 `post: [...]`"已经换成"在画风的 `plugins/` 里导出 Pass 本身"。模板里没有 `plugins:` 这一项，也没有 `style/plugins/` 文件夹，AI 照着模板写只会走旧路。这和 P11（一件事不留两套写法）冲突，旧的 `post` 列表和 `postAdd / postRemove` 还留在 `core/styleParts.js:6-41`（属于外观那块的复审，这里只说模板）。
- `templates/game/package.json` 的空白模板也默认依赖 `@threedog/post-effects`。按现在的说法，后期首选普通 three.js 的 `engine.post.addPass(pass)`，空白模板不该默认装一个可选包。
- `templates/game/plugins/README.md` 已经是新写法，没问题，所以模板里新旧写法是混着的。
- **修**：画风模板删掉 `post` 那行，换成 `// plugins: import.meta.glob('./plugins/*.js', { eager: true }),   // look plugins of this style (a Pass, a Material, a patch)`，并建空的 `style/plugins/.gitkeep`；空白模板去掉 post-effects 依赖（`lib/scaffold.mjs` 按需加，和 terrain-noise 一样）。小。

### 4. 测试运行器和规则有几处会"假通过"（小到中）

1. **`check()` 收到 Promise 会算通过**：`run.mjs:153` 是 `ok: !!ok`。写成 `check('门开了', ev(() => ...))`、漏了 `await` 时，Promise 永远是真值。现在代码里没有这种写法（我 grep 过），但没有任何东西拦着。修：`collect()` 里遇到 thenable 就记成失败，`detail: 'check got a Promise: add await'`。小。
2. **一项检查都没记的条目算通过**：工具测试（`run.mjs:319-323`）的 `run()` 如果提前 return、一次 `check` 都没调，`report` 收到空数组，照样 `ran++`、不算失败。页面测试至少还有一条"没有控制台错误"，但一个只靠这条撑着的 spec 实际什么都没测。修：自己的检查数为 0 时记一条失败（"no checks recorded"）。小。
3. **重复写同一个选项，前面的静默被覆盖**：`lib/cli-args.mjs:68` 是 `opt[k] = v`。`npm run check -- --rule R10 --rule R2` 实际只跑了 R2（我实测，输出里只有 R18、也就是最后一个）。AI 很自然会这样写，看到"0 errors"就以为都过了。修：值选项重复出现时报错，或者合并成列表。`check --rule` 本来就支持逗号分隔，报错里提示用 `R10,R2` 即可。小。
4. **规则 R16 / R46 抓不到两种跨模块引用**：两条都只匹配 `from '../<别的模块>/...'`。`'../../modules/nav/x.js'` 这种绕一圈的路径，以及动态 `import('../nav/x.js')`（没有 `from`），都会漏掉（`rules/R46-module-internals.mjs:23`，`R16-module-deps.mjs` 的 `IMPORT`）。现在代码里没有这样写的，属于防患。修：先把路径解析成绝对路径再判断归属，也覆盖 `import(`。小。
5. 同名检查只在"一个工作区内部"和"工具测试之间"做。页面测试和工具测试同名时，一个过滤词会选中两个（`lib/specs.mjs`、`run.mjs:117`）。小，顺手修。

### 5. 物理在 `start()` 之前加物体会静默返回 null（中，易用性）

- `modules/rigid/RigidBodies.js:135`：物理（Rapier）还没就绪时，`addBox / addBall / addHull` 只 `warnOnce` 一次，然后返回 `null`。而两份模板都把场景搭建写在 `await engine.start()` 之前（`templates/*/main.js`），AI 很可能就写在那里。
- **场景**：`const crate = engine.rigid.addBox(mesh, { mass: 5 })` 写在 start 之前，`onFixed` 里 `crate.body.applyImpulse(...)` 报 `Cannot read properties of null`。报错的位置离原因很远，P7（不悄悄出错）在这里只做到了"打一条警告"。
- **修（在物理模块里）**：之前加的先排队，立刻返回一个句柄，就绪后补上 `body`（`whenReady` / `ready`）；如果不想排队，至少在开发版里抛带改法的错，而不是返回 null。中。

### 6. 内容加载器是个"什么都认识"的中枢（中，设计）

- `modules/content/index.js:201` 的 `optional` 列了 15 个模块；`loader.js` 写死了加载顺序和每个模块的数据格式（"vocabulary -> key actions -> vegetation -> items -> ... -> props"），`BUILTIN_RUNS` 里直接调 `e.quests.start`、`e.particles.emit` 等。
- **为什么要紧**：引擎每加一个模块就得改内容加载器。AI 自己写的模块（比如"配方"）没法登记"我认 content 里的 `recipes` 段"，只能靠"游戏自定义种类"（`rules.js` kinds）绕过去。换掉任务、对话后，内容加载器照旧按引擎版的数据格式喂进去，这层约定连契约里都没写。
- **修**：反过来做，由模块向内容登记自己的那一段（`content.kind('quests', { fields, load(data) })`），内容加载器只负责排顺序、核对 id、带上源文件行号。引擎自带的模块各自搬过去。这件事和下一版"World IR / 编辑器"是同一个方向，可以放到那时一起做。大。

### 7. 数据模块还在碰外观（小到中，设计）

- 地形的**数据**模块（`modules/terrain/index.js:53-80`，类型 `world`）读 `style.terrain` 的颜色、`biomeColors`、`variation`，在分块生成时（worker 里）把颜色烘进顶点。换掉地形外观（`replaces: 'terrain-look'`）之后，这份颜色还照算。外观模块还直接用同一个闭包里的 `w`（`:124-128`），没走 `engine.terrain` 的公开接口。
- 地形数据模块（`terrain/ChunkManager.js:170`）和天空的雾（`sky/lookFog.js:85`）用 `engine.mod` 写 `look.fog.far`（主人 `terrain:view`），没走 `ctx.mod`。这条记录不会随模块卸载撤回；`ChunkManager` 还直接改相机远裁剪面（`e.viewFar`）。
- 天气的数据部分（`weather/Weather.js:41`）也读 `style.weather`。
- **判断**：顶点颜色放在 worker 里算是为了性能，可以算有意的妥协（🤝），但要写进 design.md 第 12 节，并在 `replaces: 'terrain-look'` 时跳过颜色计算。雾的写入改成 `ctx.mod`，让它跟模块一起走，属于小修。

### 8. 水和粒子"能不能整个换"（核对 design.md 的 ❓）

- **水**：`look.water.replace(fn)` 只能换**材质**，平面网格、跟随吸附、水体网格都是引擎的（`water/look.js:65`、`water/Water.js`）。想用 three/addons 的 `Water` 或自己的几何，只能不装 `water()`。水位和水体数据在核心（`engine.addWaterBody`、`water:add` 事件），所以"不装水模块、自己画"是可行的，只是文档没把这条路写明。另外换材质有三个入口：`water({ material })`、`style.water.material`、`look.water.replace`。前两个各是游戏层和画风层的写法，算同一个共享点，可以接受；但 `Water` 构造时又把 `style.water` 直接摊进 `st`（`Water.js:34`），画风值有两条进来的路。结论：🟡，换材质可以，换整块要靠"不装模块 + 读水位信号"，这条路应写进菜谱 44。
- **粒子**：`particles` 模块 `provides: ['particles']`，可以用 `replaces` 整个换。但内容里的 `{ particles: ... }` 写法会调 `e.particles.emit`，粒子没有契约文件，换上的模块缺 `emit` 也不会被检查出来。结论：🟡，补一个粒子契约（`emit / define`）。小。

### 9. 玩法模块自带界面（小，一致性）

背包、任务是 `rules` 类型，却自带窗口和开关按键（`Inventory.js:212-215`、`Quests.js:220`）。可以用 `engine.ui.set('inventory', false)` 关掉换成自己的界面，所以不卡人，但和"地形、天气拆成数据 + 外观"的做法不一致。不急着拆，至少在 api 文档里写一句"只想换界面：`ui.set(name, false)` + 读 `describe` / 事件"。

### 10. 文档里的模块范例教的是不够安全的写法（小）

`docs/recipes/14-custom-module.md` 第 1 节的体力模块用的是 `install(engine)` 加 `e.mod('move.runSpeed', { owner: 'stamina', ... })`，没用 `ctx.mod`。模块卸载、替换或回滚时，这个"跑不动"的修改会留在原地（架构文档第 1 节的规矩是"模块加的东西都经过 ctx"）。同一页还写着"通用的放进引擎的 `modules/<name>/index.js` 并从引擎 `index.js` 导出"，又用 `games/<game>/` 当路径。这一页是随包发给做游戏的 AI 看的，这两句是给维护引擎的人看的，从 npm 安装的游戏里根本不成立。修：范例改用 `install(e, ctx)` + `ctx.mod`，删掉"放进引擎"那句。小。

### 11. 其余小问题

- **过时的兼容提示还在**：`renamed(...)` 留着 0.2 时代的旧名提示，`Dialogue.js:40`（`lock`）、`pickups.js:30`（`style.pickup.model`）、`Inventory.js:144`（旧的网格函数），以及核心里的 5 处。它们是"用旧写法时报带改法的错"，比静默强，但按 P9 应该给个期限（比如 0.5 删），并在 MIGRATING 里列出来。小。
- **HLOD 改了游戏物体的 `visible`**：`hlod/index.js:85` 用 `defineProperty` 把游戏网格的 `visible` 换成存取器。效果是对的（游戏自己的值保留），但这属于"改了原生 three.js 对象的行为"。design.md P2 说"只剩两处全局改动"，这一处是逐个物体的改动，没算进去，也不知道 `describe().threePatches` 里有没有它。要么登记，要么在 P2 那格里注明。小。
- `lib.mjs` 的 `entries()` 遇到读不了的 `entry.json` 直接跳过（`catch { return []; }`），坏掉的条目从列表里悄悄消失。改成在 `lib list` 末尾列一行"这几个条目读不了"。小。
- `threedog how` 把 `THREE.md` 里的引擎接口行（"Rigid bodies → engine.rigid.addBox"）也标成 "plain three.js"，排在最前。这和"three.js 能做的先给 three.js 答案"的意思不符，应该只把真正的 three.js 写法标成 plain。小。
- 规则警告里属于本区域的：R10 地形 `chunkQueries.js` 和植被 `groundChunks.js` 还有两段重复（`:19-30` / `:151-159`、`:8-9` / `:163-164`），属于"分块共用了，但分块查询没共用"；R31 `world/persist.js:109 isObj` 和 `content/packs.js:23` 重复；R2 `pickups.js:192 pickupModelName`、`ChunkManager.js:20 NO_VEG`、`world/persist.js:111 checkWorldSave` 是没人用的导出。都是小活。

---

## 二、做得好的（复审时别误改）

- 分块加载已经合成一份（`core/chunkStream.js`，地形和植被共用）；导航和物理的静态碰撞同步也已经合成一份（`collision.mirror`，`Collision.js:52-56`）。
- 模块之间只走公开接口：R25（含别名追踪）、R46、R16、R27、R47 都是 0 错误；R27 的白名单只剩 3 条，都写了理由。
- AI 自己写玩法不会被卡死：直接调 `character.move()` 会报 `control-bypass`，但报错里给了可以照抄的改法；击退、冲刺有 `push()`，速度写入当冲量处理，`mover: 'manual'` 可以整个接管（菜谱 32、55）。R33 只拦"开局造了存档会整份存下的东西"，并给出 `{ save: false }` 这个出口，没有逼人把东西都写进内容文件。
- 测试运行器：过滤词匹配不到时会失败（"NOTHING MATCHED"）；一个都没跑也算失败；文件导出为空、名字重复，都在开浏览器之前就拦住；读像素的测试自动改用软件渲染，漏标的会在最后列出来。思路是对的，只差第 4 节那几处。
- MCP 和命令行跑的是同一套代码，输出默认很短（`describe` 3 行、`--max` 封顶），有专门测输出大小的测试。

---

## 三、design.md 逐条核对（本区域）

| 条目 | 现状对不对 | 可妥协 | 需改进 | 没做到 |
|---|---|---|---|---|
| P1 three.js 永远可写（玩法侧） | 大体对。玩法上直接写 three.js 和普通 JS 没被挡；控制权冲突报错里有改法 | `control-bypass` 是合理规则 | 物理 start 前静默返回 null（一、5） | — |
| P2 不遮住 three.js | 漏了一处：HLOD 改了物体的 `visible`（一、11） | 逐物体改、效果正确，可以算妥协，但要登记 | 写进 P2 或 `describe().threePatches` | — |
| P3 不限制发挥：水、粒子能否整个换（❓） | 应改成 🟡 | 水只能换材质，整块换靠"不装模块 + 读水位"，可以接受 | 菜谱写明这条路；粒子补契约（一、8） | 水的网格不能 replace |
| P6 通用 | 本区域没看到为某类游戏定的默认值；交互的 `pick` 要求游戏自己选，做得对 | — | — | — |
| P7 不悄悄出错（玩法和工具角落 ❓） | 应改成 🟡 | — | 契约漏方法（一、1）、插件形状在 WebGPU 下误认（一、2）、物理返回 null（一、5）、`--rule` 被覆盖（一、4.3）、lib 坏条目被跳过（一、11） | — |
| P8 简单、旧写法删没删干净（❓） | 应改成 🟡 | — | 模板的 `post: []`（一、3）、`renamed` 提示（一、11） | — |
| P9 过时的就删 | 🟡 对 | `renamed` 报错提示可以留一个版本 | 定期限；模板同步 | — |
| P11 不留两套写法 | 本区域内：画风后期有 `post:` 和 `plugins` 两条路，模板还在教前一条；水的画风值两条进路 | — | 删 `post:` 列表或写明分工；模板改新写法 | — |
| P10 每帧浪费（❓） | 本区域没看到明显的每帧分配：分块跟随在空闲帧不分配，HLOD 每 0.25 s 才判断一次 | — | 换掉地形外观后颜色照算（一、7） | — |
| 4.1 工程模块"水、粒子 ❓" | 水：数据（水位、水体）在核心，外观在模块，实际上已经拆开一半；粒子是单个外观模块 | 可以 | 见一、8 | — |
| 4.1 玩法功能可替换 ✅ | 偏乐观，应改成 🟡 | — | 背包契约少 3 个方法（一、1）；内容加载器把引擎版数据格式当成默认约定（一、6） | — |
| 4.4 插件文件夹 / `lib pull` ✅ | 偏乐观，应改成 🟡 | — | 拉下来的函数会让开局报错；WebGPU 下函数被当成工序（一、2） | — |
| 6 模块之间只用公开接口 🟡 / "核心暂留 12 个模块名" ❌ | 已过时：R27 白名单只剩 3 条，都有理由 → ✅（附 3 条理由） | 剩下 3 条可以留 | 加一条"调用的方法必须在契约里"的检查 | — |
| 6 越界报错 ✅ | 对 | 地形数据模块写雾、写相机远裁剪面（一、7），可以算妥协，但要改用 `ctx.mod` | — | — |
| 9 数据和代码 / 操作记录 🟡🤝 | 对 | 直接改世界记录不进操作记录，这个妥协合理 | — | 编辑器（下一版） |
| 10 让 AI 查得出：`threedog how` ✅ | 对 | — | THREE.md 里的引擎行被标成 plain（一、11） | — |
| 13 "分块加载、碰撞同步各有两份" | 已过时：两份都已合成一份 → 删掉这条；只剩分块**查询**的小重复（R10） | — | 合并 `chunkQueries` | — |
| 13 "句柄命名没统一成 remove、模块按键选项没收完" | 已过时：模块里没找到别的句柄动词，也没写死按键（R6-D、R11 都是 0）→ 删掉 | — | — | — |
| 13 "选项表抄了三份" | 部分对：选项表在代码和类型声明里各写一份，由 R6 保证一致 | 有规则守着，可以算妥协 | 能从同一个表生成类型最好 | — |
| 11 测试结果写进 runs.md ✅ | 对；运行器本身见一、4 | — | 修 Promise 和"零检查"两处假通过 | — |

---

## 四、建议的顺序

1. 背包契约补全，并加"调用的方法在契约里"的检查（小，防假通过）。
2. 插件形状改成只认显式标记，`lib pull` 检查形状并补测试（中）。
3. 运行器修 Promise、零检查；命令行重复选项报错（都是小活）。
4. 新游戏模板换成画风插件的写法（小）。
5. 物理 start 之前的句柄改成排队（中）。
6. 更新 design.md：第 13 节删掉三条过时的；P3、P7、4.1 玩法、4.4 的标记改成 🟡；第 12 节加上"地形颜色在数据侧计算"这条妥协。
7. 下一版和编辑器一起做：内容加载器改成由模块登记自己的数据段（大）。

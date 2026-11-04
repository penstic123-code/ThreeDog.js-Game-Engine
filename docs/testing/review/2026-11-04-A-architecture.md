# 2026-11-04 代码审查 A：core、模块边界、删除后的遗留

审查对象：`8690e1ac`（`visuals/signals-in`），和 master 比较。范围是 core/、模块边界、外观层删除后留下了什么。只审不改。

判断依据有两种，每条都写明：
- **实跑**：写了一个临时测试页跑过，结果贴在条目里（测试文件已删，没有提交）。
- **读代码**：沿着代码路径读出来的，没有跑。

结论先说：外观层的删除做得比较彻底，引擎确实不再写灯、雾、曝光和环境图。问题集中在四处：删掉之后留下的"谁在写这个值"的判断不再成立（第 1 条）；"影子开关只管渲染器"这条新规矩有两处没改到（第 2 条）；有一个守卫测试已经是空的（第 3 条）；新加的 `once` 在文档主推的写法下存档不稳（第 6 条）。

---

## 高

### 1. 游戏在第一帧之前写 `scene.background`，写了等于没写，describe 还说是引擎在写（实跑）

- 位置：`packages/engine/core/owned.js:70`（`check()` 里 `!this._snap` 直接返回），`packages/engine/modules/sky/frame.js:50`、`:82`（第一次 `check` 什么也不做，帧末 `mark` 把游戏的值记成基准）。
- 怎么坏：装了 `sky()` 时，穹顶盖在 `scene.background` 上面，要靠"检测到外部写入"才隐藏穹顶。第一帧之前没有快照，所以这之前的写入永远检测不到。穹顶一直显示，画面上看不到游戏的背景。
- 为什么这是主路径：模板的 `main.js:18` 在 `engine.start()` 之前就调 `createLook(engine)`，而菜谱 62 第 135 行告诉游戏"`scene.background` 写你自己的颜色"。在 `look/` 里写背景，恰好落在这个窗口里。这正是计划第 4 节规则 1 要消灭的"我改了没反应"。
- 复现：
  ```js
  E.use(T.sky());
  E.scene.background = new THREE.Color(1, 0, 0);
  await E.start(); E.step(0.05); E.step(0.05);
  // 实跑结果：dome.visible = true，describe().owned.background.writer = 'engine'
  ```
  同样的写法放到 `start()` 之后：`dome.visible = false`，writer 是 `three (engine yielded)`，这才是对的。
- 修法（`modules/sky/frame.js` 的 `watchOwned`）：注册时立刻 `mark()` 一次，并且基准要取 sky 装上那一刻的值。如果游戏在 `sky()` 之前就写了，还要和 `engine._baseBackground` 比一次：`scene.background !== e._baseBackground` 就当成游戏已经接管。`owned.mjs` 加一条"第一帧之前写"的用例，现在的用例都是先 `drive` 两次再写，测不到。

### 2. 影子先关后开，有的光就再也不投影了（实跑）

新规矩写在 `core/shadows.js` 的 `switchShadows` 上：总开关只动渲染器，不碰 `castShadow`。但有两处还在把"此刻开关状态"抄进 `castShadow`，抄完没人改回来。

- **级联，影响游戏自己的光**：`packages/engine/render/cascades.js:98`，`l.castShadow = shadowsOn(e)`。
  关着影子时调 `engine.shadows.cascades(sun, { count: 3 })`，再打开。实跑结果：`csm.lights` 的 castShadow 是 `[true, false, false]`。近处有影子，第二、第三级都没有，而且不报错。触发方式包括玩家在设置里关着影子进游戏、再在菜单里打开。
- **占位太阳**：`packages/engine/modules/sky/Sky.js:89`，`this._sun.castShadow = shadowsOn(engine)`。
  先 `engine.shadows.enabled = false`，再 `engine.use(sky())`，再打开。实跑结果：`on: true, renderer: true, sunCast: false`。总开关说开着，太阳不投影。
- 修法：两处都写 `true`。这两盏光都是引擎自己的，是否画影子本来就由 `renderer.shadowMap.enabled` 决定（`cascades.js:138` 的 `show` 已经另外判断了开关）。

### 3. 守卫测试 `look values cannot be bypassed` 已经是空壳（读代码）

位置：`packages/engine/tests/specs/look-no-bypass.mjs`。`docs/architecture.md:25` 还把它列为共享点这一节的守卫。

- `:55` 写的是 `out.three = { v: ..., writer: 'three' }`，`:66` 再检查 `r.three.writer === 'three'`。**自己写的字面量自己比，永远通过**。检查的文字却写着"describe tags it three"。
- 同一条检查的另一半是写 `engine.lights.hemi.intensity = 0.123` 后读回来。现在没有人写 hemi，这个值当然留着，什么也证明不了。
- 文件头 `:9`、`:10` 的规则 4（手动交回）和规则 5（卸下天气模块后还原）在测试正文里已经没有了。
- 第 1 条规则改成了测试自己现造的 `test.light` 点，不再碰任何真实的画面值。
- 保留下来有效的只有：设置层限制影子、同层冲突、天气不写入。
- 修法：删掉第 4 条检查和文件头的规则 4、5，改名为"shadows.enabled 的层级"之类名副其实的名字；"引擎让位"由 `owned.mjs` 负责。同步改 `architecture.md:25`。

---

## 中

### 4. 有自带风函数的物种，一调 `vegetation.sway()` 就把 NaN 写进着色器（读代码，没跑）

- 位置：`packages/engine/modules/vegetation/look.js:62`，`this._windPatch(sp.source.wind)`；`:84` 把参数当振幅；`render/effects.js:212` 是 `(+amplitude).toFixed(4)`。
- 怎么坏：`wind` 可以是数字，也可以是 `{ amplitude, glsl, tsl, uniforms }`（`Vegetation.js:107`）。`:62` 只判断真假，把对象当振幅传了进去，结果生成 `#define THREEDOG_WIND_AMP (NaN * uWindAmp)`，着色器编译失败；就算不失败，物种自己的风函数也被盖掉了。
- 而 `:104` 的注释写的是"a species' own wind object wins"，`Vegetation.js:230` 的文档写的是"every swaying species"。这两句互相矛盾。
- 复现：`vegetation.define('a', { wind: { amplitude: 0.1, glsl } })` 之后调 `vegetation.sway(spec)`。
- 修法：`:62` 跳过 `typeof sp.source.wind !== 'number'` 的物种，文档改成"数字振幅的物种"。

**关于两个风入口的判断**：物种的 `wind` 和 `vegetation.sway()` 范围不同（单个物种 / 默认形状），有明确的优先顺序，不算两条路。修掉这个 bug、统一文档就行，不用合并。

### 5. 拍照模式的 `shadowMapSize` 在新游戏里什么也不做（读代码）

- 位置：`packages/engine/modules/photo/Photo.js:34`、`:42`，`packages/engine/modules/sky/shadow.js`（`setShadowMapSize`），`Sky.js`（`shadowMapSize`）。
- 怎么坏：这些入口只改 `engine.lights.sun`。但 `new-game` 模板（`templates/game/main.js:14`）用 `lights: false`，太阳是游戏 `look/lights.js` 自己造的。占位太阳不在场景里，改它不起作用，也没有提示。外观层删除之前太阳是 sky 管的，这个功能是好的，所以算**删除时丢掉的能力**。
- 同时这也是第二条路：`core/shadows.js` 文件头写着"map size 是原生 three.js（`light.shadow.*`）"，`engine.sky` 上却还留着一个改贴图大小的入口。
- 修法：入口搬到 `engine.shadows`，让它接收一盏光（和 `box / budget / cascades` 同样的形状）；`Photo` 改成遍历场景里投影的平行光，或者让游戏把光交给它。`sky.setShadowMapSize` 和 `sky.shadowMapSize` 删掉。

### 6. `once` 物件没写 id 也没名字时，重建后 id 变了：东西回来了，计数还在（实跑）

- 位置：`packages/engine/modules/gameplay/Interactions.js:122`。
- 怎么坏：默认 id 是 `'interaction' + (++this._seq)`，这个计数器一直往上走，不随新一局或重建归零，也不进存档。文档说的是"按添加顺序"，实际是"按整个页面生命周期里的第几次添加"。而文档主推的例子 `engine.interactions.add(shell, { label: 'Pick up', once: true, counter: 'shells' })` 正好没写 id。
- 实跑：用掉物件、存档、移除、按同样顺序重建、读档。结果 `id: interaction1, id2: interaction2, rebuiltVisible: true, count: 1`。物件又能捡了，再捡一次计数变 2。反过来也有问题：换关之后 `interaction1` 可能是另一个东西，被错误隐藏。这就是代码注释里自己说的"悄悄丢进度"。
- 修法：`once: true` 不写 `id` 又没有 `target.name` 时，开发模式直接报错（规矩里写了公开入口要校验）。比起给序号做存档，这样最简单，也不用猜。同步改 AI.md 和 `add()` 的例子。

### 7. `keyframes` 的 `lightIntensity` 这一列填了也没人读，太阳颜色也拿不到（读代码）

- 位置：`packages/engine/modules/sky/Sky.js:110` 存下 `k[4]`，全 `modules/sky/` 没有任何地方读它。`lightColor`（`k[3]`）只进了穹顶私有的 `u.uSunColor`（`frame.js:68`，`shader.js:46`），不在 `engine.uniforms` 里。
- 怎么坏：`engine.sky.keyframes(rows)` 的文档和例子还要求填这一列，AI 会以为填了就有用。而且用 keyframes 调好一天光色的游戏，读不到当下的太阳颜色，只能在 `look/` 里再抄一份表。这是一半删除：灯不再由 sky 写了，但对应的信号没有放出来，不符合计划第 4 节规则 3。
- 修法：二选一。要么把 `uSunColor`（加一个强度信号）放进 `engine.uniforms`；要么从 keyframes 行里删掉这两列，同时改 `checkKeyframes`、类型和文档。我倾向前者，改动小，也符合"引擎算信号，游戏写灯"。`k[5]` 还在被用（色调压暗、天空盒亮度），要留。

### 8. `sky()` 安装时覆盖游戏已经写在 `engine.lights.sun` 上的值（实跑）

- 位置：`packages/engine/modules/sky/Sky.js:89` 到 `:92`，`modules/sky/shadow.js` 的 `startShadow`。
- 实跑：先写 `sun.shadow.bias = -0.01; sun.castShadow = false`，再 `use(sky())`。结果 `bias: -0.00005, cast: true`，游戏的值被盖掉，没有警告，describe 里也看不出来。贴图大小、影子相机同理。
- 这是占位灯，严重性不算高，但 `engine.lights.sun` 是公开的（`engine.shadows.cascades` 的文档明写"engine.lights.sun too"），这确实是"引擎在背后写值"。
- 修法：这些值在 `render/lights.js` 里已经有一份，把 sky 专用的默认值并进去，或者只在 `sun.parent` 存在且值还等于创建时的默认值时才写。`shadow.js` 文件头关于 far 420 的换算要一起更新。

### 9. `engine-writes` 守卫的范围收窄了（读代码）

- 位置：`packages/engine/tests/specs/engine-writes.mjs:17`。
- 原来查所有外观部件的 game 层，现在只查名字以 `post.` 开头的点。`shadows.enabled`、`sky.tint`、`sky.flash`、`ground.cover` 都不在查的范围内，而这些正是设置菜单和天气会碰的点。文件头规则 1 的本意是"新模块写到 game 层就失败"。
- 修法：去掉 `startsWith('post.')`，查 `engine.stacks.list()` 全部。不知道现在会不会有红，这里只说覆盖面变窄，没有说存在 bug。

---

## 低

- **`uDaylight` 有两个写的人**：`render/daylight.js:32` 和 `modules/sky/frame.js:76`，每帧都写。两边公式相同（`Calendar.js:84`），所以现在没有可见差异；但 sky 一旦换时间来源，一帧之内读到的值就看读的时机了。修法：装了 calendar 时 sky 不写，或者 `frame.js` 只在没有 'daylight' 度量时才写。`uNight` 看着也是两处，实际是两个对象（穹顶私有 / `engine.uniforms`），没问题。
- **背景的警告文字给了错的做法**：`modules/sky/frame.js:19`，`manual` 写的是 `engine.sky.dome.visible = false`。`owned.js` 把它说成"to own it on purpose (no warning)"，但这一行不改 owned 的模式，写完 `scene.background` 照样告警。
- **`saves.register` 没有反注册**：`Interactions.js:89` 在构造函数里注册。`engine.use(mine(), { replaces: 'interactions' })` 之后旧实例的存档部分还留着。这是所有模块的老问题，这次 interactions 新加入这个队伍；另外 `interactions.contract.js` 现在写了 `saves: { interactions: 1 }`，替换模块也要带这个部分才过 contract 检查，要确认这是本意。
- **`noSkip` 的说明过时**：`Interactions.js` 模块声明里还写 `'input and prompt state only'`，现在有存档状态了。
- **旧存档里 `look.*` 的共享点条目静默丢掉**：`look.sky.tint` 改名成 `sky.tint`，`stacks` 部分没有升版本，旧条目进 `_pending` 后不再使用。不崩溃，下一次存档就没了。对外发版前没有存量游戏，可以不做迁移，在 `MIGRATING-0.6.md` 写一句即可。
- **`engine.saves.load` 读没有 `interactions` 部分的旧档**：这个部分保持当前局的状态（`engine.session.load` 没这个问题，缺的部分用新局状态）。这是所有部分的共同行为，不是这次引入的。

---

## 死代码和没删干净的

| 位置 | 情况 |
|---|---|
| `core/owned.js:93`、`:97` 的 `_point` | 找名字是 `look.<part>.<key>` 的共享点，现在没有任何点叫这个名字。永远空转，要删 |
| `core/sharedPoint.js:303` 到 `:311` 的 `yieldToThree / reclaim / yielded`，`core/stacks.js:82` 的 `s.yielded` | 唯一调用方是上面的 `_point`，跟着一起删。删完 `architecture.md` 第 2 节"describe says three (engine yielded)"改成只说 `describe().owned` |
| `core/owned.js:140` `markOwned` | 没有调用方，要删 |
| `core/owned.js` `ownedOf` 的导出 | 只有文件内部用，去掉 export |
| `core/owned.js:61` | 注释还写 `look.<part>.set` |
| `levels.replace`（`owned.js` 的类型） | 没人传，删 |
| `tests/specs/owned.mjs:4` | 头注释还写 `look.<part>.manual(key)` |
| `packages/engine/docs/recipes/54-three-idioms.md:16` | 还在推荐 `engine.look.<part>` |
| `docs/architecture.md:19` | 层表还写 `style`，代码（`sharedPoint.js:33`）已经删了 |
| `docs/architecture.md:64` | 写 `render/terms.js` 是"cloud shadow on plain lit materials"，现在 `terms.js` 文件头明说只作用于引擎材质和交给 `applyEffects` 的材质 |

`levels.set` 还在用（`core/view.js:18`），不是死代码。

---

## 查过、没问题的

- **引擎背后写画面值**：全量搜了灯的强度和颜色、`scene.fog`、`scene.environment`、`toneMapping`、曝光、材质参数。写入都落在下面这些合理位置：引擎自己的灯和材质、灯池自己的灯、`startup.js:188` 换渲染器时抄值、调试视图的临时替换。`sky.environment()` 只在游戏传了 `into` 才写，而且游戏写过就不再盖。`core/Engine.js:143` 的灰背景和 `shadows.js:257` 的默认开影子属于"没画面代码时显示中性灰"，是 P5 的范围。
- **游戏的材质**：`terms.js` 只碰引擎材质和交给 `applyEffects` 的材质；`cascades` 的 csm 补丁是唯一有名字的例外，`describe().owned` 里有一行。
- **core 点名模块**：`core/` 里出现模块名的代码行只有 R27 白名单上的 `skip.js`、`thingExplain.js`，其余都在错误提示文字里。`render/cascades.js` 从 `modules/sky` 搬到 `render/` 是对的，`core/shadows.js` 不依赖模块。
- **`engine.uniforms` 的写入者**：逐个数过，除了上面的 `uDaylight` 都只有一个写的人。
- **`once` 和 `counter` 的存档逻辑本身**：`hud` 不存计数器，差值法不会重复计数；读档和新局时显隐按状态变化切换；`onUse` 返回 `{ ok: false }` 不计；所有使用路径都走 `_run`（全模块只有 `:139` 一处调 `onUse`）；读档失败走全局回滚。问题只在第 6 条的 id。
- **删 `style` 层对旧存档的影响**：`_loadOne` 对未知层回退到 `game`，不会抛错。
- **测试改动里合理的部分**：
  - `session.mjs` 的 `ambient`：`time.ambient` 在冻结时本来就走，理由成立。
  - `owned.mjs` 的 `rows >= 5`：现在实有 6 行，原来的 sun、hemi、fog、exposure、env 都不再是引擎的值。少跑手动接管的两行没有对应入口，也合理。
  - `styletest.mjs`：删的是工作台的测试，工作台本身也删了；`?panel=1` 换成了 `@threedog/tools/panel`。
  - `engine-writes.mjs` 第 2 条（低档时 bloom 由引擎关）换成"引擎不按档位动"，符合规则 9。
  - `leftovers.mjs`、`silent-breaks.mjs` 删的都是被删功能的用例。
- **`look`、`style` 的残留代码**：除上表外，`core / render / modules / ui / types` 里搜 `engine.look`、`engine.style`、`makeMaterial`，只剩报错提示里的"已删除"文字。

## 没查到或没查完的

- **"ao 基线"**：没有找到以 ao 命名的基线文件或数值。测试差异里和 ao 有关的只有 `engine-writes` 去掉的 `hasAo` 分支和一句措辞修改。如果指的是别的东西，要再说一下。
- `one-entry.mjs`（少 14 条 check）、`appearance-env.mjs`（少 15 条）、`lighting-defaults.mjs`（少 13 条）、`look-water-post.mjs`（少 11 条）没有逐条读。看变动方向是随功能删除，但这个没有核实。
- 删除的公开入口只抽查了 `index.js` 的导出（`defineLookPart`、`makeMaterial`、`MATERIAL_PURPOSES`）和 `MIGRATING-0.6.md` 里共享点的部分，没有把 `MIGRATING-0.6.md` 和类型差异逐项对齐。
- 第 2 条的"玩家存了影子关"这个触发路径没有用设置模块实跑，实跑的是 `engine.shadows.enabled = false`，两者走同一个共享点。
- 没有跑全量测试，只跑了临时复现页。

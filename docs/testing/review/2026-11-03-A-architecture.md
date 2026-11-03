# 审查 A：整体架构与 core/（master cb85ad58）

范围：生命周期、共享点和层、插槽、插件文件夹、自动接入普通 three.js（scene.add、灯、材质、后期、自己画画面）、单一时间来源、按键场合、角色控制、模块类型、describe 和报错、存档。只读代码，没改文件。

我跑了什么：`npm run check` 通过；`npm test -- "shared points" "plain three" "plugins folder" "TIME" "module types"` 61 项 413 条检查全过。另外用两段很小的 node 脚本直接调 `core/sharedPoint.js`、`core/stacks.js`，确认了下面第 2、3 条（脚本放在 scratchpad，没进仓库）。

总的判断：这套"底板 + 插槽"的骨架已经立住了。共享点的规则清楚，报错能照抄，插件文件夹每种文件都落到一句现成的调用上，没有另起一套规矩，这部分做得好。主要的问题有三类：
1. 引擎对 three.js 的全局改动比 design.md 说的多，而且有几处不在可查、可关的清单里（直接违反 P2 的说法）。
2. "共享值按层合成"有两个地方规则没守住：玩家设置可以把值往上调；读档之后，旧的句柄撤不掉恢复出来的那一项。
3. 同一件事还有两套写法，或者旧字段没删：管"谁说了算"的机制有四套，模块有三个重叠的分类字段，`time.manual` 没人用却还在，等等。

下面按根因分组，最重要的在前。

---

## 1. 对 three.js 的全局改动比 design.md 说的多，有几处查不到、关不掉（P2）

**是什么**：design.md 的 P2 和第 12 节说"还剩两处全局改动（阴影材质、WebGPU 顶点），可以在状态里看到、可以关掉"。`core/threePatches.js` 的清单里也确实只有这两条（`render/patches.js:489` 的 `shadow-accessors`，`render/fx/patchNodes.tsl.js:98` 的 `node-setup-position`）。但实际改动还有：

| 改了什么 | 在哪 | 影响范围 | 在 threePatches 里吗 |
|---|---|---|---|
| `THREE.Object3D.prototype.add` / `remove` 被包了一层 | `core/sceneDelta.js:31-52` | 整个页面的每一次 add / remove，包括和引擎无关的场景、编辑器、别的库 | 不在 |
| 进入场景的每个有材质的物体，`material` 被改成这个物体自己的取值 / 赋值函数 | `core/sceneDelta.js:70-88` | 场景里的每个 Mesh / Points / Line | 不在 |
| 被打过补丁的材质，`onBeforeCompile` 和 `customProgramCacheKey` 被改成取值 / 赋值函数 | `render/patches.js:186-197` | 自动接入后，所有普通的受光材质都会被打补丁（云影，见 `render/terms.js:163`） | 不在（只在 describe().owned 里有一行 `cloudShadow.plain`） |
| 引擎那个渲染器的 `render` 被换成引擎自己的函数 | `render/ownFrame.js:33-36` | 只这一个渲染器（这一处写得克制） | 不在 |
| 往 `THREE.ShaderChunk` 里加新的代码块 | `render/effects.js:138` | 整个页面（只加新名字，不改 three 原有的） | 不在 |

**为什么要紧**：P2 的承诺是"游戏能看到引擎伸手进 three.js 的每一处，也能关掉"。AI 碰到怪现象（比如在 devtools 里看到 `mesh.material` 是一对取值 / 赋值函数，或者另一个库自己的 `Object3D.add` 补丁和引擎的叠在一起），去查 `describe().threePatches`，看到的只有两条，就会以为没别的了。

**具体场景**：游戏同时用了一个也会包 `Object3D.prototype.add` 的库（有些调试 / 检查工具会这样做）。哪个后装，哪个就在外层。`threePatches.list()` 里看不到 add 这条，AI 查不到冲突从哪来。

**怎么改（在 core 改）**：
- 每一处都用 `notePatch` 登记一条（`scene-add-hook`、`mesh-material-accessor`、`material-compile-accessor`、`renderer-render`、`shader-chunks`），每条写清楚"关掉之后少了什么"（比如关掉 add 钩子，`scene.add` 就不再自动登记）。
- 关不掉的那几条也照样列出来，标明关不掉。
- design.md 的 P2 和第 12 节按真实数字改。
- 另外有个顺手的性能小点：每个网格都多了一个自己的 `material` 取值函数，渲染器每帧每次绘制都要读一次 `material`，大场景里可能拖慢一些。值得在 `threedog stress` 里量一下。如果量出来有代价，可以改成只在需要"材质换了"这个通知的系统开着时才装。

**工作量**：登记和改文档是小；如果要做性能测量和按需安装，算中。

---

## 2. 玩家设置"只能限制"没守住；设置之上的层还能把玩家关掉的东西再打开（P7、第 5 节）

**是什么**：`core/sharedPoint.js:91-93` 只检查"设置层用的是哪种写法"，不检查数值的方向。我实测的结果：
- 设置层写 `mul: 3`，被接受，值从 0.6 变成 1.8；
- 设置层写 `clamp: { min: 5 }`，被接受，值被抬到 5；
- 设置层 `set: false`（玩家关掉画面抖动），之后系统层（过场）`set: true`，结果是 `true`。

层的顺序是 `engine < style < game < effect < settings < system < debug`（`sharedPoint.js:31`），所以过场、菜单、拍照工具写的值排在玩家设置之上，能盖掉玩家的限制。

**为什么要紧**：design.md 第 5 节的原话是"玩家设置封顶（只能限制，不能强开）"。眼下设置层自己就能强开，过场也能盖掉玩家的选择。尤其是为了身体舒适设的选项（关闪光、关抖动、关动态模糊），玩家关了，过场会悄悄打开。

**具体场景**：玩家在设置里关掉"画面抖动"。某个模块的过场用 `ctx.mod('look.post.shake', { set: true, layer: 'system' })`，结果过场里照样抖。

**怎么改**：
- 设置层的 `mul` 只接受 0 到 1 之间的数，`clamp` 只接受 `max`。如果某个值"更小反而更强"（比如雾的远近），由那个共享点自己声明方向（`restricts: 'down' | 'up'`），引擎按声明检查。
- 合成时，设置层写下的限制在所有层算完之后再套一次。也就是"设置封顶"真的是最后一道：system 和 debug 可以挪动值，但出不了玩家给的范围。debug 层要不要例外，需要问主人。

**工作量**：中（一个文件改合成规则，加测试，层的说明也要跟着改）。

---

## 3. 读档之后，旧句柄撤不掉恢复出来的那一项（第 4.4 节"拔掉不留残渣"、P7）

**是什么**：`core/stacks.js:150-158` 的 `_loadOne` 读档时，为每一项新建一个对象放回去。而句柄的 `remove()` 和 `change()` 只认自己当初拿到的那个对象（`sharedPoint.js:107, 116, 152`）。所以读档以后，游戏或模块手里的旧句柄全部"过期"：`remove()` 什么都不做，`change()` 返回 false，也不报错。

**实测**（`Stacks` 和 `Stack` 原样调用）：

```
const h = S.mod('time.world', { owner: 'slow-zone', mul: 0.5 });
S._load(S._save());   // 在减速区里快速读档
h.remove();           // 玩家离开减速区
// time.world 仍然是 0.5，'slow-zone' 这一项还在
```

**为什么要紧**：`engine.saves.load(slot)` 是"在当前这局上读档"，游戏代码和手里的句柄都还在。存档会保存 engine / style / game / effect 这几层的项（外观值有 `save: false`，不受影响；但时间通道、`move.speed` 和游戏自己定义的共享点都受影响）。模块用 `ctx.mod` 写的项也一样：模块卸掉时，记录下来的句柄撤不掉读档恢复的那一项，残渣就留下了。

**具体场景**：子弹时间（不带 `for`）、减速区、泥地减速 `move.speed`，读档后永远撤不掉，游戏一直慢着。describe 里能看到这一项，但 AI 不会想到是读档造成的。

**怎么改（在 stacks 这一层改）**：读档时如果同一个主人、同一个 id 已经有一项，就原地改写那个对象的数值，不新建对象，这样旧句柄仍然有效。或者让句柄改成按"主人 + id"查找（这时 `change()` 也要按同样的方式查）。再加一条守卫测试：读档后 `remove()` 必须生效，模块卸掉后不能留下任何项。

**工作量**：小到中。

---

## 4. "谁说了算"有四套机制，层的名字也是两套（P8、P11）

**是什么**：
- 共享点（`sharedPoint.js`）：7 层，按 set / add / mul / clamp 合成。
- 引擎让出（`owned.js`）：有自己的三种状态 engine / manual / yielded，再通过 `_point()` 去同步共享点。
- 角色控制（`control.js:26`）：另一张层表 `base < script < cutscene < net`，有自己的冲突报错和自己的 describe。
- 按键场合（`inputContext.js`）：又一个栈。

`sharedPoint.js:1-2` 的文件开头还写着"look values, character control and keys move onto it next"，意思是这些以后都会搬到共享点上。外观值和按键已经搬了，角色控制没搬，这句话也没更新。

**为什么要紧**：AI 要回答"为什么不动 / 为什么是这个值"，得分别去查 `describe()` 里的 `shared`、`owned`、`look`、`render`、`holds`、`control`、`input`、`slots` 八个地方（`Describe.js:122-147`）。同一个外观值，`owned` 里有一行 `writer`，`shared` 里又有一行 `writer: 'three (engine yielded)'`，说的是同一件事，却是两个地方。这和 P8 "机制统一，不为每个模块另起一套"有出入。

**可以妥协的地方**：角色控制的语义确实不一样，是"上层暂停下层"，不是"合成出一个数"；按键场合是"遮住下面的"。硬塞进同一种合成规则不划算。

**建议**：
- 名字和查询统一，内部实现可以不同。把控制和按键场合做成共享点的两种新 kind（比如 `kind: 'layered-top'`），层名照用它们自己的，这样 `describe().shared` 一处就能列出所有"谁说了算"。
- 或者至少给 describe 加一个 `who(key)` 查询，一次回答完。
- `owned` 那一行并进 `shared`，不再单列。
- 更新 `sharedPoint.js` 开头那句过时的注释。

**工作量**：先只做统一查询是中；彻底合并是大。不急，可以放到下一版。

---

## 5. 自己画画面的检测会把"叠一层"误当成"整个接管"（P1、P3）

**是什么**：`render/ownFrame.js:33-35`：只要在引擎的画面之外往画布上画了一次（渲染目标为 null），引擎就停掉自己的整帧。哪些算"引擎的画面"：`_render` 里面、`onRender` 的 before / after 回调里面、`renderOnce` 里面（`loop.js:99-107`）。这些不算：`onFrame`、模块的 `afterRender` 钩子（`loop.js:207` 在计数范围之外）、游戏自己的 `requestAnimationFrame`。

**具体场景**：AI 按很常见的 three.js 写法画小地图或界面层：`renderer.autoClear = false; renderer.setScissorTest(true); renderer.render(hudScene, hudCam)`，写在 `onFrame` 里或者自己模块的 `afterRender` 里。下一帧起，引擎不再画主画面，屏幕上只剩小地图。只会出一条 `own-frame` 警告，而警告说的是"你在自己画画面"，AI 很难联想到是小地图那几行造成的。

**怎么改**：
- 只把"盖满整张画布"的那一次画算作接管：开着裁剪（scissor），或视口比画布小，就不算；或者场景不是 `engine.scene` 时也不算。
- 把模块的 `afterRender` 也算进引擎的画面里。
- 警告里写出被认出来的是哪一次画（场景名、相机类型、有没有裁剪），并给出正确的位置：`engine.onRender(fn, { when: 'after' })`。

**工作量**：小。

---

## 6. 自动接入还有几个地方和直接写 three.js 时不一样（P1 的余项）

1. **加在 OutputPass 后面的 Pass 位置不对**。`render/PostFX.js:156-164`：OutputPass 被跳过以后，后面加的 Pass 一律放进 'hdr'，也就是色调映射之前（只有 FXAA / SMAA 放到最后）。three.js 的写法 `bloom → OutputPass → LUTPass(或抖动、暗角)` 里，LUT 本来处理的是已经转成显示色彩的画面，现在被挪到色调映射之前，颜色就错了，而且不报任何错。改法：OutputPass 之后加的 Pass 放进 'ldr' 或 'final'，跳过 OutputPass 的提示里也说清这一点。工作量小。

2. **不想要云影的设置，必须在材质进场景之前写**。`render/terms.js:158-166`：材质一进场景就被打上云影补丁，而且"never taken off again"。AI 先 `scene.add(mesh)`，下一行再 `mat.userData.cloudShadow = false`，不起作用。改法：每帧同步时再检查一次这个标记，把补丁摘掉；或者在 describe 的 `optedOut` 旁边提示"这个标记晚了"。工作量小。

3. **两种渲染方式表现不一样**：普通 three 材质会自动接上云影，WebGPU 的节点材质（`m.isNodeMaterial`）不会（`terms.js:159`）。同一个游戏换成 WebGPU、改用节点材质以后，云影就悄悄没了。要么也给节点材质接上，要么在 describe 里写明"节点材质没有接云影"。工作量中。

4. **用 `scene.add` / `scene.remove` 反复加删的临时物体，登记表只增不减**。`core/things.js:120-133`：每次 add 都在 `byId` 里加一项（id 加 WeakRef）；普通的 `scene.remove` 不会删掉它（只有 `engine.remove` 会 forget），`describeScene` 每次都要遍历全部 id（`thingOps.js:165`）。比如射击游戏一秒加删 10 颗子弹，一小时就是 3.6 万项。改法：在 `onSceneRoot` 旁边加一个"从场景根上移走"的回调，只用于这局临时的物体，移走时 forget。工作量小。

5. **游戏自己的灯，引擎会改 `shadow.autoUpdate`**。`core/gameLights.js:8` 说"The engine never writes them"，但 `:43-44` 会写 `shadow.autoUpdate`。比如游戏在灯亮度为 0 时自己关了 autoUpdate，打算手动只重画一次阴影；等它把亮度调回来，引擎会把 autoUpdate 打开，把游戏的选择盖掉。改法：只在引擎自己关掉的那盏灯上恢复（现在已经用 `idled` 记着了）。另外，如果游戏在暗着的这段时间里自己改过 autoUpdate，就把这盏灯交还给游戏；注释也改准。工作量小。

---

## 7. 同一件事还有两套写法，或者有旧东西没删（P9、P11）

| 什么 | 在哪 | 建议 |
|---|---|---|
| `engine.time.manual(name, fn)`：绕开共享点直接定通道速度，没有主人，第二次调用会悄悄盖掉第一次，`{ owner }` 参数收了也不用 | `core/time.js:130-140` | 除了一个测试，整个仓库没有人用，AI.md 也没写。删掉（文件开头写的就是"Channel speeds change only through engine.mod"）。小 |
| 模块有三个重叠的分类字段：`type`（7 种）、`stage`（其中也有 `world`、`presentation` 两个名字）、`presentation: true`（决定出错时是停用这个模块还是冻结整个游戏） | `core/modules.js:41`、`core/errors.js:18`、`core/moduleTypes.js:45` | 出错怎么处理改成看 `type`（look / ui → 停用），删掉 `presentation` 这个字段；`stage` 只用来排顺序，改掉和 type 撞名的两个阶段名。现在的情况是：游戏写的 look 模块没加 `presentation: true`，一出错就把整个游戏冻住，而 AI 根本不知道有这个字段。中 |
| 已经有了 `engine.phase`，还有一个 `_started` 标记（加载进行到一半就设上） | `core/startup.js:79`，在 `modules.js`、`plugins.js` 里读 | 加载过程里再细分一个阶段（比如 `phase: 'loading'` 时带一个 `loading.stage`），或者把它写进 architecture 第 1 节，说明它和 phase 的关系。小 |
| `look.post.add({ name, create })` 和 `engine.post.addPass(pass)` 两个入口 | slot-map 第四节已经说过要保留 | 可以妥协（前者带参数、开关和设置菜单）。但 AI.md 里应该只写一行"一个 Pass 用 addPass，要带参数、开关的用 look.post.add"，现在分散在两处。小 |
| 灯光模块自己累加一份呈现用的时间 `time += dt` | `modules/lights/index.js:239` | 用 `time.now('ambient')`，它就是为这个设的。小 |
| `MANY = 8` 写了两遍；两套数灯的办法（场景访问器和每次遍历） | `gameLights.js:14`、`lightWatch.js:58` | 合成一个常量；lightWatch 里的计数改用 `_gameLights` 的集合。小 |
| 旧名字的报错陷阱（0.2 的名字，比如 `clock.timeScale`、`describe().ui.inputContexts`、`runState.by`、`result.reason`、`engine.elapsed`） | `validate.js:63` 的 `renamed()`，6 处 | 迁移阶段可以妥协（报错会给出新名字）。建议在迁移说明里写好"0.5 删除"，到时候一起清掉。小 |
| 过时的注释：`sceneMethods.js:3-4` 说"engine.scene.add stays the plain three.js way in, with no registration"，和现在的自动接入正好相反 | `core/sceneMethods.js:3` | 改掉。AI 会照着文件开头的注释理解代码。小 |
| design.md 自己也过时了：P1 写"scene.add 和 engine.add 不一样、后期必须走引擎的链 ❌"，第 13 节写"核心里还暂留 12 个模块名"、"后期链不能整个换" | `docs/design.md` | 见下面逐条核对。R27 的豁免清单里现在只剩 3 个；`look.post.replace([...])` 和自己画画面都能整个接管后期链 |

---

## 8. 模块类型检查只管了 7 种里的 2 种（第 6 节）

`moduleTypes.js:30-40` 只有 4 条规则：look 不能定义操作；look 和 ui 不能写世界记录；ui 不能绑键；ui 不能登记存档。`actor`、`net`、`tool` 三种完全没有检查，`world` 的"不画东西"也没查。design.md 说的"越界开发时报错 ✅"说多了。

另一个小问题：`plugins.js:34` 判断"这是一个模块"要求有 `type`。所以一个没写 type 的模块放进 plugins/ 里，报的是"不是插件"，而不是更有用的"模块缺 type，猜你是 'rules'"。

建议：
- 至少补上 look 模块登记存档、world 模块往场景里加物体（只在开发时提示）这两条。tool 的"做完自己撤回"可以在 tool 结束时检查它留下的项。
- 插件识别时，只要有 `install` 或 `init` 就当成模块交给 `engine.use`，让模块那一层报 type 的错。

工作量：小到中。

---

## 9. 做得对、建议保持的

- 共享点"不记旧值，每次读都从头重算"，几个效果用任意顺序结束都不会出错。冲突报错给出三种可以照抄的改法，同一个主人重写不算冲突。
- 插件文件夹没有新规则，每种形状都落到一句现成调用上；一个文件要么全插上，要么全不插；可以按名字关；画风包走同一条路（P11 ✅ 名副其实）。
- 让出机制（`owned.js`）在发布版里也照样检测，只是警告只在开发时出，所以开发版和发布版行为一致。
- 渲染器的 `render` 只在这一个实例上换，没有改 three 的原型（`ownFrame.js` 的做法是对的，别的地方应该学它）。
- 单一时间来源：只在 `time.js` 里累加，跳过时间和一步一步走在每种时间上结果一致，冻结就是不走固定步，规则清楚，有静态扫描守着。

---

## design.md 逐条核对（我负责的范围）

| 条目 | 文中现状 | 核对结果 |
|---|---|---|
| P1 three.js 永远可以直接写 | 🟡，scene.add / 后期 ❌ | **现状写错了，应改成 🟡 偏 ✅**。scene.add 和 engine.add 已经一样，加 Pass 和自己画画面都能用。**需改进**：第 5 条（叠一层被当成接管）、第 6.1 条（OutputPass 之后的 Pass 位置不对）、第 6.2 条（不想要云影的设置晚了不生效） |
| P2 不遮住 three.js | 🟡，"还剩两处全局改动" | **现状写错了**。实际至少有 5 处没登记（第 1 条）。**需改进**：全部登记进 threePatches，并改文档。"three 没有按物体挂钩的办法"这个理由对 add 钩子成立，可以**妥协**，但必须列出来 |
| P3 不限制发挥 | 🟡，后期链 ❌ | **后期链已经能整个换**（`look.post.replace`、自己画画面），这一项改成 ✅。水、粒子不在我的范围 |
| P4 three 能做的不再做 | 🟡，灯池 ❓ | 灯池保留**可以妥协**（"很多光源、只有几盏真灯"这个取舍引擎猜不到）；普通的灯已经能自动接上 ✅ |
| P7 永远不悄悄出错 | 🟡 | **需改进**：设置层能往上调（第 2 条）；读档后句柄悄悄失效（第 3 条）；`time.manual` 第二次调用悄悄盖掉第一次（第 7 条）；没写 type 的插件模块报错不准（第 8 条） |
| P8 简单 | 🟡，旧写法删干净了没有 ❓ | **需改进**：四套"谁说了算"（第 4 条）；模块三个分类字段（第 7 条） |
| P9 过时的就删 | 🟡 | **没做干净**：`time.manual`、`presentation` 字段、过时的注释、0.2 的旧名字陷阱、design.md 自己 |
| P11 不留两套写法 | ✅ | **说多了**。材质和画风包这两处确实是一条路 ✅；但时间速度（`engine.mod` 和 `time.manual`）、模块分类、"可不可以开始跑"（`phase` 和 `_started`）都还有两套 |
| P10 不臃肿 | ❓ | 我的范围里有两处可疑：每个网格自己的 `material` 取值函数（要量一下）、普通 add 的登记表只增不减（第 6.4 条）。主循环本身克制，钩子不分配内存 ✅ |
| 4.1 核心"本轮全部统一过" | ✅ | 大体 ✅，余项见第 4 条和第 7 条 |
| 4.3 接入分三档 | ✅ | ✅，余项见第 5、6 条 |
| 4.4 插件文件夹、插槽表 | ✅ | ✅（测试全过）；`describe().slots` 也会列出引擎自带的模块，读起来有点吵，可以接受 |
| 4.4 拔掉插件不留残渣 | ✅ | **读档后不成立**（第 3 条），需改进 |
| 5 公共值按层合成、settings 只能限制 | ✅ | **"只能限制"没做到**（第 2 条）；"system 能不能盖掉玩家的选择"需要主人拍板 |
| 5 同层两个主人报错、提示一次 | ✅ | ✅ 属实 |
| 5 角色控制四层、暂停不取消 | ✅ | ✅ 属实；机制是另起的一套（第 4 条），**可以妥协** |
| 5 按键按场合分层、模块不绑键 | ✅ | ✅ 属实（只有 ui 类型会被拦；rules 和 look 模块绑键靠静态规则 R 检查） |
| 5 时间只有一个计数器 | ✅ | ✅ 基本属实；`time.manual` 是绕开共享点的后门，删掉 |
| 6 模块 7 种类型、越界报错 | ✅ | **🟡**：只查了 look / ui 两种的 4 条规则（第 8 条） |
| 6 核心里暂留 12 个模块名 | ❌ | **现状写错了**：R27 豁免只剩 3 个（content、calendar、flow），每个都有理由，改成 🟡 偏 ✅ |
| 10 describe 能说清谁写的 | ✅ | ✅ 能说清，但分散在 8 个地方，`owned` 和 `shared` 有重复（第 4 条），需改进 |
| 10 报错带规则和改法 | ✅ | ✅ 属实，抽查的几处都有 code、规则和能照抄的改法 |
| 12 妥协：两处全局改动 | — | 见 P2：数量不对，理由部分成立 |
| 13 已知没做到：后期链不能整个换、12 个模块名 | — | 这两条已经过时，应该删掉或改写 |

建议的修理顺序：第 3 条（真 bug，小）→ 第 1 条登记和改文档（小）→ 第 5 条和第 6.1 条（小，AI 很容易碰到）→ 第 2 条（中，需要主人先定"system 能不能盖掉设置"）→ 第 7 条清理（小，一次做完）→ 第 4 条和第 8 条（中到大，可以放进下一版）。

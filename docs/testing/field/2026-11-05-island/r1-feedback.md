# FEEDBACK：《海风小岛》R1

写在前面：下面是我实际做的，不是我希望的。用时约 45 分钟、约 95 次工具调用。画面全部是自己写的 three.js + TSL，没用 `celLighting`，没碰 `@threedog/post-effects`。

## 1. 任务清单：真做完了什么，没做什么

做完且跑通过（我用开发桥 `threedog eval` 在无头页面里按步推进，走了一遍完整流程）：
- 约 120 米的风格化海岛：起伏地形（缓坡、小山坡 ~11 米、灯塔岬角、近岸礁石岛、两个小礁柱）、沙滩、草地、土路。
- 蓝天白云（天空球 TSL：渐变、太阳光晕、会飘的云）、清澈海水（按真实水深从青绿渐变到深蓝、岸边呼吸泡沫、天际菲涅尔、波纹法线、太阳闪点）。
- 树（圆冠、高冠、樱花、苹果、棕榈）、灌木、岩石、两万丛草、约 3000 朵花、花田；风吹草动和树叶摆动是 TSL 顶点位移（按高度、每个实例相位、慢阵风）。
- 小木屋、沙滩码头、小木船（带帆）、可到达的灯塔（外侧螺旋楼梯）。
- WASD、鼠标看、Shift 跑、空格跳（引擎自带）。
- 老人 NPC 对话 → 任务“找回风之碎片” → 5 个碎片（山顶、花田、西海滩、老树林、礁石岛）→ 灯塔 → 登顶触发结局。碎片有发光立柱和屏幕箭头指路。
- 小木船：码头上按 E 开往礁石岛，礁石岛上按 E 开回（走固定航线，船会绕过岛）。
- 采摘：花（6 朵花园大花）、苹果（2 棵苹果树各 3 个）、贝壳（6 个，沙滩）、漂浮木箱（码头尽头，会读到瓶中信）。数量显示在左下角，保存在存档里。
- 声音：风、海浪（离岸越近越响）、鸟鸣，都是引擎内置合成声，规则写在 `content/audio.js`。
- 结局：登顶后灯点亮、光束扫过、镜头缓慢环绕，弹出结局窗口（继续探索 / 重新开始）。
- 存档、暂停、标题画面是模板自带的。

没做完 / 不是真的：
- “简单攀爬”只有灯塔那一次：走脚本把人沿楼梯送上去（玩家看得见在爬楼梯，但不是自己操作的攀爬）。没有可抓可爬的墙、梯子、岩壁。可以跳上矮岩石和缓坡，仅此而已。
- 船是脚本航行，不能自己驾驶；船上不能下水游泳（水里是不可走的墙）。
- 没有真人手玩过：没有用键盘鼠标真跑一遍。我只用无头页面里的指令（传送、`interaction.use`、`engine.step`）验证了每一步能走通，手感（跑速、镜头距离、草密度）没调。
- 没在真正的 WebGPU 浏览器里看过。这台机器无头浏览器报 “WebGPU unavailable”，跑的是 WebGL2 后端；画面截图都是这个后端。
- 声音我没有听过，只确认了不报错、规则载入。海浪音量随岸线的测量是我自己写的 `engine.audio.measure('shore')`，没验证听感。
- 没有后期（泛光之类）。没有水中倒影，水面反射只有天空色菲涅尔，岸上物体不会倒映。
- 草和树没有 LOD，靠实例化硬扛；没做性能测量（`threedog perf` 没跑）。
- 如果在乘船途中刷新页面，存档里的位置在海面上；启动时我加了“落在水里就送回出生点”的兜底，但没单独测。

## 2. 卡住的地方（时间、怎么出来的）

1. **`threedog eval` 里游戏不走**（约 5 分钟）：页面是无头模式，时钟只在 `engine.step()` 时前进，任务步骤、`interaction.use` 都靠它。开始我以为是代码错了（任务一直停在第一步）。看了 `describe()` 里 `tick: 0`、`ui.windows: ['title']` 才明白：要先点标题画面的开始键，再 `engine.step(n)`。出路：读 `COMMANDS.md` / `engine.md` 里 `headless` 那一行。
2. **登顶后人又掉回地面**（约 3 分钟）：我在爬完楼梯后立刻 `hold.remove()` 释放了对玩家的控制，玩家被重力拉回地上。是我自己的设计错误，把释放放到结局窗口按钮里就好了。
3. **传送触发 `ops-guard` 警告**（约 2 分钟）：在 `onFrame` 里调 `player.placeAt` 会报“gameplay state changed outside a fixed step or an op”。这个警告很清楚，我改成在下一个 `onFixed` 里放。
4. **`crate` 的 `Object.assign(mesh, { position })`** 报 “Cannot assign to read only property 'position'”（约 2 分钟，页面一启动就崩）。这是 three.js 的行为，引擎还给了一条不相关的提示（见下面“没帮上的报错”）。
5. **bash 的 heredoc 一次吞掉了三个文件**（约 2 分钟）：不是引擎问题，之后全部改用 Write 工具写文件。
6. **改完存档污染测试**：重载页面后点“开始”其实是继续上一次的自动存档，船还停在礁石岛，第一次测船时就看到 “tooFar”/原地不动，以为船坏了（约 4 分钟）。

## 3. 查不到 / 没查到的东西

- `threedog how "third person character"`：给出了第三人称的配方，有用。
- 我没有用 `threedog how` 查“世界里的水”：直接读了 `recipes/63-third-person-start.md` 第 5 节（“水用一块平面就够”），照做。
- 想要：“怎么让玩家被脚本移动一段（上船、爬楼梯）而不被重力拉回”。我是读 `57-control.md` 才知道 `step: () => false` 就是干这个的（“你自己放置了位置”）。`how` 搜 “move player script” 之类我没试，如果没命中，这条该有个直达入口。
- 想要：“headless 页面里怎么点开始、怎么推进时间”。只能从 `COMMANDS.md` 的零散几行拼出来，没有一个“用 eval 做通关测试”的小配方。
- 想要：“有哪些 TSL 节点名可以 import”。我凭记忆用了 `mx_noise_float`、`transformNormalToView`、`instanceIndex`、`cameraPosition`、`length`，都存在；没有查词典，运气成分大。

## 4. 我写错的引擎名字

- `Object.assign(new THREE.Mesh(...), { position: ... })`：three.js 的 `position` 是只读属性，要用 `.position.set()`。（three.js 的坑，不是引擎的。）
- `engine.time.now('real')`：我先想用它，没查到确切签名，改用 `performance.now()`。`api/clock.md` 里搜不到 `now`，`characters.md` 的例子里却出现了。文档不一致。
- 引擎自带的 `toast` 是从 `threedog` 直接导出的函数 `toast(engine, text)`，不是 `engine.ui.toast`。我先搜 `engine.ui.toast` 没有，换成搜 `toast(` 才找到。
- `engine.onFrame(fn)` 返回值我假定有 `.remove()`，写成了 `h?.remove?.()`，没有核实它到底返回什么。

## 5. 有帮助的报错 / 没帮上的

有帮助：
- `[ops-guard] gameplay state changed outside a fixed step or an op: world.move, called at main.js:134:12`：给出了函数名和行号，一眼找到。
- `check` 的“GAMEMAP.md is not up to date, run npm run map”：直接告诉了要跑什么。
- 点评型输出（`shot` 的 Picture 行）：亮度、过曝、阴影阶梯。我没有按它改，但它确认画面没爆。

没帮上：
- `Page errors: TypeError: Cannot assign to read only property 'position' of object '#<Ca>'` 后面引擎附了 `Fix [frozen-definition]: Definitions (content templates, items...) are frozen`。这条提示与问题无关（我没碰内容模板），而且报错栈指向压缩后的 `main-xxxx.js:5679`，对不上源码行。我是靠记得自己刚写了 `Object.assign(…, { position })` 才找到的。建议：报错栈尽量映射回源码；提示别把任意“read only property”都当成 frozen-definition。
- `threedog check` 的类型检查对 TSL 链式写法（`.mul(...)`、`vec3(...)` 混节点类型）误报 “the arguments match none of the forms”，对 `IcosahedronGeometry` “missing required property: parameters”。这是 TypeScript 的限制，页面照常跑，但会让人以为代码错。我加了 `@type {any}` 才让它安静。我先误以为删掉 `// @ts-check` 就能跳过，实际 check 不看这行。

## 6. 为调画面跑了多少次

- 带图的 `shot` 命令：4 次（首帧、码头、改草之后的一次、最终确认）。
- `snap`（对开着的页面截图）：6 次（结局、山上、灯塔、礁石岛、出生点、初始几张）。
- 一共约 10 张图，其中 3 张是为了看画面本身有没有问题（草太高太糙、水面远处颗粒噪点、光柱像玻璃条），其余是看流程。每一轮是改完一批再看，没有一次改一个参数。
- 画面没有走“按参考图调”的路，只按 `DESIGN.md` 里的“喜欢/不要”看。

## 7. 我想改引擎或文档的地方

1. 给一个“用 `threedog eval` 无头通关”的配方：点开始、`engine.step`、`interaction.use`、怎么避开自动存档污染（比如 `?fresh` 或 `eval` 里一个 `newGame()`）。我在这里花的时间最多。
2. `how` 增加“move player by script / ride a boat / climb”这类词的直达，指到 `57-control.md` 的 `step: () => false`。
3. 报错栈映射回源码行，并收紧 `frozen-definition` 的触发条件。
4. 无头环境检测不到 WebGPU 时，`shot` 的输出里提醒一句“这张图是 WebGL2 后端”，不要让人以为是 WebGPU 画面。
5. 文档里 `time.now` 的出现和 `api/clock.md` 不一致，补一处。
6. 水：提供一个“按深度画的水面”的小示例（我是在顶点里烘焙 `wdepth` 再在 TSL 里读，效果很好，但这是自己想出来的）。配方 63 说“水一块平面就够”，但没给能看出清澈浅滩的写法。
7. `interactions.add` 的 `radius` 以对象原点算，船这种大物件要把半径调大才能从码头够到；文档可以点一句。

# Meep 引擎和 threedog 的对比（2026-11-03 调研）

> 只读调研，没有改任何代码。资料来自论坛帖、旧 GitHub 仓库、npm 包信息和 Meep 官网文档，链接附在每一节。
> 有一条最重要的发现先说在前面：**Meep 从 3.0 版（2026 年 8 月）起已经完全不用 three.js 了**，换成了作者自己写的画面引擎 Shade，而且只支持 WebGPU（新一代浏览器显卡接口）。所以它今天已经不是"three.js 上的引擎"，而是一个和 three.js 并列的独立引擎。

---

## 1. Meep 是什么、谁在用、现状

**是什么**：作者 Alex Goldring（论坛名 Usnul）一个人从 2013 年开始写的网页游戏引擎，起因是做塔防游戏时找不到合适的网页 3D 引擎。用它做完了回合制策略游戏 *Might is Right*（上了 Steam），作者说还用在了几个非游戏的商业产品上。

**时间线**

| 时间 | 事件 | 来源 |
|---|---|---|
| 2019-10 | 论坛发帖介绍，当时建在 three.js 上，说是 MIT 开源 | [论坛帖 #1、#7](https://discourse.threejs.org/t/meep-a-game-engine/10098) |
| 2020-05 | 有人问"有没有文档"，作者答：只有一个示例和一大段说明文字 | 同帖 #10–#12 |
| 2023 起 | npm 包改成不开放的授权（UNLICENSED），但仍依赖 three.js | [npm 包信息](https://registry.npmjs.org/@woosh/meep-engine) |
| 2025-12 | GitHub 开源仓库归档（只读），说明"因为没多少人感兴趣/没时间，收回闭源" | [github.com/Usnul/meep](https://github.com/Usnul/meep) |
| 2026-05 | 论坛宣布：引擎还活着，改为商业授权；有人问"哪些项目在用"，作者以授权保密为由不答 | 论坛帖 #13–#15 |
| 2026-08 | 3.0 版：去掉 three.js，换自家 Shade 画面引擎，只支持 WebGPU | [迁移说明](https://meep.company-named.com/docs/reference/migrating-2-to-3/) |
| 2026-10 到 11-02 | 论坛连发进展：显卡上算的风、树木生成器、实时布料、实时全局光照（光在物体间反弹的效果） | 论坛帖 #16–#23 |

**现状（截至 2026-11-03）**
- 最新版 3.61.0（2026-11-02 发布）。npm 上一共发过 1489 个版本，最近经常一天发好几个。上周下载约 1.17 万次（这个数字会被自动化构建刷高，只能看出"有人在装"）。
- **授权**：不是开源，是"源码可看"（npm 包里带全部源码，约 6000 个文件）。总收入和总融资都低于 5 万美元的项目免费商用，超过的按项目一次性付费。见 [授权与价格](https://meep.company-named.com/pricing/)。
- **浏览器**：只支持 WebGPU，没有 WebGL（老一代显卡接口）的退路。实际要求 Chromium 149 以上，Firefox 和 Safari 列为不支持。见 [FAQ](https://meep.company-named.com/docs/faq/)。
- **社区**：没有论坛、没有 Discord，只能发邮件。论坛帖里最近几个月基本是作者自己在发进展，别人的回复只有零星几条。
- **谁在用**：公开能确认的只有作者自己的 *Might is Right*。

---

## 2. 和 threedog 的定位差别

| | Meep | threedog |
|---|---|---|
| 一句话 | 一个人写的"全家桶"引擎，自己画、自己算物理、自己联机，目标是和 Unity 比 | 一块带插槽的底板：AI 用 three.js 写画面，引擎负责让各部分协调、能查问题 |
| 和 three.js 的关系 | 2.x 建在 three.js 上；3.x **完全移除**，自写画面引擎 | three.js 是画笔，永远可以直接写（design.md P1） |
| 主要使用者 | 懂游戏引擎的人类程序员 | AI 编程助手，主人不写代码 |
| 外观 | 自带成品画面：环境光遮蔽（角落变暗）、泛光、自动曝光、抗锯齿默认全开；还有树木生成器 | 不带美术，没给就是中性灰占位（P5） |
| 开放程度 | 闭源商业，源码可看 | 计划 MIT 开源，只开源引擎 |
| 拼的是什么 | 画面上限和性能（官网写 60 帧画 70 万个物体） | AI 第一次就能用对、出错能查、几方改同一个值不打架 |

一句话总结：**Meep 在往"更强的画面引擎"走，threedog 在往"更可靠的协调层"走**。两者解决的是不同的问题，Meep 的很多做法正好是 threedog 原则里明确不做的。

---

## 3. 逐项对比

术语先解释两个：
- **ECS（实体-组件-系统）**：一种组织游戏代码的方式。"实体"只是一个编号，"组件"是挂在编号上的纯数据（位置、速度），"系统"是每帧处理某一类数据的函数。好处是数据集中、好存档、好放到后台线程；坏处是写起来绕，一个简单物体也要拆成好几块。
- **序列化**：把游戏状态变成一串数据存起来（存档），读档时再还原。

### 3.1 功能

| 功能 | Meep | threedog | 备注 |
|---|---|---|---|
| 画面 | 自写 Shade，显卡驱动的剔除（看不见的不画）、延迟着色、上千盏动态灯、全局光照、体积雾 | 原生 three.js，引擎管阴影分级、灯数量、曝光等协调；WebGL 和 WebGPU 都支持 | Meep 上限高；threedog 兼容面广 |
| 地形 | 灰度高度图生成，后台线程建块，只画看得见的块，自带射线查询 | 数据和外观拆开，分块加载、可编辑，外观可整个换 | 思路接近 |
| 寻路 | 网格 A* + 导航网格（navmesh，可走区域的多边形地图）和寻路角色 | `engine.characters.findPath`、`engine.nav` | 相当 |
| 游戏 AI | 行为树、黑板、蒙特卡洛树搜索（一种下棋式的决策算法） | 没有内置 | 按 P4/P6，threedog 不一定要做 |
| 物理 | 自写、可重复（同输入同结果），带角色/载具控制、关节、流体 | 用 Rapier（现成物理库） | Meep 自写，工作量巨大 |
| 粒子 | 软粒子、自动排序、合到一张贴图、曲线控制、拖尾 | `engine.particles`（外观能否整个换待核对） | |
| 贴花（贴在表面上的弹孔、脚印） | 渲染管线内置 | 没有专门模块，three.js 自带的 DecalGeometry 可直接用 | 按 P4 不必做 |
| 远处简化（LOD / 冒充体） | 2.x 有八面体冒充体（远处用一张照片代替模型）；**3.0 把它删了**，还没替代品 | `engine.hlod` | |
| 存档 | 二进制，整个世界存成一块数据；每种组件有版本号，旧档自动找最短升级链 | 按"存档部件"存，读档前先检查和迁移，失败整体回滚 | 详见第 4 节 |
| 联机 | 服务器说了算 + 回滚预测，支持多种传输 | `net()`，还在变 | Meep 更完整 |
| 编辑器 | 有，挂在正在运行的游戏上，按 NumLock 开关 | 下一版做（World IR 编辑器） | 两边都把编辑器当难点 |
| 战争迷雾、小地图 | 内置 | 无 | 属于玩法，归游戏 |

### 3.2 写法：用户怎么写一个游戏

**Meep**（按 [入门页](https://meep.company-named.com/docs/getting-started/) 概括）：
1. `EngineHarness.bootstrap` 启动，回调里登记要用的"系统"（例如负责画模型的系统）。
2. `buildBasics` 一行搭好相机、太阳光、鼠标转视角。
3. 先把盒子形状"切块处理"（`meshlet_geometry_build_from_geometry`，Shade 要求的预处理），建材质，**手动把颜色从 sRGB 转成线性**（不转就会偏亮）。
4. 用 `new Entity().add(形状组件).add(位置组件).build(数据集)` 拼出一个物体。
5. 自己的逻辑写成"系统"类，声明它要哪些组件，在 `update` 里遍历。

**threedog**：`createEngine` 后直接拿 `engine.scene` 用 three.js 加物体、灯、材质；要协调的东西（时间、天气、存档、谁说了算）用 `engine.use(模块)` 装上；共享的值用 `set / mul / add` 写。

对比：画一个盒子，Meep 要懂 ECS、切块、颜色空间三件事；threedog 就是写 three.js。

### 3.3 对 AI 友好程度

| | Meep | threedog |
|---|---|---|
| 给 AI 的入口文档 | 没有。官网文档面向人，FAQ 一字没提 AI | `AI.md` 是任务索引，`threedog how` 按词查 |
| AI 训练时见过的写法 | 3.x 的写法很新，网上几乎没有例子；2.x 的 three.js 写法反而会误导（迁移说明列了十条要改的） | three.js 是 AI 最熟的 3D 库 |
| 出错时 | 开发时有断言（检查条件不满足就报错），发布时剥掉；部分情况只"记一条错误然后跳过" | 报错带编号、写明违反哪条规则、给能照抄的改法（P7） |
| 查状态 | 有编辑器和显卡性能分析 | `engine.describe()` 一次吐出所有值、谁写的、插槽表 |
| 类型提示 | JS + JSDoc 注释，自动生成 TypeScript 类型 | 同样有类型文件 |
| 容易踩的坑 | 颜色忘转线性、场景忘接上导致"黑屏"、存档时没登记的组件被悄悄跳过、硬编码的设置存储名 | 见 design.md 各条 ❓ |

### 3.4 性能和工程

| | Meep | threedog |
|---|---|---|
| 测试 | 官网说约 1.5 万个手写测试；有"软件版 WebGPU"，没有显卡也能测画面代码 | 无头浏览器 + 软件渲染跑像素测试；有性能门槛测试 |
| 内存 | 热点代码不新建对象（减少垃圾回收造成的卡顿），数据放连续数组 | 每帧浪费正在扫尾（P10） |
| 后台线程 | 任务切时间片、带依赖和进度；地形、图片解码在后台线程 | `engine.jobs`、`engine.threads` |
| 包大小/首帧 | 官网写最小约 652 KB（压缩后）+ 6 MB 数据，首帧约 1.8 秒 | 没有公开的同类数字 |
| 版本稳定性 | 一天发好几版；3.0 一次删掉 LOD、光照探针、拖尾等功能 | 0.x 阶段也允许破坏性改动，但写迁移说明 |

---

## 4. 值得借鉴的地方（具体到 threedog 里怎么做）

**① 存档升级"走链"，并且能标记"这一项不存"**
Meep 每种存档数据有版本号，写 0→1、1→2 两步升级，旧档自动串起来走，不用写 0→2；还能把某个字段或整个物体标成"临时的，不存"。（[存档文档](https://meep.company-named.com/docs/platform/persistence/)）
threedog 做法：核对 `core/saves/saveVersions.js` 是否已经支持多步自动串联；没有的话补上，并在 `describe()` 里列出"每个存档部件当前版本、有哪些升级步骤"。另外给一条守卫测试：任何存档部件都必须能"存→读→再存"得到一模一样的数据（Meep 专门测这个）。

**② 编辑器"挂在正在跑的游戏上"，开了就暂停游戏的按键和相机，关了还回去**
Meep 的编辑器是 `enableEditor(engine)` 一行挂上去，打开时停掉游戏自己的输入和相机控制，关掉时恢复。（[架构页](https://meep.company-named.com/docs/reference/architecture/)）
threedog 做法：下一版编辑器正好可以直接用已有的机制：编辑器是一个 `tool` 类型模块，打开时压一层 `editor` 输入场合、用相机共享点接管相机，关掉时自动弹出——不需要另写一套"暂停游戏"的逻辑。**不要学**它把开关键写死成 NumLock（见第 5 节）。

**③ 只算不画的部分能在 Node（不开浏览器）里跑**
Meep 说除了画面以外的部分都能在 Node 里无头运行，用来跑服务器和快速测试。
threedog 做法：`world` 和 `rules` 两类模块按定义本来就"不画东西"，可以加一条检查：它们不许碰 `engine.scene` / 渲染器，这样就能在 Node 里秒级跑玩法测试，也为以后联机的服务器端打底。AI 改完玩法规则，不开浏览器就能先验一遍，省时间也省电脑。

**④ 看不见的动画先停，回到视野时快进到正确位置**
这是 Meep 开源版就有的省性能做法：屏幕外的角色动画不算，回来时按经过的时间直接跳到该到的那一帧，玩家看不出区别。
threedog 做法：放进 `engine.assets.animate`，默认开、可关；时间从唯一时间来源读，所以快进天然和暂停、子弹时间一致。

**⑤ 把"首帧时间"和"包大小"变成公开的数字和门槛**
Meep 官网直接写出最小包多大、多久出第一帧。
threedog 做法：在现有性能门槛测试里加两项——空游戏的首帧时间、只装核心时的打包大小——结果按惯例记进 `docs/testing/runs.md`。这也直接检验 P10"不装的东西没有代价"。

**⑥ 植被常见毛病做成自动检查**
作者在帖子里点名批评一个 three.js 示例的树：叶子悬空、树枝没长在树干上、两层面重叠闪烁（z-fighting）、贴图有问题。（论坛帖 #16）这些正是 AI 做植被最常出的错。
threedog 做法：在 `verify` 或 `describe` 里加"植被体检"：离地面太远的植物、和地面穿插的模型、同一位置重叠的面，列出来给 AI 看。符合"让 AI 看得见查得出"，又不替游戏决定长相。

---

## 5. 不该学的地方和原因

| Meep 的做法 | 为什么 threedog 不学 |
|---|---|
| **甩掉 three.js，自己写画面引擎** | 直接违反 P1（three.js 永远能直接写）。代价看 Meep 自己的迁移说明：用户所有碰过 `THREE.*` 的代码全部失效，颜色要手动转换，场景要手动接线，LOD 等功能直接没了。对 AI 更糟——它最熟的 three.js 写法全部不能用 |
| **只支持 WebGPU、只支持新版 Chrome 系** | Safari（所有 iPhone）和 Firefox 用户打不开。threedog 两种渲染方式都支持，画面一致有测试保证，这是优势 |
| **全面 ECS + 连续数组 + 不新建对象** | 性能好，但写起来绕，一个盒子要拆三块，AI 容易写错。threedog 用"模块 + 存档部件 + 共享点"已经拿到 ECS 的主要好处（好存档、各管各的），不必再换写法（P8 简单） |
| **画面效果默认全开、自带树木生成器** | 违反 P5（不带成品外观），所有游戏会长得像 |
| **写死的东西**：编辑器开关键固定 NumLock 且不能关；编辑器快捷键固定；设置固定存在 `lazykitty.komrade.options` 这个名字下 | 违反 P6（通用）和"按键由游戏绑"的规则 |
| **静默跳过**：存档时没登记的数据只记一条错误就跳过；设置重复挂存储会多一份而不是替换；文档里有一个存关卡的模块"发布的包里导入不了，请自己抄代码" | 违反 P7（永远不悄悄出错）。存档丢数据是最伤玩家的错，threedog 要继续在开发时直接报错 |
| **版本发得极快、大功能说删就删** | 一天几版，3.0 一次删掉一批功能且"没有直接替代"。threedog 0.x 也会破坏，但要守 P9：删旧的同时给迁移说明 |
| **闭源 + 没有社区 + 不公开用户** | 有人问"哪些项目在用"得不到回答，信任难建立。threedog 的开源计划（MIT、英文为主）正好补这一块 |

---

## 6. 论坛里反映的 three.js 做游戏的真实痛点

这些来自 Meep 帖和相关帖，按出现频率排：

1. **文档太少。** 2020 年有人问 Meep 有没有文档，作者承认"只有一个示例和一段文字"；提问者说大量类没有说明，看不懂能干什么。（[Meep 帖 #10–#12](https://discourse.threejs.org/t/meep-a-game-engine/10098)）——对 threedog 的启发：文档就是产品，而且要写给 AI 看。
2. **编辑器是最大短板。** Usnul 在另一个引擎帖里说"编辑器是我引擎最大的弱点"，回头重来会多投入编辑器。（[Rogue Engine 帖 #2](https://discourse.threejs.org/t/new-game-engine-with-three-js/7314)、Meep 帖 #6）——印证 threedog 下一版先做编辑器的决定。
3. **three.js 只是画图库，游戏要的东西都得自己拼。** 物理、存档、场景切换、界面都没有；"选哪个物理库"的帖子从 2018 年开到 2026 年 9 月还有人回。（[物理引擎帖](https://discourse.threejs.org/t/preferred-physics-engine-cannon-js-ammo-js-diy/1565)）也有人说 three.js 是工具箱不是引擎，性能看写的人。（[Shade 帖](https://discourse.threejs.org/t/shade-webgpu-graphics/66969)）
4. **场景一大就慢，高级画面很难加进去。** Usnul 说扩展 three.js 多年后仍觉得它"相当僵硬"，大场景里看不见的东西剔除不掉是"最大的性能杀手之一"，他给的例子是某草地场景在 three.js 里只有约 1.5 帧/秒。（Shade 帖，作者自测，未独立验证）——这是他甩掉 three.js 的原因。threedog 的回应应是：在 three.js 之上把"分块、剔除、阴影预算"这类工程做好，而不是换掉 three.js。
5. **植被和大自然最容易露馅。** 叶子悬空、树枝接不上、面重叠闪烁（Meep 帖 #16）。
6. **怎么组织代码。** 有人质疑 ECS 在 JavaScript 里到底快不快；作者答主要好处是代码解耦、方便存档和多线程，不是速度。还有人问为什么不用 TypeScript。（Meep 帖 #2–#6）
7. **"有谁真的用它做出了游戏"。** 新引擎最常被问的就是这个（Meep 帖 #14）。threedog 将来开源时，最有说服力的是几个能直接打开玩的不同类型 demo。
8. **大厂引擎导出网页太大、手机上卡。** 有人拿这一点论证纯网页引擎的价值（Rogue Engine 帖 #5）；Meep 官网也拿包大小和 Unity 比。

---

## 资料链接

- 论坛帖：https://discourse.threejs.org/t/meep-a-game-engine/10098
- 旧开源仓库（已归档）：https://github.com/Usnul/meep
- npm 包信息：https://registry.npmjs.org/@woosh/meep-engine
- 官网文档：https://meep.company-named.com/docs/getting-started/
- 2→3 迁移说明：https://meep.company-named.com/docs/reference/migrating-2-to-3/
- 架构与理念：https://meep.company-named.com/docs/reference/architecture/
- 存档：https://meep.company-named.com/docs/platform/persistence/
- 插件与设置：https://meep.company-named.com/docs/platform/plugins-options/
- FAQ：https://meep.company-named.com/docs/faq/
- 和 Unity 等对比页：https://meep.company-named.com/compare/
- Shade 画面引擎帖：https://discourse.threejs.org/t/shade-webgpu-graphics/66969
- Rogue Engine 帖（另一个 three.js 编辑器）：https://discourse.threejs.org/t/new-game-engine-with-three-js/7314
- 物理引擎选择帖：https://discourse.threejs.org/t/preferred-physics-engine-cannon-js-ammo-js-diy/1565

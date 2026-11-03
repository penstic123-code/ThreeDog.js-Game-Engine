# 引擎对外接口有多少（AI 看得见的部分）

<!-- api-count total: 1682 -->

0.5 的第一步是先数清楚：一个 AI 用这个引擎做游戏时，能看见、可能会去用的东西一共有多少个，其中哪些在仓库里根本没人用。0.4.0 那次只计数和列候选；之后做了两类不改游戏行为的清理（见"0.5 清理之后"）；第三类（把模块选项里的外观值挪进 `look.*`）主人同意后也做了（见"第三类：外观值只走 look.*"）。

## 怎么数的

- 工具：`threedog api-count`（只在引擎仓库里跑）。默认每组一行；`--unused` 列出没人用的；`--json` 给数据。
- 数据来源是**对外的类型声明**：`packages/engine/index.d.ts`、`types/*.d.ts`（包括从源码注释生成的那部分）、`types/tsl.d.ts`、`@threedog/post-effects` 的 `index.d.ts`。用 TypeScript 自己的类型检查器去读。选它的理由：AI 的编辑器提示和 `npm run types` 看到的就是这份；检查器会把转出口、继承、`ModuleDef<接口>` 都解开，比数文档或跑一个页面数运行时对象更全、更稳（运行时对象要先装好每个模块，生成的 API 文档也是从这份来的）。
- 命令行命令来自 `bin/threedog.mjs` 里的命令表；命令行选项来自每个工具交给统一参数解析器的选项清单；错误代码来自 `core/errorCodes.js`。
- 各组的口径：
  - engine 上的成员：`engine.xxx` 一层；子对象的成员：再往下一层，只算引擎自己的对象（three.js 对象、网页 DOM、模块接口、`look` 不在这里算）。
  - 模块：每个模块的选项（工厂函数的参数）和接口（装上后 `engine.xxx` 上的方法和属性）。四种相机共用一个接口 `engine.cameraRig`，只算一次。
  - 外观：部件按名字数；所有部件的动词名字都一样（类型上每个部件都有全套，不适用的会报错说该用哪个），所以动词按名字只数一次。

## 0.4.0 的数字

| 组 | 个数 | 没人用 |
|---|---:|---:|
| createEngine 选项 | 28 | 3 |
| engine 上的成员 | 152 | 2 |
| engine 子对象的成员 | 448 | 47 |
| 外观部件 look.* | 17 | 1 |
| 外观动词 | 11 | 1 |
| 模块选项 | 268 | 106 |
| 模块方法和属性 | 325 | 60 |
| 从 'threedog' 导出 | 100 | 1 |
| 从 'threedog/tsl' 导出 | 13 | 0 |
| 从 '@threedog/post-effects' 导出 | 9 | 0 |
| 命令行命令 | 54 | 22 |
| 命令行选项 | 124 | （不查） |
| 错误代码 | 170 | 0 |
| **合计** | **1719** | **243** |

（命令和合计里已包含这次新加的 `api-count` 本身。代码在 0.4.0 发布那一版上数的。）

## 0.5 清理之后（未发布）

做了两类不改游戏运行行为的清理，都只动类型声明（游戏的自动补全和 `npm run types` 看到的那份），运行时一样：

- 删掉明显的垃圾：`look.clouds`（cloudShadow 的旧名字，运行时 0.3 起就没有了，只剩类型里一行）；`'threedog'` 类型里漏出来的 three.js `Light`；`engine.terrain`、角色（`engine.player`、NPC）、`engine.cameraRig`、`engine.control`、`engine.views` 上回指 engine 的 `.engine`（引擎自己的代码还在用，运行时保留）。
- 藏起只给引擎自己或测试用的东西：`engine.audio.info`、`engine.ambience.info`（调试读数，只有测试在读）、`engine.level.buildMs`（只给调试面板）。配方和 AI.md 教过的一个没动。
- 迁移说明写进 `packages/engine/docs/MIGRATING-0.5.md` 的 "Names taken out of the type declarations"（0.5 的迁移页已经有了，同一个版本的升级步骤放一处）；CHANGELOG 的 Unreleased 加了一行。运行时没有任何名字消失，所以不需要新的报错：`look.clouds` 在运行时本来就是 `undefined`，其余的照常能读。

| | 合计 | 候选（没人用） | 留 |
|---|---:|---:|---:|
| 0.4.0 | 1719 | 243 | — |
| 清理之后 | 1711 | 115 | 119 |
| 外观值挪进 look.* 之后 | 1680 | 103 | 118 |
| 水面材质只留 look.water.replace 之后 | 1680 | 103 | 118 |

合计少了 9 个清掉的（`cameraRig.engine` 原来就没被计数，所以 10 处只少 9 个），又多了 1 个：同期合并进来的别的改动加了一个命令行选项。候选从 243 降到 115：9 个清掉了，另外 119 个标成"留"单独报。

### 留

这三类没人用也留下，`threedog api-count` 把它们单独算成 `kept`，不再算候选（规则在 `packages/tools/api-count.mjs` 的 `keptWhy`）：

- **命令行命令**（22 个）：AI 在终端里用，本来就不会写进代码。
- **错误代码**：游戏出错时读的就是它们（目前全部都有引擎代码在抛，所以这一类是 0）。
- **有默认值的调参选项**（createEngine 的 3 个、模块选项 94 个）：相机手感、物理、联机、背包上限这类。仓库里没有游戏去调，不等于游戏不需要；删了就只能改引擎源码。（提案里那 12 个外观参数后来按第三类挪进了 `look.*`，不再是选项。）

### 第三类：外观值只走 look.*（主人已同意，已做）

按下面的提案做了，"一个值只有一个入口"：

- `water()` 只留 `sea`、`level`、`flat`、`size`、`segments`、`material`、`uniforms`。`color`、`opacity`、`waveHeight`、`waveScale`、`waveSpeed`、`fresnel`、`depthColor`、`foam` 原来就是 `look.water` 参数，选项删掉；`normalMap`、`normalScale`、`normalRepeat`、`normalSpeed`、`shininess`、`specular` 新加成 `look.water` 参数（`normalMap` 换图时重建一次材质，`normalRepeat` 重排一次网格的贴图坐标，其余直接改材质或 uniform）。`material` 后来也删了（主人定的"一件事一个入口"）：它和 `look.water.replace` 是同一个槽，自带水面材质只走 `look.water.replace(fn)`（画风里写 `style.water.material`），`water({ material })` 开发时报错并给出这句写法。`uniforms` 留着：它不只给自带材质用，主要是声明 `look.water.patch('wave' | 'surface')` 那两段 GLSL 读的 uniform（比如湖心坐标、风力），内置材质上就要用；换了材质时它也照样出现在 `replace` 函数拿到的 `{ uniforms }` 里。
- `sky()` 只留 `time`、`fog`、`sun`、`hemisphere`，外加 `shadow`、`environment` 两块（它们带"低档设备另给默认值"的规矩，`look.shadow` / `look.env` 现在不管这层，挪过去要先定低档规矩怎么走，留给下一步）。`moonSize`、`orbitTilt`、`orbitSway`、`starScale`、`dim`、`gradientCurve`，连同同性质的 `keyframes`、`sunSize`、`sunGlow`、`sunBrightness`、`moonColor`、`moonBrightness`、`starDensity`、`groundTint`，都成了 `look.sky` 参数（`dim` 拆成 `dim.tint`、`dim.stars`，写法还是 `set({ dim: { stars: false } })`）。`skybox` 选项删掉（`look.sky.replace`），`clouds`、`backdrop`、`layers` 选项也删掉（本来就有 `look.sky.set` / `patch('layer:<名字>')`）。
- `terrain({ normals })` 挪成 `look.ground` 的 `normals`：代码里它只有地形外观那一半读，只改光照、不改高度和碰撞，和 `shading` 一样由工作线程烘进地块，所以是外观。`photo.shadowMapSize` 按提案留着。
- 风格包照旧一处设：`style.water.*`、`style.sky.*`、`style.terrain.config.normals` 就是这些参数的 style 层（describe 里显示 `style`）。
- 删掉的选项在开发时一调用就报错，给出新写法，比如 `water({ color }) moved: engine.look.water.set({ color }) ...`。不做兼容层（主人定的）。迁移说明在 `MIGRATING-0.5.md` 的 "Look values left the module options"，CHANGELOG 的 Unreleased 一条。守它的测试：`one entry per look value`（`look-water-post.mjs`）。

数字：合计 1711 → 1680，少 31（删掉的模块选项；模块选项当时 235 个）；之后同期合并的别的改动多了 1 个（1681），再删 `water({ material })` 回到 1680（模块选项 234 个）；外观参数按部件数、参数本身不计数，所以新加的 `look.*` 参数不加总数。候选 115 → 103：提案里那 12 个外观选项不在了。

### 提案原文（已按上面做完，留作记录）

判断方法：一个值只改画面、不改玩法和结构，而且已经有对应的 `look.*` 部件，它就该归 `look.*`，用 `look.xxx.set()` 调，能按 owner 叠加、能看 `describe` 谁在改；模块选项只留"装不装、建什么、多大"这种结构决定。

**水面 `water()`**：

- 已经是 `look.water` 参数、选项里重复了一份的：`color`、`opacity`、`waveHeight`、`waveScale`、`waveSpeed`、`fresnel`、`depthColor`、`foam`。建议从 `water()` 选项删掉，只走 `look.water.set()` 和 style.water（候选里的 `waveScale`、`waveSpeed` 就是这一组）。
- 还不是 `look.water` 参数的外观值：`normalMap`、`normalScale`、`normalRepeat`、`normalSpeed`、`shininess`、`specular`。建议加成 `look.water` 的参数（改 uniform 即可，`normalMap` 换贴图），再从选项里拿掉。
- 留在 `water()` 的结构选项：`sea`、`level`、`flat`、`size`、`segments`（网格多密，改了要重建，不是外观调参）、`material`、`uniforms`（自带材质是 `look.water.replace` 的事，可以顺带讨论）。

**天空 `sky()`**（`sky()` 的选项就是 style.sky 的全部键）：

- 该挪进 `look.sky` 的：`moonSize`、`orbitTilt`、`orbitSway`、`starScale`、`dim`、`gradientCurve`（以及没进候选、但同性质的星星密度、渐变关键帧等 style.sky 外观键），变成 `look.sky.set({ moonSize, ... })` 的参数。
- `skybox`：已经有 `look.sky.replace(全景图名)`，选项是重复写法，建议删。
- 留在 `sky()` 的：`fog`（要不要雾）、`time`（没有日历时固定几点）、`sun`、`hemisphere`（天空管不管这两盏灯）。它们的说明里本来就写着是"游戏怎么点亮世界"的结构决定，不是外观。

**别的模块里看着像外观、建议主人顺带看一眼的**：`terrain.normals`（平滑/硬边着色，已经说"style 可以设"，可能该归 `look.ground`）、`photo.shadowMapSize`（拍照时的画质，属于拍照功能的调参，倾向留）。

**确定留作调参的**：地形和植被的分块大小、碰撞和刚体的各项物理值、四种相机的手感项、NPC 分层、对话打字速度、背包和拾取的上限、任务检查间隔、关卡碰撞生成方式、导航网格大小、联机同步频率和回调、音乐压低淡出时间、HUD 任务标记开关。这些改的是玩法手感或性能，和外观无关，不挪。

挪的时候按"替换了就删旧的"：旧选项直接报错并指向 `look.xxx.set(...)`，MIGRATING 和 CHANGELOG 各一条。

## "有人用"是怎么判断的

- 算作"用的人"：引擎自己的源码（core、modules、render、ui、两个附加包）、`examples/`、新游戏模板（`packages/tools/templates/`）、配方里的代码块。`presets.js` 只算作选项的使用者。测试和文档正文**不算**。
- 按名字找：方法和属性找 `父名.名字`（比如 `quests.isDone`）；名字在全部接口里独一无二时，写成 `.名字` 也算。选项找 `名字:`，只在示例、模板、配方代码块、presets 里找（引擎源码里有选项的定义，会误判成"有人用"）。错误代码：引擎源码里写到这个代码就算（很多是先放进变量再抛的）。命令：模板（含它的 CLAUDE.md）或配方代码块里出现 `threedog 命令` / `npm run 命令`。
- 这是按名字的粗筛，会有两种错：常见名字（`set`、`add`、`list`）被别的东西"借用"而算成有人用；通过别名变量调用（`const q = engine.quests; q.isDone()`）而算成没人用。所以下面是**候选**，每个都要人看一眼。
- 命令行选项没有逐个查：只看选项名字说明不了是哪个命令的，查出来的结果不可信，所以只计数。

## 看完候选的大致印象

- 真正该删的很少：`look.clouds` 是 `cloudShadow` 的旧名字，留着违反"替换了就删旧的"。
- `'threedog'` 导出里冒出一个 three.js 的 `Light` 类，是类型文件顺带导出的，运行时并没有。这是声明的毛病，不算接口。
- 模块选项的 106 个大多是有默认值的调参项（相机手感、物理、联机）。仓库里没有对应的游戏去调，不等于游戏不需要；可以考虑的是把外观参数（水面、天空）挪进 `look.*`，而不是删。
- 命令行那 22 个都该留：它们是 AI 在终端里用的，本来就不会出现在代码里。
- 几个 `xxx.engine`（回指 engine 的引用）可以从类型里拿掉，游戏用不到。
- 查询类（`isDone`、`list`、`get`、`stats`）没人用，多半是示例太少，不是接口多余。

## 防止悄悄变多

测试 `api count`（`packages/tools/tests/api-count.mjs`）每次打印当前各组的数，并和本页第二行记的合计比较：多出超过 30 个就失败，提示更新这一页（写新数字和为什么变多）。变少不会失败，删了东西后把记录调低即可。所以接口变多一定是有意的决定。

跑法：`npm test -- "api count"`；只看数：`threedog api-count`。

## 没人用的候选清单（0.4.0）

这是 0.4.0 那次的快照，没有逐行改。之后的变化：上面"0.5 清理之后"清掉的 9 个已经不在了；模块选项、createEngine 选项（外观参数那 12 个除外）、命令行命令现在算"留"。当前候选以 `threedog api-count --unused` 为准。

### 从 'threedog' 导出的函数和常量（1 个）

| 名字 | 是什么 | 声明在 | 可能还值得留的理由 |
|---|---|---|---|
| `Light` | Abstract base class for lights - all other light types inherit the | ../../../node_modules/@types/three/src/lights/Light.d.ts | three.js 的 Light 类经类型文件顺带导出了，引擎运行时并不导出它。是类型声明漏出来的，修声明即可，不算 API |

### createEngine 选项（3 个）

| 名字 | 是什么 | 声明在 | 可能还值得留的理由 |
|---|---|---|---|
| `pixelRatio` | Render resolution, default min(device pixel ratio, 1.5); | types/core.d.ts | 固定画质时要用（配方 15 的正文教了，只是代码块里没写） |
| `targetFps` | Target frame rate for automatic resolution lowering, default 55 | types/core.d.ts | 自动降分辨率的目标帧率，配方 15 正文教了 |
| `decoders` | Directory of Draco/KTX2 decoders (a URL containing draco/ and basis/), for when they live on a CDN. | types/core.d.ts | 解码器放在 CDN 上时必须用，示例都用默认位置所以没写 |

### 模块选项（106 个）

| 名字 | 是什么 | 声明在 | 可能还值得留的理由 |
|---|---|---|---|
| `terrain.chunkSize` | Chunk edge length (meters), default 64 | types/world.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `terrain.heightmap` | Heightmap (used when there is no height function): | types/world.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `terrain.normals` | Texture shading only: | types/world.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `terrain.boundsPad` | Chunk bounding sphere margin in meters (default { up: | types/world.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `vegetation.chunkSize` | Chunk edge (meters), default 32 | types/world.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `collision.canopyHeight` | A camera above this height (meters) is not considered blocked by trees, default 5 | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `collision.cameraPad` | Margin between the camera and obstacles (meters), default 0.5 | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `collision.cameraMin` | Nearest camera distance (meters), default 1.5 | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `collision.walkableWaterMargin` | Height above the water surface (meters) at which it counts as walkable, default 0.2 | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `collision.cameraOcclusion` | What camera occlusion checks: | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `rigid.terrainRing` | How many rings of chunks around the player get terrain colliders, default 1 | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `rigid.buoyancy` | Whether there is buoyancy, default true | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `rigid.buoyancyForce` | Buoyancy strength (1 = just floats), default 1.6 | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `rigid.waterDrag` | Drag in water, default 2.5 | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `rigid.floatLine` | Buoyancy "waterline": | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `rigid.floatDepth` | Buoyancy reaches its maximum this many meters further down, default 0.8 | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `rigid.treeColliderHeight` | Height (meters) of vegetation collision pillars (tree trunks), default 6 | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `rigid.treeRadius` | Trunks get collision cylinders only in chunks within this many meters of the player or a moving rigid body (the rest are | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `rigid.playerCapsule` | Player capsule size (meters), default computed from engine.movement radius / height | types/physics.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `followCamera.smoothing` | Follow smoothing, default 10 | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `followCamera.sensitivity` | Drag sensitivity, default 1 | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `followCamera.zoomStep` | Zoom ratio per wheel notch, default 0.1 | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `followCamera.invertY` | Invert vertical | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `followCamera.lockPitch` | Lock the pitch angle (top-down games) | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `followCamera.swallowLockClick` | The press that locks the mouse is not delivered as Mouse0 / a click (default true); | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `followCamera.mouseLook` | false: | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `followCamera.hideLayer` | Layer used to hide the followed object (0-31), default 30 | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `firstPersonCamera.sensitivity` | Mouse sensitivity, default 1 | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `firstPersonCamera.headBob` | Walking bob amplitude (meters), 0 off, default 0.04 | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `firstPersonCamera.bobFrequency` | Bobs per meter | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `firstPersonCamera.hideTarget` | Hide the character itself (its shadow remains), default true | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `firstPersonCamera.hideLayer` | Layer number used for hiding 0–31 | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `firstPersonCamera.swallowLockClick` | The press that locks the mouse is not delivered as Mouse0 / a click (default true); | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `firstPersonCamera.yawLimits` | Turn range left / right [min, max] (radians), unlimited by default | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `firstPersonCamera.smoothing` | Smoothing of the camera following the body | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `firstPersonCamera.invertY` | Invert vertical | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `fixedCamera.autoInterval` | Check interval for automatic switching (seconds) | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `fixedCamera.hysteresis` | How many meters closer a new shot must be to switch (prevents flipping back and forth) | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `fixedCamera.triggerBlend` | Transition seconds for trigger-zone switches (0 = hard cut) | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `fixedCamera.trackHeight` | How high above the character a track shot looks (meters) | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `fixedCamera.trackSmoothing` | Head-follow smoothing | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `fixedCamera.holdDirection` | Keep the direction when switching shots until the direction key is released | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `rtsCamera.panSpeed` | Pan speed multiplier | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `rtsCamera.dragPan` | Drag with the mouse to pan, default true | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `rtsCamera.edgePan` | Pan at the screen edge, default false | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `rtsCamera.edgeSize` | Edge width (fraction of the screen) | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `rtsCamera.rotateSpeed` | Rotation speed (radians/second) | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `rtsCamera.zoomStep` | Zoom ratio per wheel notch | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `rtsCamera.smoothing` | Smoothing | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `rtsCamera.followLock` | Manual panning is not allowed while following | types/physics.d.ts | 相机手感调参，有默认值；不同玩法会调不同的几项，删了就只能改引擎源码 |
| `characters.npcTiers` | Near tiers for large NPC crowds, off by default (every near NPC walks every fixed step); | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `interactions.promptHeight` | How high the prompt floats (meters) | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `dialogue.charsPerSecond` | Typing speed (characters/second, game time: | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `dialogue.advanceActions` | Actions that advance the dialogue, default ['confirm'] (a basic key); | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `inventory.pauseGame` | true: | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `inventory.maxWeight` | Weight limit of the player inventory, default Infinity | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `inventory.defaultStack` | Default stack limit, default 99 | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `pickups.showDistance` | Pickups have a model, float and spin only within this distance (meters) of the stream sources, default 60 | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `pickups.takers` | Who walks into auto pickups (actor ids); | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `quests.checkInterval` | Check interval (game seconds, checked in the fixed step; | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `photo.maxAlbum` | How many photos the album keeps at most, default 50 | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `photo.shadowMapSize` | Shadow resolution (pixels), default 4096 | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `level.walkable` | Decide yourself which meshes are walkable | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `level.colliders` | 'named' only col_ meshes block the player \| 'auto' every tall mesh that is not walkable blocks \| false | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `level.colliderPad` | Expand the collision box outward by this much (meters) | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `level.colliderHeight` | Minimum height of the collision box (meters) | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `level.sharpEdge` | Treat it as a step edge when the height difference between adjacent grid points exceeds this (meters), default 0.6 | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `level.hideMarkers` | Hide the marker placeholder meshes, default true | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `level.addToScene` | Add the scene to engine.scene, default true | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `settings.storageKey` | Browser storage key | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `settings.freezeWorld` | Pause gameplay while the menu is open (with flow installed it switches to flow's 'paused' and returns to the previous st | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `nav.tileSize` | Tile size (in cells), default 32 | types/nav.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `nav.crowd` | NPCs use Recast crowd avoidance, default false | types/nav.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `nav.maxObstacles` | Most TileCache obstacles (collision boxes are cut into several), default 1024 | types/nav.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `nav.maxAgents` | Most crowd agents (with crowd: | types/nav.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `sky.moonSize` | Larger means a smaller moon | types/style.d.ts | 外观参数；也许该挪到 look.sky 里统一调（是搬家，不是删） |
| `sky.orbitTilt` | North-south tilt of the sun path | types/style.d.ts | 外观参数；也许该挪到 look.sky 里统一调（是搬家，不是删） |
| `sky.orbitSway` | East-west swing of the sun path | types/style.d.ts | 外观参数；也许该挪到 look.sky 里统一调（是搬家，不是删） |
| `sky.starScale` | Star grid resolution (cells per unit of view direction), default 260: | types/style.d.ts | 外观参数；也许该挪到 look.sky 里统一调（是搬家，不是删） |
| `sky.dim` | What the sky dims for every game unless the style says no (each default true; | types/style.d.ts | 外观参数；也许该挪到 look.sky 里统一调（是搬家，不是删） |
| `sky.gradientCurve` | Gradient curve from horizon to zenith, default 0.55 (color = mix(horizon, zenith, elevation^curve), mixed in linear ligh | types/style.d.ts | 外观参数；也许该挪到 look.sky 里统一调（是搬家，不是删） |
| `sky.skybox` | Panorama (equirectangular) replacing the gradient sky, asset name or path | types/style.d.ts | 外观参数；也许该挪到 look.sky 里统一调（是搬家，不是删） |
| `calendar.hoursPerDay` | Hours per day of the displayed clock and of clock notation ('18:30'), default 24 | types/world.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `water.waveScale` | （类型里没写说明） | types/world.d.ts | 外观参数；也许该挪到 look.water 里统一调（是搬家，不是删） |
| `water.waveSpeed` | （类型里没写说明） | types/world.d.ts | 外观参数；也许该挪到 look.water 里统一调（是搬家，不是删） |
| `water.segments` | （类型里没写说明） | types/world.d.ts | 外观参数；也许该挪到 look.water 里统一调（是搬家，不是删） |
| `water.normalScale` | （类型里没写说明） | types/world.d.ts | 外观参数；也许该挪到 look.water 里统一调（是搬家，不是删） |
| `water.normalRepeat` | （类型里没写说明） | types/world.d.ts | 外观参数；也许该挪到 look.water 里统一调（是搬家，不是删） |
| `water.normalSpeed` | （类型里没写说明） | types/world.d.ts | 外观参数；也许该挪到 look.water 里统一调（是搬家，不是删） |
| `world.farMaxPerTick` | （类型里没写说明） | types/generated/modules/world/index.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `world.buildPerFrame` | （类型里没写说明） | types/generated/modules/world/index.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `net.sync` | （类型里没写说明） | types/generated/modules/net/index.d.ts | 联机选项；仓库里没有联机的示例或模板，真用的人只在联机游戏里 |
| `net.syncEvery` | （类型里没写说明） | types/generated/modules/net/index.d.ts | 联机选项；仓库里没有联机的示例或模板，真用的人只在联机游戏里 |
| `net.keepAlive` | （类型里没写说明） | types/generated/modules/net/index.d.ts | 联机选项；仓库里没有联机的示例或模板，真用的人只在联机游戏里 |
| `net.burst` | （类型里没写说明） | types/generated/modules/net/index.d.ts | 联机选项；仓库里没有联机的示例或模板，真用的人只在联机游戏里 |
| `net.maxSpeed` | （类型里没写说明） | types/generated/modules/net/index.d.ts | 联机选项；仓库里没有联机的示例或模板，真用的人只在联机游戏里 |
| `net.posEvery` | （类型里没写说明） | types/generated/modules/net/index.d.ts | 联机选项；仓库里没有联机的示例或模板，真用的人只在联机游戏里 |
| `net.actorFor` | （类型里没写说明） | types/generated/modules/net/index.d.ts | 联机选项；仓库里没有联机的示例或模板，真用的人只在联机游戏里 |
| `net.actorFields` | （类型里没写说明） | types/generated/modules/net/index.d.ts | 联机选项；仓库里没有联机的示例或模板，真用的人只在联机游戏里 |
| `net.avatarFields` | （类型里没写说明） | types/generated/modules/net/index.d.ts | 联机选项；仓库里没有联机的示例或模板，真用的人只在联机游戏里 |
| `net.interpolate` | （类型里没写说明） | types/generated/modules/net/index.d.ts | 联机选项；仓库里没有联机的示例或模板，真用的人只在联机游戏里 |
| `net.avatar` | （类型里没写说明） | types/generated/modules/net/index.d.ts | 联机选项；仓库里没有联机的示例或模板，真用的人只在联机游戏里 |
| `net.onJoin` | （类型里没写说明） | types/generated/modules/net/index.d.ts | 联机选项；仓库里没有联机的示例或模板，真用的人只在联机游戏里 |
| `net.onLeave` | （类型里没写说明） | types/generated/modules/net/index.d.ts | 联机选项；仓库里没有联机的示例或模板，真用的人只在联机游戏里 |
| `music.duckFade` | Fade seconds for the ducking | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |
| `hud.questMarkers` | Show a marker automatically when the current quest step has a target, default true | types/gameplay.d.ts | 调参项，有默认值；没人改不等于不需要，删了游戏就只能改引擎源码 |

### 模块方法和属性（60 个）

| 名字 | 是什么 | 声明在 | 可能还值得留的理由 |
|---|---|---|---|
| `terrain.engine` | （类型里没写说明） | types/world.d.ts | 回指 engine 的引用，游戏用不到；可以从类型里拿掉（不是删功能） |
| `terrain.rebuild` | Rebuild all chunks | types/world.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `vegetation.rebuild` | Place every chunk again: | types/world.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `vegetation.get` | （类型里没写说明） | types/world.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `vegetation.list` | （类型里没写说明） | types/world.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `vegetation.isRemoved` | （类型里没写说明） | types/world.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `collision.addObject` | Add a collider from an object's bounding box, pad expands outward (meters). | types/physics.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `rigid.gravity` | （类型里没写说明） | types/physics.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `rigid.stats` | Statistics | types/physics.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `interactions.action` | （类型里没写说明） | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `interactions.radius` | Default reach of add() in meters (2.5) | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `interactions.current` | The interaction the prompt shows right now (null if none) | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `interactions.get` | The interaction with this id, or null. | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `dialogue.speaking` | The script the main dialogue is playing | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `inventory.defs` | Item definitions | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `inventory.list` | Player inventory entries (for custom UI) | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `inventory.get` | One player inventory entry by key, or null | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `pickups.radius` | Reach of pickups that do not set their own (meters) | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `quests.defs` | （类型里没写说明） | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `quests.state` | One quest's progress (a copy): | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `quests.isDone` | （类型里没写说明） | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `quests.isActive` | Started, not done and not failed | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `quests.isFailed` | Its fail condition held (start(id) begins it again) | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `quests.check` | Check completion conditions once immediately | types/gameplay.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `photo.scale` | （类型里没写说明） | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `photo.shadowMapSize` | （类型里没写说明） | types/gameplay.d.ts | 和同名选项重复（一个是选项，一个是可改的属性），可以只留一个 |
| `level.object` | Same as root (the name consistent with player.object and ent.object) | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `level.buildMs` | Milliseconds spent building the heightfield | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `level.markersWith` | Get all markers whose names start with prefix, e.g. | types/gameplay.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `triggers.list` | All trigger zones (a new array) | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `triggers.action` | （类型里没写说明） | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `triggers.clear` | Delete all (delete a single one with trigger.remove()) | types/gameplay.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `triggers.byTag` | Find by tag | types/gameplay.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `settings.values` | All current setting values | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `settings.isOpen` | Whether the menu is open | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `settings.close` | （类型里没写说明） | types/gameplay.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `settings.rebind` | Change the first key of an action to code | types/gameplay.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `settings.save` | Save to the browser | types/gameplay.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `nav.agent` | Character size actually in effect (from engine.movement, or the override in nav()) | types/nav.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `content.ready` | All vegetation models are fetched and the models of world data such as nearby props are built (world.ready) | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `content.markers` | Markers added by the marker effect: | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `content.run` | Run an effect (object, array or function (e, { actor })); | types/gameplay.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `calendar.daysPerSeason` | Days per season for seasons given by name only | types/generated/modules/calendar/Calendar.d.ts | 季节只给名字时的每季天数，读它的是游戏自己的日历界面 |
| `water.bodies` | Water body → mesh | types/generated/modules/water/Water.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `net.actor` | This machine's actor id on the host: | types/generated/modules/net/Net.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `net.pending` | Client: | types/generated/modules/net/Net.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `net.stats` | Message counters: | types/generated/modules/net/Net.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `grids.list` | All grids (a new array) | types/generated/modules/grid/index.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `ambience.position` | Where the sounds are heard from: | types/generated/modules/ambience/Ambience.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `ambience.rules` | Replace the whole rule table (null or [] = silence) | types/generated/modules/ambience/Ambience.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `ambience.info` | What each rule is doing (debug, tests): | types/generated/modules/ambience/Ambience.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `particles.has` | Whether this effect has been defined | types/generated/modules/particles/Particles.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `particles.clear` | Clear one effect's (or all) particles | types/generated/modules/particles/Particles.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `music.current` | Name of the track playing (or wanted) | types/generated/modules/music/Music.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `music.ready` | Whether audio is usable | types/generated/modules/music/Music.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `music.pick` | Which track the current rules would pick (without switching) | types/generated/modules/music/Music.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `timeline.playing` | Whether a cutscene is playing | types/generated/modules/timeline/Timeline.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `lightPool.lights` | The real three.js lights, created once at install and never added, removed or hidden (the pool sets their position, colo | types/world.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `lightPool.focus` | Distance is measured from this object / position; | types/world.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `hud.markers` | All markers | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |

### engine 子对象的成员（47 个）

| 名字 | 是什么 | 声明在 | 可能还值得留的理由 |
|---|---|---|---|
| `player.engine` | （类型里没写说明） | types/gameplay.d.ts | 回指 engine 的引用，游戏用不到；可以从类型里拿掉（不是删功能） |
| `player.radius` | （类型里没写说明） | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `player.water` | （类型里没写说明） | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `player.gravity` | （类型里没写说明） | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `player.channel` | Time channel the engine drives it on (see CharacterOptions.channel) | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `player.addJumps` | Give back n jumps for this airtime (pickup, wall touch) | types/gameplay.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `player.resetJumps` | All jumps back, as if it had landed | types/gameplay.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `player.support` | What it stands on, read-only (reused object); | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `player.ready` | false while a model named by asset is loading (the placeholder body shows); | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `player.whenReady` | Settles (never rejects) when a model named by asset is swapped in or has failed; | types/gameplay.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `player.dispose` | Fully delete this character: | types/gameplay.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `player.groundType` | Ground type underfoot ('water' while swimming) | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `events.historySize` | How many history entries to keep, default 200; | types/generated/core/Events.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `saves.ready` | Has the save index been read into memory? (start() waits for it; | types/generated/core/Saves.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `input.contexts` | Names of the active contexts, bottom to top (pending switches apply at the next fixed step) | types/generated/core/Input.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `audio.info` | What is playing (for describe and tests): | types/generated/core/Audio.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `assets.release` | Release a resource and return GPU memory. | types/core.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `post.list` | Effects in render order: | types/generated/render/PostFX.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `cpuPhases.render` | （类型里没写说明） | types/core.d.ts | 诊断数据，AI 查性能或状态时读；describe / perf 可能已给了同样的数，可查重复 |
| `cameraOverride.focus` | Optional: | types/core.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `runState.state` | （类型里没写说明） | types/core.d.ts | 诊断数据，AI 查性能或状态时读；describe / perf 可能已给了同样的数，可查重复 |
| `runState.owners` | （类型里没写说明） | types/core.d.ts | 诊断数据，AI 查性能或状态时读；describe / perf 可能已给了同样的数，可查重复 |
| `control.engine` | （类型里没写说明） | types/generated/core/control.d.ts | 回指 engine 的引用，游戏用不到；可以从类型里拿掉（不是删功能） |
| `budget.enabled` | Is it on? | types/generated/core/Budget.d.ts | 诊断数据，AI 查性能或状态时读；describe / perf 可能已给了同样的数，可查重复 |
| `budget.disable` | Turn off | types/generated/core/Budget.d.ts | 诊断数据，AI 查性能或状态时读；describe / perf 可能已给了同样的数，可查重复 |
| `budget.values` | Current value per category (fps/low1/cpuMs exist only once there are frame times) | types/generated/core/Budget.d.ts | 诊断数据，AI 查性能或状态时读；describe / perf 可能已给了同样的数，可查重复 |
| `plugins.on` | Plug a switched-off plugin again | types/core.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `plugins.list` | In plug order | types/core.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `threads.shared` | True when SharedArrayBuffer can be shared with workers (page is cross-origin isolated) | types/generated/core/Threads.d.ts | 诊断数据，AI 查性能或状态时读；describe / perf 可能已给了同样的数，可查重复 |
| `ops.historySize` | History entries kept (ring, default 256); | types/generated/core/Ops.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `views.engine` | （类型里没写说明） | types/generated/core/Views.d.ts | 回指 engine 的引用，游戏用不到；可以从类型里拿掉（不是删功能） |
| `views.current` | （类型里没写说明） | types/generated/core/Views.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `views.has` | （类型里没写说明） | types/generated/core/Views.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `views.release` | Give the camera back (to the previous holder, e.g. | types/generated/core/Views.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `random.state` | （类型里没写说明） | types/generated/core/Random.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `stream.radius` | Build radius in meters around each full-detail stream source (a source radius caps it); | types/generated/core/Stream.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `batching.root` | Parent of every batch InstancedMesh (in the scene) | types/generated/core/Batching.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |
| `batching.refresh` | Re-check one object now (after you changed its parts by hand, or set userData.batch on a root already in the scene); | types/generated/core/Batching.d.ts | 操作类方法，示例没用到；看它是不是另一个方法的重复写法再决定 |
| `startup.startMs` | （类型里没写说明） | types/core.d.ts | 诊断数据，AI 查性能或状态时读；describe / perf 可能已给了同样的数，可查重复 |
| `startup.preloadMs` | （类型里没写说明） | types/core.d.ts | 诊断数据，AI 查性能或状态时读；describe / perf 可能已给了同样的数，可查重复 |
| `startup.streamMs` | （类型里没写说明） | types/core.d.ts | 诊断数据，AI 查性能或状态时读；describe / perf 可能已给了同样的数，可查重复 |
| `startup.modules` | （类型里没写说明） | types/core.d.ts | 诊断数据，AI 查性能或状态时读；describe / perf 可能已给了同样的数，可查重复 |
| `terrainLook.material` | The ground material every chunk draws with | types/world.d.ts | 外观模块内部的网格/材质，给想直接用 three.js 改的人；按"three.js 永远可写"原则该留 |
| `terrainLook.meshes` | chunk record -> { group, mesh, colorTex, colorMat } | types/world.d.ts | 外观模块内部的网格/材质，给想直接用 three.js 改的人；按"three.js 永远可写"原则该留 |
| `vegetationLook.meshes` | chunk record -> { group, ims: | types/world.d.ts | 外观模块内部的网格/材质，给想直接用 three.js 改的人；按"three.js 永远可写"原则该留 |
| `weatherLook.particles` | Default particle count per system (halved on low-tier devices) | types/generated/modules/weather/weatherLook.d.ts | 外观模块内部的网格/材质，给想直接用 three.js 改的人；按"three.js 永远可写"原则该留 |
| `npcs.character` | The current character model of an NPC, null if none | types/gameplay.d.ts | 查询类（读状态），游戏自己做界面或判断时用；仓库里的示例没用到 |

### engine 上的成员（2 个）

| 名字 | 是什么 | 声明在 | 可能还值得留的理由 |
|---|---|---|---|
| `slope` | Slope at (x, z); | types/core.d.ts | 地面坡度查询，放东西、做角色动作时会用到；仓库里的示例碰巧没用 |
| `stateApplied` | Scenario is ready: | types/core.d.ts | 场景脚本（scenario）就绪的标志，测试工具在用；可以考虑不对游戏公开 |

### 外观部件 look.*（1 个）

| 名字 | 是什么 | 声明在 | 可能还值得留的理由 |
|---|---|---|---|
| `clouds` | Old name of cloudShadow (recipes/52-look.md, Old names) | types/core.d.ts | 是 cloudShadow 的旧名字。按"替换了就删旧的"，这是最该删的一个 |

### 外观动词（1 个）

| 名字 | 是什么 | 声明在 | 可能还值得留的理由 |
|---|---|---|---|
| `id` | 'look.<part>': | types/core.d.ts | 每个部件的名字（catalog 和 debug.override 用），游戏代码不读；它是只读字段，删了反而别的工具要改 |

### 命令行命令（22 个）

| 名字 | 是什么 | 声明在 | 可能还值得留的理由 |
|---|---|---|---|
| `stress` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `capture` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `init` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `tune` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `relay` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `mcp` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `api-count` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `eval` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `errors` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `resume` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `skip` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `ops` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `scenario` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `session` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `inspect` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `scene` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `explain` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `loading` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `pick` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `play` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `status` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |
| `verify` | （类型里没写说明） | packages/tools/bin/threedog.mjs | AI 在终端里用，命令只写在 COMMANDS.md / AI.md 正文里，代码里本来就不会出现；这一组只说明模板和配方代码块没教它，基本都该留 |


## 0.5 接口冻结（2026-11-04）

用户定：0.5 从这里起冻结接口，只修严重问题。冻结时 `threedog api-count` 合计 **1681**（没人用的候选 103，有意保留 118）。比上一条记录多 1 个：插件组合加了 `look.materials.rebuild()`。

## 0.5 验收后批准的新增（2026-11-04）

用户批准修 0.5 验收的五条发现，新接口压到最少：合计 1681 → **1682**（没人用的候选 103，有意保留 118）。多的 1 个是 `shot --play`（CLI 选项：越过标题画面直接截游戏里）。另两处不进总数：碰撞体的 `occluder: false`（`addCircle` / `addBox` / `addSegment` / `addObject` 共用的同一个选项；选项对象里的键不计数）和引擎的 `?play` 网址参数（即 `applyState({ play })`；场景参数的键不计数）。

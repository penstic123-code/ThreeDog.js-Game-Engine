# 测试运行记录

全量测试的命令是 `npm test`（在仓库根目录跑，跑全部工作区，也包括工具自己的测试）。下面的表越新越靠上，新的一行加在表的最上面。

**2026-11-04 第一次真 WebGPU（分支 test/real-webgpu，系统 Chrome 156，NVIDIA Blackwell，三的后端是 webgpu）**：用 `packages/tools/real-webgpu.mjs` 跑了 19 个 WebGPU 用例页，加模板新游戏、picture-parts、webgpu-tsl、开放世界、city；画面都对，只有 detailBump 和 WebGL 差 3.5%（高频法线的细差，方向相关 0.98，肉眼看不出，留作已知差异）；修了 L3（目标有父级时级联方向错）和 picture-parts 页不认 renderer=webgpu；`npm run check` 通过，相关用例全过。截图在 `docs/testing/field/2026-11-04-real-webgpu/`。

## 2026-11-04：高级光照和体积效果可行性试验（分支 spike/light-volume）

**做了什么**：在带窗房间加约 200 物体街道的测试场景上，逐项跑 three.js 0.187 的全局光照、烘焙、光照贴图、遮挡剔除、体积效果，三种渲染方式，RTX 5060 独显和 Radeon 780M 核显都量了，也在真引擎上接了一遍。结果和路线见 `docs/plans/2026-11-04-light-and-volume.md`，对照图在 `docs/testing/field/2026-11-04-light-spike/`。没跑测试套件，引擎代码没改。
## 2026-11-04：架构审查 A 的修复（分支 fix/review-architecture）

**跑了什么（只跑相关项，没有全量）**：`npm run check` 通过；`npm test -- owned / shadow / cascade / sky / interact / vegetation / 植被 / tsl / photo / contact / "look check" / "shared points" / 引擎写入 / "picture value" / example / technique` 全过。第 1、2、4、6 条的新测试先红后绿；新守卫 `the engine writes no picture value` 用临时写 hemi 的改动确认过会红。

## 2026-11-04：示例改造前后画面对照（分支 fix/example-pictures）
## 2026-11-04：画面值是谁写的、同帧冲突、截图检查新事实（分支 tools/picture-writers）

**做了什么**：开发服务器下记录灯、雾、色调、环境、背景、材质颜色的最后写入行，同帧两处写同一值报一次；`threedog shot` 新增自写着色器不接雾或色调、运行中灯布局变化、透明物体绘制顺序三类事实；菜谱 62 加接线规矩。

**跑了什么（只跑相关项，没有全量）**：`npm run map`，`npm run check` 通过；`npm test -- "picture writers" "look facts" "look hints"` 全过。每条守卫反向验证过一次：临时改坏 13 处（比较关掉、同函数例外去掉、three 帧不跳过、每次写都取栈、帧边界去掉、重复警告、追踪关掉、自己的雾不再"不确定"、判定恒为 follows、覆盖判断只用一张空图、换序不量、按包围盒代替像素、灯变化不记），对应守卫都变红，随后恢复。

**帧时间（world 例子，开发服务器，GPU 无头，3 轮，每轮 240 帧，开 / 关）**：绘制帧中位 3.4–3.6 / 3.4–3.5 ms，均值 4.58–4.60 / 4.64–4.71 ms；不绘制的逻辑帧均值 0.37 / 0.32–0.38 ms，差别在噪声内。480 帧取 152 次调用栈（每帧 0.3 次）。plain-look 例子：绘制帧均值 2.16–2.41 / 1.46–2.19 ms，约多 0.2 ms，480 帧取 92 次。两个例子都没有报冲突。正式包：构建后搜不到追踪代码（用字面量 `import.meta.env?.DEV` 判断，打包时整段去掉，JS 少约 6 KB）。

**这次发现并修掉的**：`docs` 里一行 AI.md 写成 `explain({ picture })` 会让 `threedog how` 的一条长句查询判成"没匹配"（这条测试在分支基线是过的），换了写法。


**做了什么**：用 `threedog shot` 在 master（8301190f）和改造后分支上同参数拍 12 个例子，人眼对比，修了变差的 7 个例子的 look/。对照图和逐例结论见 `docs/testing/field/2026-11-04-examples/README.md`。

**跑了什么（只跑相关项，没有全量）**：`npm run map`，`npm run check` 通过；`npm test -- technique "modular building" 风格测试页 "Action example" cascade` 205/205 通过。

## 2026-11-04：阶段 C 最后一段，合入模块、删外观框架（分支 visuals/stage-c4-end）

**做了什么**：合入 visuals/stage-c-modules；`core/look/`、`engine.look`、`describe().look`、`catalog('look.*')`、`debug.override('look.*')`、`engine.style` 删除；R35 两类都是错误。

**跑了什么（只跑相关项，没有全量）**：`npm run check` 通过。look 345/345、describe 308/308、catalog 27/27、debug 92/92、owned 75/75、sky 225/225（修前 224）、post 172/172、webgpu 291/291、world 514/514。

**查出来的**：引擎 WebGPU 测试页开着泛光时"两种渲染差 23% 像素"不是泛光的差别：只发生在 WebGPU 的第一帧，这一帧经后期链画出的只有平的背景色、没有网格；第二帧起差异 0%（超过 24 级）、0.01%（超过 2 级）。泛光两边的链一致（5 级 mip、半浮点目标、同样的阈值和核）。测试页恢复开着泛光，先走一帧再比。第一帧的问题还在，没修。

**门槛**：没有改数值门槛。

## 2026-11-04：阶段 C 收尾，合入示例 look/（分支 visuals/stage-c3-final）

**跑了什么（只跑相关项，没跑全量）**：`npm run check` 通过；`npm test --` technique 87/87、look 321/321、world 514/514、cascade 60/60、contact 19/19、引擎写入 11/11、styletest 9/9、webgpu 291/291、night 80/80、rc2d 11/11、post 185/185、owned 75/75、how 17/17、tune write 13/13。反向验证两次：去掉 uNight 的写入、把太阳改回固定偏移，对应检查都变红，改回全绿。Session 那条在 stage-c-core 上就时好时坏，原因是页面一直在跑真实帧，ambient 时间多走一点就过了四舍五入的线，已和 tick 一样不参与比较。

## 2026-11-04：阶段 C 模块部分（分支 visuals/stage-c-modules）

**做了什么**：模块的外观改成模块上的普通 three.js 材质和统一值；`style` 选项、画风包、`makeMaterial`、材质角色表删除；工具、规则、开发面板跟着改。

**跑了什么（只跑相关项，没有全量）**：合并 signals-in（示例都在 look/）后 `npm run check` 通过。删除相关的一组 198 项 1595 个检查全过（材质、补丁、插件、外观、烘焙、地形、水、天气、植被、粒子、角色、开发面板、Session）；示例页 33 项 368 个全过；`how:` 17/17。

**查出来的**：`how:` 2 个检查不是旧问题（master 17/17），是缩短 AI.md 行时丢了搜索词，已把词放回，两条期望改到新入口。`Session` 的 3 比 3.1 是 ambient 时间在冻结时照走（设计如此），只在和别的页面同跑时出现，单独跑通过，已列入不比较的值。

**没跑**：全量测试，由协调者合并后跑。没有改任何数值门槛。

## 2026-11-04：美术资源面板 threedog art board（分支 tools/art-board）

**做了什么**：一个游戏的所有美术资源放在一页：模型、贴图、声音、字体、材质、着色器、素材库条目，每项有预览、文件、大小、用在哪一行，能复制给 AI。页面外壳和 `lib page` 共用；`?panel=1` 多一个 art 文件夹，列出运行中的游戏实际加载了什么，`--live` 把这份名单并进页面。

**跑了什么（只跑相关项）**：`npm test -- "art board"` 34 个检查全过，`npm test -- "lib:"` 29 个全过，`npm run check` 通过。反向验证一次：去掉"运行时名字算查不到"那一行，5 个检查变红，改回全绿。实测 island 游戏（只读，输出在外面）：31 项，全部在用，截图 `docs/testing/field/2026-11-04-art-board.png`；中文浏览器里点过复制、勾选、写备注、筛选，页面无报错。`--live` 和 art 文件夹在 island 的临时副本上跑过（服务器按进程号停掉，副本已删）。

**实测抓到的两个假结论（已修，已进测试）**：同一行声明又使用的材质被判成"没用到"；游戏自己写的 `sfx()` 被当成引擎的，6 个声音被判成"缺失"。

**没验证到**：island 全是代码生成的美术，真实贴图和声音文件只在小样例上跑过，没在真实游戏上看过缩略图；`--live` 在 island 上只认出 1 张贴图，227 个材质都没有名字，只能计数。island 打开 `?panel=1` 时面板在 `engine.sky.environment` 处报错（游戏没有天空模块，这是面板原有的问题），art 文件夹放在最前面所以还在，后面的文件夹出不来。
## 2026-11-04：所有示例的画面搬进 look/（分支 visuals/examples-look）

**做了什么**：action、rc2d、sheepisland、styletest、world、webgpu-tsl 和 techniques 下 11 个示例都改成 `look/` 文件夹，写原生 three.js，一个示例一个提交。旧的 world 风格和人形留作测试夹具（`tests/fixtures/world-style`），风格层删掉时一起删。

**跑了什么（只跑相关项）**：`npm run map`、`npm run check` 通过。示例相关的 129 项 965 个检查，961 过 4 失败；其中 3 项修好后单独重跑全过（角色身体是资源、风格边界、procedural-surface）。

**还红的**：`packages/tools/tests/examples-pull.mjs` 第 24 行把相对导入当成相对文件夹根目录算，文件放进 `look/` 就报"留下了导入"。这是工具测试的毛病，这个分支不碰 tools，留给工具那边改。一项（新游戏回到标题再开）只在和别的页面同跑时失败，单独跑通过。

## 2026-11-04：模板里放"现成的几行"（分支 template/visible-entries）

**做了什么**：盲评里 AI 读完模板就认定引擎很重、全部手写。模板 `main.js` 加了一段全是注释的现成代码（第三人称玩家和相机、会说话的 NPC、对着网格按 E、带箭头的任务、计数器、自己几何体和位置的植被），空白模板仍然什么都不跑；写明这些省的是代码、不限制画面，以及存档和菜单那几行为什么在、删了要自己写。模板 CLAUDE.md 的"Already here"加了对话、交互、任务、植被四行（仍在 6.5 KB 内）。菜谱 63 加第 4 节（对话、按 E、任务、计数器）和第 5 节"小游戏不值得用"（水、整块地形、固定时间的天空、刚体载具）。菜谱 05 加 2e 节（自己几何体和位置的植被）；AI.md 植被一行指过去，其他行缩短，仍在字节预算内。

**跑了什么（只跑相关项）**：空白新游戏 `threedog test -w` 6 个检查全过；一个临时游戏把模板里的几行全部取消注释，加一个只跑一次的检查（对话选择后旗标为真、任务进到第二步、植被物种存在），6 个检查全过；另一个临时游戏放进菜谱 63 第 4 节和菜谱 05 2e 节的代码，6 个检查全过；两个临时游戏都已删除；`npm run check` 通过。没跑全量。

**没验证到**：真的按 E 触发交互（只调用了对话开始和选择）；任务检查是每半个游戏秒一次，测试里改为手动 `quests.check()`，用 `engine.step(1)` 有一次没推进（时间累计不够，不是代码错）。
## 2026-11-04：少手写的三件事（分支 engine/less-handwork）

**做了什么**：《海风小岛》盲测里 AI 自己写了对话框、按 E 提示、拾取、HUD 和 `?spot=` 开局。`style.ui` 现在能给所有默认界面换皮（之前 HUD 不跟主色走）；`interactions.add(mesh, { once, counter })` 让现成的模型直接成为"捡一个、计一个"的东西，结果存进存档；`?at=<地点>` 跳过开始画面，站到内容里的地点，相机当场就位。

**跑了什么（只跑相关项）**：`npm run map`、`npm run check` 通过；"UI skin" 9 个检查、"interactions once" 加 "contract" 共 172 个检查、"URL at" 7 个检查全过；"interaction""界面件""UI title""pickup"共 328 个检查全过；`threedog shot world --at river` 实跑通过，玩家站在河边、相机跟到位。三条守卫都反向验证过：改回旧行为后各自变红。没有跑全量。
## 2026-11-04：阶段 B，引擎不再在背后写画面（分支 visuals/stage-b）

**做了什么**：天空只算信号、画穹顶；占位灯静止；默认没有色调曲线、环境贴图和雾；云影按需加；天气改写信号；`look.*` 标记弃用。

**跑了什么（只跑相关项，没跑全量）**：`npm run check` 通过。按名字跑，每个词最后一次的结果（名字有重叠，不能相加）：sky 221、fog 172、light 377、weather 158、look 413、environment 37、owned 80、parity 41、adoption 53、tone 64、exposure 15、describe 302、render 256、cold 27、backend 53、cloud 167、terrain 132、stream 48、hint 119、style 314、shot 133，全过；day 61 个 3 个失败，technique 87 个 10 个失败，shadow 287 个 4 个失败。

**失败（都是已知问题，等示例改成 `look/`）**：三个示例测试，失败的检查都在这三项里。day-night-grade（3 个：靠天空写灯和曝光关键帧）、contact-shadows（4 个：比例是按天空的灯和 AgX 调的）、outlines-and-rim（3 个：明暗阈值是按 AgX 调的）。这三个示例的画面确实变了，改示例是下一步，没有改测试的门槛来掩盖。

**守护测试**：`tests/specs/sky-writes-nothing.mjs` 做过反向验证：往 `modules/sky/frame.js` 放回一句每帧写半球光，测试失败；已恢复。像素基准文件没有改动。

## 2026-11-04：新游戏模板先走引擎这条路（分支 visuals/template-engine-first）

**做了什么**：三个限时测试里 AI 把"画面是纯 three.js"读成"引擎只是个空壳"，存档、暂停、菜单全部自己写。现在模板的 `main.js` 接好开始画面、自动存档、Esc 暂停和设置菜单，删一行就能不要；模板 CLAUDE.md 第一节是"Already here"对照表；新菜谱 63 是 16 行的第三人称起步；规则 R40 对手写的 localStorage 存档和手写暂停给提示（不是报错）。空白模板不带玩家、相机架和地面。鼠标锁定时浏览器会吃掉 Esc，现在玩家解除锁定算按了一次 Esc。

**跑了什么（只跑相关项）**：`new-game` 空白和 `--open-world` 各一个，`threedog test -w` 各 6 个检查全过；"template engine first"和"bypass hints"共 61 个检查全过；"pointer lock: Esc" 4 个检查全过；菜谱 63 的代码逐行放进临时游戏，用无头浏览器走了开始、走路、Esc 暂停、再按 Esc 继续、刷新、继续，位置和分数都回来了，没有页面错误；`npm run check` 通过。没跑全量。

**没验证到**：真实浏览器里按 Esc 解除鼠标锁定。无头浏览器的按键会送到页面，所以测试是模拟"锁定结束"这个事件。另外实测页面关闭时才发起的存档活不过刷新，所以刷新最多丢上一次存档之后的进度。

## 2026-11-04 凌晨：画面新方案第 1 阶段 + 第 2 阶段里不改变现有画面的部分

**做了什么**（分支 visuals/signals-in，方案见 `docs/plans/2026-11-04-visuals-signals-in.md`）：新示例 `plain-look`，一条平涂插画风的夜街，整个画面用原生 three.js 写在一个文件里，引擎只给信号。截图检查的探测渲染不再运行游戏的 `onRender`；引擎的灯不在场景里时，主光和补光报的是游戏自己的灯；`lights: false` 连房间环境贴图也关；天气信号 `uRain`、`uSnow` 进了 `engine.uniforms`；`describe()` 关于色调映射的几处说法一致；新菜谱 62。

**全量测试（dc2d4b20）**：673 项 4726 个检查，失败 3 个，用了 14 分钟。其中 2 个是今晚引入的，已修好，单独重跑全过：`Assets.js` 的注释写了 `import.meta.env` 的字样，被 R45 守卫拦下；play 测试没想到本机 5173 端口上有另一个项目的开发服务器，新提示把这种情况说得更准了，测试改成两种原因都认。剩下 1 个是河岸地形测试，单独重跑通过，属于负载敏感。新增的守护测试都做过反向验证：拿掉修复，测试就失败。
## 2026-11-04：道具碰撞半径（分支 fix/prop-collision，9068e604）

**修了什么**：`collide: 'circle'` 的半径和圆心改为量模型的底部（地面以上最低五分之一高度内的几何），不再取整个模型最宽处；模板和道具可以写 `collide: { circle: 0.25, occluder: false }`；写错的 `collide` 加载时报错。

**跑了什么**：`npm run map`、`npm run check` 通过。相关测试（道具碰撞、模板、内容、道具、相机遮挡、explain）51 项 353 个检查全过，44 秒；没有跑全量。新测试 `Prop collision` 反向验证：把 settle 换回包围盒的量法，14 个检查失败 7 个，恢复后全过。
## 2026-11-04：地图过期的修复（分支 fix/map-stale）

**修了什么**：试玩时 GAMEMAP.md 一改内容就过期，`npm run check` 要手动 `threedog map` 才过。选了"开发模式里更新"：开发服务器启动时和改了游戏文件（内容、代码、html）后去抖重新生成，生成器和手跑的是同一个。没选"check 里重新生成"，因为 check 是"已提交的地图是最新"的关卡，先重写再比较就永远通过，过期提交抓不到；现在 check 仍只比较，过期的提交仍由它抓住（`gamemap --check`）。

**跑了什么**：`npm run check` 通过。新测试 `dev server refreshes GAMEMAP`（packages/tools/tests/map-dev-refresh.mjs）5 项检查全过；去掉监听后 2 项失败，恢复后全过。没有在真实浏览器里跑开发服务器。
## 2026-11-04：describe 误报"没有开发服务器"（分支 fix/describe-hint）

**没复现**：照报告的情形试了两次——正常开着的开发服务器上跑 `threedog describe`，和关掉无头浏览器后在 12 个满载进程下冷启动再跑——都正常出结果，没有出现"no dev server"。所以没有认定根因。读代码发现唯一能对着活着的服务器说"没有开发服务器"的路径：桥的探测请求 1.5 秒内没回（服务器正忙着编译，或无头页面占满 CPU），被当成服务器已死。

**改了什么**：这种情况（记录里的进程还活着、端口没在时限内应答）现在如实说"开发服务器在运行（pid、端口），但没及时应答，多半在忙，稍等重试，别再起一个"；`threedog play` 也不再在它上面再起第二个服务器。"服务器在、没有页面"本来就不是错误：桥会自己开无头页面。

**跑了什么**：`npm run check` 通过。新测试 `busy dev server`（packages/tools/tests/diagnose-busy.mjs）1 项检查过；去掉修复后失败（仍报"No dev server is running"），恢复后过。这个新说法是否就是报告里那次的原因，没有证据。
## 2026-11-04：辉光和色阶顺序的文档（分支 docs/grade-bloom-order）

**写了什么**：packages/engine/docs/recipes/52-look.md 的后期部分加一条：辉光（柔和的渐变）后面再跑"只留几档颜色"的步骤，渐变会被切成一块块平台，中间几档就是灰色圆盘；写了原因、三种顺序、怎么用 `threedog shot` 判断，例子跨像素风、平涂霓虹、赛璐璐，不含具体数值规则。

**验证**：用一维模型（亮光源、模糊、四档量化）算了两种顺序：辉光后量化出现平台，量化后辉光是平滑渐变。**没有在真实渲染里验证**（引擎自带的效果里没有色阶效果，要现写一个 pass），文档里也写明了。

**跑了什么**：`npm run check` 通过；只改了文档，没有新逻辑，没有新测试。

## 2026-11-04：验收工具修复（A0，分支 fix/acceptance-tools）

**修了什么**：`shot --view` 切镜头时灯池立刻到位，不再拍到变暗的画面；`shot <url>` 拒绝别的文件夹的开发服务器，说不清时给提示；`run` 多传参数时报错；拍完后场景还在变时警告；全黑帧提示带上编译失败的着色器；新增 NaN 被泛光扩散成全黑的守护测试。

**跑了什么**：`npm run check` 通过。全量 `npm test`：674 项 4725 个检查，失败 1 个，14.4 分钟。这一个是 `named camera views`：测试手搭的假引擎没有 `events`，而 `views.show` 现在要发 `camera:shot`。给测试换上真的事件总线，并加了一条检查；去掉事件时这条检查失败，恢复后 12 个检查全过。修完只重跑了这一项，没有再跑全量，因为只改了这个测试文件。河岸地形那项在并行时失败、单独跑通过，属于负载敏感。

## 2026-11-04：试玩报告的修复合进 master（0d21f54c）

**合并后验证**：`npm run map` 无变化，`npm run check` 通过，新增代码里没有中文注释。相关测试（工具、相机预设、画面检查、dev bridge、MCP、动作示例、资源清单等）33 项 429 个检查，失败 1 个：dev bridge 的"toast 随 threedog step 过期"，一起跑时失败，单独连跑两遍都通过（56/56），这次合并没有碰 toast、界面和时钟代码，判定为负载敏感。没有在 master 上重跑全量；同样的改动在 visuals/signals-in 上跑过全量。

## 2026-11-04 凌晨：一份试玩报告（夜街射击小游戏）里的引擎问题

**修了什么**（分支 fix/drifter-feedback）：截图会等 `await engine.start()` 之后的游戏代码跑完（没有进行中的请求、场景的物体/灯/材质数量 0.3 秒不变，最多 10 秒），录帧工具也一样；越肩相机预设能抬头；动作游戏教程补上建时间通道和 `world.simulate({ channel })`；画面检查新增"整帧全黑"（找出藏起来就恢复画面的那个材质）和"雾占了多少画面"；`describe` 在别的文件夹的开发服务器开着时说清楚原因；`assets.js` 里以 `/` 开头的路径跟着打包的 `--base` 走，`threedog build --base` 在 Git Bash 下不再被改写，新增部署教程；开发日志里同一条警告刷新后不再重复写；世界记录模型的表现动画写在 `present` 的 `update` 里（提示和教程都说了）。

**跑了什么**：`npm run map`、`npm run check` 通过。相关测试：action、camera、manifest、look、dev bridge、relay 101 项 845 个检查，第一次失败 2 个：本机 5173 端口上有另一个项目的开发服务器，新提示措辞改成两种情况都对之后重跑通过（76/76）。新增守护：shot 工具（等待晚到的灯）25/25、相机预设能抬头 2/2、画面检查全黑和雾 4/4。打包测试改成在子路径下构建和访问：用一个临时新游戏引用 `'/textures/t.png'` 跑，通过 4/4；临时撤掉清单里的修正后 3 个检查失败，证明这条测试会拦住。临时游戏已删。没有跑全量测试。

## 2026-11-03：数一数 AI 看得见的接口（0.5 第一步）

**接口计数（0.4.0 的代码，3c4daccc 之上）**：新工具 `threedog api-count` 从对外类型声明数出合计 1719 个（各组数字和 243 个没人用的候选在 [api-count.md](api-count.md)）。只计数，没删没改名。新测试 `api count`：3 个检查全过（合计超出记录 30 个以上才失败）；`cli surface` 29 个检查全过；`npm run check` 通过。

## 2026-11-03 夜：0.4 收尾

**全量测试（cb85ad58）**：所有收尾批次合并之后跑。646 项 4493 个检查，失败 11 个，分在 7 项里，用了 13.5 分钟。当时三个审查和易用性答题在同时跑，机器很忙。其中 4 项超时、3 项对负载敏感，单独重跑全部通过。真失败 3 项，都是测试过时，引擎没错，在 7deb082b 修好。

**三个审查**（都看 cb85ad58 的代码，原文存进仓库）：
- [审查 A：整体架构与 core](review/2026-11-03-A-architecture.md)：骨架立住了；问题是引擎对 three.js 的改动没全部登记、玩家设置能把值往上调、读档后旧句柄撤不掉、同一件事有两套写法、模块类型只查了一部分。
- [审查 B：渲染和外观](review/2026-11-03-B-render.md)：后期效果有五六个入口（最要紧）；改尺寸会弄坏后期链；云影关着也花钱还压暗点光源；WebGPU 上改参数不生效；外观值的函数出错被悄悄吞掉。
- [审查 C：玩法模块与工具](review/2026-11-03-C-gameplay-tools.md)：背包契约没列全，换掉背包后联机会崩；测试运行器和规则有几处"假通过"；新游戏模板还在教旧写法；物理在开局前加物体静默失败。

**易用性测试《一天》答题者 A（新引擎）**：题目每条都做到，约 770 行、约 1 小时。卡点 6 类，详见 [usability/2026-11-03-cb85ad58.md](usability/2026-11-03-cb85ad58.md)。

**对比实测《守灯人》答题者 B（纯 three.js，限时 30 分钟）**：题目每条都做到，约 590 行，约 7 分钟。卡点是自己写的着色器要手动接色调和雾、夜晚和暴风雨的颜色反复调。答题者 A 等外观接口收窄合进来后再跑，两边才好比。

**按根因修了什么**（审查和易用性测试的发现，合并之后各自复核过，见下表）：

| 根因 | 改了什么 | 合并 |
|---|---|---|
| 同一件事有两套写法 | 后期效果只留 `look.post.add` 一个入口，旧的五六个删掉；模块的 `type` 是唯一来源（外观、界面模块出错只报一次，游戏不卡死），重复的分类字段删掉；没人用的 `time.manual` 和 0.2 改名留下的陷阱删掉；新游戏模板改成画风插件文件夹 | 65686791、73635030 |
| 共享值的规则没守住 | 玩家设置只能往下调，排在系统层之上（过场、菜单打不开玩家关掉的东西，只有调试能）；读档后旧句柄照样能撤；设置行用公开写法限制共享值 | 7deb082b、89113e31 |
| 检查报了通过，其实有问题 | 背包契约补全，新规则 R50（引擎对可替换模块的调用必须在契约里）；粒子补契约；测试里没等待的检查、一个检查都没跑的测试项算失败；`--rule` 可以写多次；R16、R46 漏的路径；刚体在开局前加入时开发期报错；素材库列出坏条目 | a06b68c4 |
| 和直接写 three.js 时行为不一样 | 小地图这类叠一层的绘制不算接管画面；OutputPass 之后的 Pass 放到色调映射之后；后期跟着渲染器自己改尺寸；临时物体移出场景后登记表放手；游戏灯的阴影刷新交还；引擎对 three.js 的九处改动全部登记，可查可关 | 8c230926 |
| 画面花了不该花的钱、画错 | 云影关着时不花钱，只压暗平行光，晚设的退出也生效，节点材质列为未接入 | 060850ff |
| 出错时没有声音 | 外观值的函数抛错或给出 NaN 时警告一次，保留上一个好值；WebGPU 上改参数会重建效果；色调报错指向色调那一格；WebGPU 着色出错写明是哪个补丁、插槽或后期效果；`Fn` 外面的 `Loop` 开发期警告 | 83a7c593、e8a77aa4 |
| 文档和工具找不到、说不清 | how 找得到自写天空和体积雾；新增菜谱 59（读深度的后期效果）；`renderer: 'webgl'` 也认；截图命令的参数说明；游戏类型检查把纯 JS 写法引起的报错改成提示 | e8a77aa4、89113e31 |
| 数据模块碰了外观 | 地形的数据部分不再读画风，颜色和远景雾挪到地形外观 | 73635030 |

全量测试之前，同一晚已经合进来的收尾批次：画风包变成一捆外观插件、材质用途只留一个入口（875b3d35）；类型检查真正生效，137 个类型错误清零，`npm run check` 最后一行写明通过或哪部分失败（270509f1）；新规则 R49（引擎的着色器补丁必须有 WebGPU 版）（fd43824e）；测试自动发现、默认只打印失败、名字过滤不分大小写、什么都没匹配到就失败（cb85ad58）。

还没做：外观接口收窄（正在做）；答题者 A 的对比实测；审查里还没合进来的几条记在 `HANDOFF.md` "已知问题"。

## 每次运行

| 日期 | 提交 | 做了什么 | 结果 | 失败项与处理 |
|---|---|---|---|---|
| 2026-11-05 | cleanup/unused-api（基于 351c81d6） | 删冗余接口：删 1、转内部 5、留 98（写进 api-count 的留名单），总数 1765→1759；跑了 check、types、api count 相关测试 | 见提交 |
| 2026-11-04 | (分支 test/lifetime-and-coexist) | 新增 4 个 Lifetime 用例：共享资源（两个引擎共用材质/几何/贴图、游戏自留、重复 dispose）、重复创建销毁（WebGL 25 次、WebGPURenderer 的 WebGL2 后端 20 次，不是真 WebGPU 设备；没跑真 WebGPU）、第三方 Object3D.add 包装在引擎前后装入。发现并修了 1 个真问题：threePatches.off('scene-add-hook') 会把后装的第三方包装一起拆掉。`npm run check` 通过；`npm test -- Lifetime patch adopt` 26 项 217 检查全过；没跑全量 | 全过 |
| 2026-11-04 | docs/recipes-tidy | 收尾：locale 测试补按键（引擎的无按键报错是对的）；`how` 排名和弱匹配修根因；R13 真错修掉（31 降到 26 条，其余是片段缺类型的噪音）；`grids.preview({ draw })`、`tiles.color`；菜谱 41 并入 40，52 的叠加规则并入 55，09/38 去重，47 改正；新增 `worktree-link.mjs`。用它逐包链接 node_modules，引擎和工具指向本工作树。`npm run check` 通过；相关测试（how、doc、grid、recipe、thing、locale、worktree-link）85 项 589 检查全过，未跑全量。 |
| 2026-11-04 | fix/after-stage-c db4573fc | **全量 `npm test`**（阶段 B、C 之后的修复轮，上一次全量在 882ddead：690 项 4861 条，18 条失败在 12 项） | 689 项 4859 条全过，0 失败（11.4 分钟） | 无失败。上一轮的 12 项都已查根因：多数是测试还写着已删的入口，已移到现在的入口；真问题修在代码里：`how` 里文档不用、同义词在用的词被当成最稀有的词；WebGPU 第一帧重画预热画面（`render/backend.js`）；`assets report` 把好的法线贴图报成丢失。dev bridge 单跑通过，全量时是服务器 2 秒内没应答，等待改成 5 秒。这次比上次少 1 项：雾的 `exp` / `height` 删了，守卫跟着删 |
| 2026-11-04 | visuals/signals-in 6c766c1b | **对比实测《海风小岛》**（2 对 2，盲评）：[记录](usability/2026-11-04-island-blind.md) | 用时 25、14 对 14、13 分钟；代码 1136、1002 对 834、1020 行；用户猜哪些是新引擎，8 张对 3 张，分不出 | 引擎没有省代码和时间，阶段 B 暂缓，先查为什么 AI 不用现成模块 |
| 2026-11-04 | visuals/signals-in c9904f4e | **对比实测《守灯人》第二轮**（A6，每边 3 次，盲评）：[记录](usability/2026-11-04-keeper-blind.md) | 用时打平（平均约 15 对 16 分钟）；代码 610–776 对 541–619 行；用户点名好看的都是纯 three.js | 新引擎版没用上存档、暂停、菜单：模板在修，修完重跑 3 次 |
| 2026-11-04 | visuals/signals-in 88844e5f | **级联阴影入口合并后**：`npm run check`；cascades、级联阴影、tsl parity、engine content on WebGPU | check 通过；45 + 74 个检查全过 | 无 |
| 2026-11-04 | visuals/lib-look A5 | **素材库收画面部分**（助手做）：`lib add --kind look` / `lib pull` 放回 `look/`，带兄弟文件的画面文件在存入时报错；菜谱 62 加 3c 一节。只跑 `threedog test lib`（29 项过，把 lib.mjs 还原后 look 的检查转红）和 `npm run check`，没跑全量 | 见左 | 无 | 全量留给合并后 |
| 2026-11-04 | visuals/cascades-own-light 75b6e37e（B0b） | **游戏自己的灯有级联阴影入口**：`engine.shadows.cascades(light, { count: 3 })`，和 `look.shadow.set({ cascades })` 走同一份代码；`npm run map`、`npm run check`；守护测试 `cascades own light`（WebGL 和 WebGPU 各一项）；`look hints`。按简报没跑全量，也没跑旧的 `cascades` 测试 | check 通过；守护 27 个检查全过；look hints 45 个全过 | 反向验证一次：去掉把 `light.target` 换成替身的两行，3 条守护变红（游戏的目标被移动、方向错、remove 后没还原），已恢复。过程中守护抓到一个真错：`skyModule.js` 误删 `dropOwnedRow` 的 import，已修 |
| 2026-11-04 | visuals/signals-in A3 预算检查 + A4 | **检查指路**（助手做，分支 visuals/a4-checks）：超预算、级联阴影和灯池的用法行、阴影很黑、阴影条纹和阶梯边、雾的提示排序，都能读游戏自己的灯。合并后重跑 `npm run check` 和相关测试 | check 通过；look check、look hints、budget、inspect.perf、shot 共 27 项 221 个检查全过；13 处修复逐个反向验证，拿掉后对应测试都失败 | 已知误报：world 示例 16:00 肉眼无条纹，报 1.3%，推测是细草的影子，未单独验证；只作为事实显示，不判失败。默认软阴影的用例只证明不误报 |
| 2026-11-04 | visuals/signals-in A3（模板和菜谱部分） | 模板 `look/` 加具名接口写法、按 `engine.tier` 定阴影贴图；菜谱 62 写明钩子、没有 sky 就没有日夜、三条规则；新生成开放世界游戏，高低档各截一张，`threedog test -w`；`npm run check`；new-game、template scripts 测试 | 6 项和 30 项通过，check 通过 | 守护做了反向验证：写死贴图大小后失败。A3 的预算检查由助手和 A4 一起做，另记 |
| 2026-11-04 | visuals/signals-in A2 | **plain-look 拆成 `look/` 文件夹**（5 个文件，共 152 行）：改前改后 `shot --compare`，22:00、12:00、22:00 下雨；`npm run check` | 晴天两张逐像素相同（差异 0）；雨夜差异 0.0042，同一份代码连拍两次也是 0.0042，来自雨丝随机；check 通过 | 这个示例没有专门的测试，靠截图对比验证 |
| 2026-11-04 | visuals/signals-in A1 | **新游戏生成 `look/`**：`new-game` 空白、`--open-world`、`--example` 各生成一个并跑 `threedog test -w`；开放世界中午、午夜截图；`npm run check`；水面、new-game、cli、style tools、pack-external、bundle size、template scripts 相关测试 | 三个游戏各 6 项通过；相关测试 207 + 36 项通过；check 通过 | 第一次截图没进游戏目录，拍到了引擎示例页，数据作废重拍。午夜水面比地面亮：没有雾时反射固定灰色，改成反射天空地平线色并加守护。两条新守护都做了反向验证，拿掉修复后失败 |
| 2026-11-04 | d7ae2a95 | **推送 0.5.0 到 GitHub 公开仓库**（74d6feb）；公开副本里重新生成锁文件、`npm ci`、`npm run check`、`npm run build`、四个包 `npm pack --dry-run` | 全部通过 | npm 由用户发布 |
| 2026-11-04 | e1981995 | **全量测试（推送 0.5.0 前）**：验收发现的 5 条修复合并之后 | 669 项 4712 个检查，失败 1 个（12.8 分钟）；check 通过 | 失败的是"河岸"里 texture + 季节混合的读数正好卡在门槛 0.5，单独重跑 3 次都通过，属于负载（以前也出现过，排进 0.6：门槛加余量或改成单独跑） |
| 2026-11-04 | 4f941421 | **0.5 验收：真实小游戏《提灯人》**（Sonnet，限 60 分钟，从新建到打包运行），详见 [usability/2026-11-04-lantern-acceptance.md](usability/2026-11-04-lantern-acceptance.md) | **通过**：题目每条都做到；首次能玩约 11 分钟，全部约 33 分钟；查文档约 19 次全找到；引擎报错 3 次都一次改对；没碰内部字段；游戏自己的 7 项测试全过 | 没有严重问题。不挡交付的 5 条（碰撞体总挡相机、shot 路径和标题、how 找不到测试写法、api 缺 bounds 形状、shots 被 gitignore）记进 design.md 第 14 节，0.6 处理 |
| 2026-11-04 | 4f941421 | **全量测试（0.5 接口冻结时）**：所有 0.5 修复合并之后（同时有验收游戏在跑） | 667 项 4703 个检查全部通过（13.1 分钟） | — |
| 2026-11-04 | 23b5fce4 | **推送 0.4.0 到 GitHub 公开仓库**（a4cbb5f）：导出时去掉 games、docs/plans、docs/research、HANDOFF.md；公开副本里重新生成锁文件、`npm ci`、`npm run check`、`npm run build` | 全部通过 | npm 没有发布（用户自己发） |
| 2026-11-04 | 27c9dd45 | **全量测试（推送 0.4 前）**：修复轮两组合并之后 | 654 项 4622 个检查全部通过（11.2 分钟）；check 通过 | 2 项和别的页面一起跑时失败、单独重跑通过（负载） |
| 2026-11-03 | 5fa948e7 | **对比实测《守灯人》答题者 A（新引擎，Sonnet，限 30 分钟）**，和 B 的对比见 [usability/2026-11-03-keeper-compare.md](usability/2026-11-03-keeper-compare.md)，截图在 field/2026-11-03-keeper/ | 题目每条都做到（暴风雨的雾没出来）；约 360 行（B 约 590 行）；约 20 分钟；自己写了 14 个检查的游戏测试，全过；没有被引擎挡住 | 卡点 5 个：读不到当前天空色、类型报错不点名、ops guard 提示的日志文件不存在、天气过渡截图时没走完、标题流程和直达时刻没写清。排进修复轮 |
| 2026-11-03 | 469020b1 | **全量测试**：审查修复、易用性修复、后期一个入口、画面接口收窄、画布抗锯齿全部合并之后（同时有对比实测 A 在跑） | 653 项 4604 个检查，失败 2 个（12.2 分钟） | 两个都是"画布抗锯齿"那次改动和别的改动叠出来的：① 原生 three.js 守卫读 `post.object()` 得到 null（没开效果时现在不建后期链，测试要先开一个效果）；② 档位参数的静态检查还按旧位置找"只在无头页读档位"。排进测试后的修复轮 |
| 2026-11-03 | 3e131ca1 | 分支上的"设计文档逐条核对"（design.md 按 master 469020b1 的代码改标记，加第 14 节"已知差距与下一步"；菜谱 14、44、09 小改）：`npm test -- "doc rules" how recipe`；`npm run check` | 23 项 167 个检查全部通过；check 通过 | — |
| 2026-11-03 | bfe5446c | 合并"外观接口收窄"和"维护文档整理"后复核：`npm test -- "look api" look fog post style plugins "plain three" "on WebGPU" how "doc rules" examples recipe settings`；check | 135 项 1127 个检查，失败 1 个；check 通过 | 失败的是"光照出口"页面等待超时（其他页面同时在跑），单独重跑 7 个检查全部通过，属于负载 |
| 2026-11-03 | 65686791 | **对比实测《守灯人》答题者 B**（纯 three.js，Sonnet，限 30 分钟），项目在独立工作区 usability-compare-B，截图在它的 shots/ | 题目每条都做到（输赢画面、按 E 点灯没有亲手走完一局验证）；约 590 行；用时约 7 分钟 | 卡点：自写 ShaderMaterial 要手动接色调和雾；夜晚、暴风雨的颜色反复调；记错两个 0.187 改掉的写法（只是警告）。答题者 A 等外观接口收窄合进来后再跑 |
| 2026-11-03 | 65686791 | 合并"后期只留一个入口"（先把 master 合进它的分支，解了 8 处冲突）和"易用性修复①"后复核：`npm test -- post plugins "one post entry" "plain three" "on WebGPU" "lib:" style how "doc rules" examples recipe "settings limits" pack-external types`；`npm run check` | 97 项 878 个检查全部通过；check 通过 | 易用性修复①合并后一度失败的两项（pack-external 找不到旧的 post 行、how 搜 "webgpu" 的排序）在这次合并里修好 |
| 2026-11-03 | 78ac7054 | 分支上复核"后期只留一个入口"合并最新 master 之后：`npm test -- post plugins "one post entry" "plain three" "on WebGPU" "lib:" style how "doc rules" examples recipe "settings limits"`，再 `npm test -- pack-external` 和 `npm test -- how types`；`npm run check` | 91 项 803 个检查，失败 1 个；pack-external 33 个、how 和 types 199 个检查全部通过；check 通过 | 失败的是 how 搜 "webgpu"：菜谱 54 改过的色调映射行排到了前面，改措辞后通过。pack-external 原先失败：模板不再默认装后期效果包、新游戏的 tsconfig 不认 `import.meta.glob`，已修 |
| 2026-11-03 | 83a7c593 | 合并"外观值函数出错不再静默 + WebGPU 改参数生效 + 色调报错指向色调格"后复核：`npm test -- look tone "post on WebGPU" shared "sky contract"` | 53 项 399 个检查全部通过 | — |
| 2026-11-03 | e8a77aa4 | 合并"易用性修复②"（WebGPU 着色出错写明补丁和插槽、`Fn` 外的 `Loop` 开发期警告、how 找得到自写天空和体积雾、菜谱 59）后复核：`npm test -- how "doc rules" recipe "on WebGPU" tsl patch "shader errors"` | 57 项 557 个检查全部通过 | — |
| 2026-11-03 | e3e3a5ed | 分支上的"易用性修复②"：`npm test -- how "doc rules" recipe "on WebGPU" tsl patch`，修完后复跑 `npm test -- "threedog/tsl imports only" "shader errors on WebGPU" "threedog/tsl parity"`；`npm run check` | 56 项 542 个检查，失败 1 个；复跑 3 项 48 个检查全部通过；check 通过 | 失败原因：新文件引用了 core/validate.js，而"只许 threedog/tsl 引用的文件"名单里没有它（validate.js 本身只引用 errorHints.js），已加进名单。菜谱 59 的代码另在菜谱 56 的运行页上临时跑过（WebGL、WebGPU 各一次，故意改坏也能报出来），临时测试已删 |
| 2026-11-03 | 58a1e3d7 | 分支上的"后期只留一个入口"（合并 master 之后）：`npm test -- post plugins`、`npm test -- "lib:" style "on WebGPU" "plain three" "one post entry"`、`npm test -- how "doc rules" examples`、`npm test -- styletest day-night r4 describe contact outline night-lights stress`；`npm run check` | 18 项 157 个、56 项 558 个、20 项 161 个、60 项 498 个检查；每轮剩下的一项失败已修好或单独复跑通过；check 通过 | how 一项：文档搜索把新写的 THREE.md 行排到了前面，改措辞后通过。"PERF slowdown alarm" 在 60 项并跑时慢了 41%，单独复跑通过（机器负载） |
| 2026-11-03 | 8c4cd6b1 | 分支上的"易用性修复①"（设置行公开限制共享值、`renderer: 'webgl'`、截图说明里 views 的参数名、游戏类型检查放宽）：`npm test -- settings createEngine views shot types template "new game" how "renderer backend"`、`npm test -- pack-external`、`npm test -- look`；答题游戏去掉 `@ts-nocheck` 后的副本做类型检查；`npm run check` | 67 项 556 个检查，失败 1 个；pack-external 33 个、look 44 项 308 个检查全部通过；check 通过；答题游戏副本的类型错误 19 → 1（剩下的是内部接口 take，换成新的设置写法后为 0，另有 17 条提示不算错误） | pack-external 的冒烟检查原先失败是测试过时（测试输出改成只打印失败后，找不到 "smoke:"），改成看汇总行。"r4 W6 夜空星星"并跑时失败、单跑通过（机器负载） |
| 2026-11-03 | 8c230926 | 合并审查修复三组（契约与假通过、平行写法、原生 three.js 接入差异；how.mjs 冲突手工合并）后复核：`npm test -- "plain three" how post "own frame" hlod describe webgpu "module types" lifecycle time weather terrain template "new game" "doc rules" fog`，以及 `npm test -- contract net inventory content pickup "test runner" "check --rule" rigid "lib:" "module boundaries" cloud "plain three"`；`npm run check` | 192 项 1368 个检查、96 项 864 个检查全部通过；check 通过 | — |
| 2026-11-03 | a70996a4 | 分支上的"检查报了通过、其实有问题"修复（背包契约补三个方法 + 新规则 R50、粒子契约、测试运行器两处假通过、`--rule` 可重复、R16 / R46 漏的路径、刚体开局前报错、素材库坏条目）：`npm test -- contract net inventory content pickup "S1 world data"`、`"test runner" "check --rule" "cli surface"`、`rigid`、`"lib:"`、`"module boundaries: core"`；`npm run check` | 71 项 591 个、3 项 43 个、12 项 74 个、1 项 24 个、1 项 9 个检查全部通过；check 通过 | 无失败。R50 加进来之前扫出的正是背包那三个缺口，补完后为 0 |
| 2026-11-03 | 060850ff | 合并"云影修复"（关着不花钱、只压暗平行光、晚设的退出有效、节点材质列为未接入）后复核：`npm test -- cloud "plain three" season "engine content on WebGPU" cascades` | 19 项 223 个检查全部通过 | — |
| 2026-11-03 | 4582fe72 | 分支上的"云影修复"：`npm test -- cloud "plain three" season "engine content on WebGPU" cascades`；`npm run check` | 21 项 227 个检查全部通过（2.8 分钟，含一个临时测量项）；check 通过 | 软件渲染下逐帧计时的噪声约 ±25%，量不出云影开关的差别；改成对比着色器里每个像素实际执行的运算 |
| 2026-11-03 | b32f7678 | 分支上的"原生 three.js 接入差异"六处修复（小地图不算自己画画面、OutputPass 之后的 Pass 放到色调映射之后、后期跟随游戏自己的 setSize / setPixelRatio、临时物体移出场景后登记表放手、游戏灯的阴影刷新交还、对 three.js 的九处改动全部登记）：`npm test -- "plain three" how`；`npm test -- post "own frame" canvas hlod describe webgpu`；`npm test -- "后期 ao" "风格里的 bloom" fuse`；`npm test -- Sweep "plugins folder" plugins idle thing light photo resize`；`npm run check` | 169、622、107、496 个检查；第二组先失败 2 个，修好后全部通过；check 通过 | 失败原因：两个后期测试还在调用已删掉的 `post.setSize`（后期改为自己跟随渲染器尺寸），测试里删掉这一句 |
| 2026-11-03 | 7deb082b | 合并"共享值修复"（读档后句柄照样能用、设置只能往下调且排在系统层之上、两项引擎写入测试更新）后复核：`npm test -- "modifier stacks" "引擎写入不记成游戏层" shared settings TIME save stacks` | 124 项 866 个检查全部通过 | 全量测试里的 3 个真失败都已处理：两项"引擎写入"是测试过时（测试页的画风已经没有 ao），引擎的记录本来就对；stacks 测试按现在的设计改 |
| 2026-11-03 | cbf0e8f5 | 分支上的"共享值修复"：`npm test -- "modifier stacks" "引擎写入不记成游戏层" shared` 和 `npm test -- settings look TIME save`；`npm run check` | 7 项 102 个、160 项 1124 个检查全部通过；check 通过 | "引擎写入不记成游戏层"两项原先失败是测试过时（同上一行） |
| 2026-11-03 | cb85ad58 | **《一天》易用性测试，答题者 A**（新引擎，Sonnet），详见 [usability/2026-11-03-cb85ad58.md](usability/2026-11-03-cb85ad58.md)，截图在 [field/2026-11-03-one-day/](field/2026-11-03-one-day/) | 题目每条都做到（几处只做到一部分）；约 770 行，约 1 小时；碰到 5 个引擎报错，3 个照着报错一次改对 | 卡点 6 类：设置项限制自写效果没有公开写法（用了内部接口）、WebGPU 报错不写补丁名、TSL 的 `Loop` 静默丢失、how 找不到"自写天空 / 体积雾"、几个名字误导、模板的类型检查逼得关掉检查。已按根因修（见上面的总结） |
| 2026-11-03 | cb85ad58 | **全量测试**：所有收尾批次合并之后（测试改成自动发现，默认只打印失败）。同时在跑 3 个审查和《一天》答题，机器负载高 | 646 项 4493 个检查，失败 11 个，分在 7 项里（13.5 分钟） | 4 项超时（两个技法示例、模板宝箱、地形块失败）加 3 项对负载敏感，单独重跑这 7 项 42 个检查全部通过。真失败 3 项：两项"引擎写入不记成游戏层"（低档页报 `reading 'enabled'`；高档页 bloom 的写入方是 engine 而不是预期的值），一项"modifier stacks"预期句柄只有 owner / remove，但 change() 是后来按设计加的。三项都是测试过时，在 7deb082b 修好 |
| 2026-11-03 | fd43824e | 合并"补丁必须有 WebGPU 版的检查（R49）+ 迁移说明补全 + 失效路径"后复核：`npm run check`；`npm test -- "doc rules" how` | check 通过；18 项 142 个检查全部通过 | 新检查在现有代码里没有找到新的缺口（之前那两处已经补好） |
| 2026-11-03 | 270509f1 | 合并"类型检查修复"后复核（look/part.js 的类型说明有冲突，两边字段合在一起）：WebGPU、TSL、look、style 相关测试按名字过滤；`npm run check` | 83 项 751 个检查全部通过；check 通过，类型检查 0 个错误 | — |
| 2026-11-03 | 875b3d35 | 合并"画风包 = 一捆外观插件 + 材质用途只剩一个入口 + 删掉低多边形画风包"后复核：`npm test -- examples how look "doc rules" style plugins "ships no art" styletest render surface engine-webgpu gallery "post on WebGPU"` | 122 项 978 个检查全部通过 | 合并时发现三行中文注释，已改成英文 |
| 2026-11-03 | c3707b03 | 合并"WebGPU 尾巴"（调色 / 色调阶段对比、素材画廊画节点材质、近处植被淡出和地形贴图补 TSL 版）后复核：`npm test -- "post on WebGPU" "engine content on WebGPU" "asset gallery draws node materials" "gallery review modes" "vegetation fade" 地形外观 河岸` | 7 项 94 个检查全部通过 | 助手查出的真问题：开放世界在真 WebGPU 上几秒后冻住（两个引擎补丁只有 WebGL 版），已修；之前记录里 WebGPU 的 198 次绘制、5.3 ms 是冻住后的数，已在性能实测里更正 |
| 2026-11-03 | dc6a9629 | 分支上的"类型检查修复"（137 个类型错误清零，`npm run check` 最后一行写明哪部分失败）：`npm test -- "types guard" "check --rule" "cascaded shadows on WebGPU" "particles / weather on WebGPURenderer" "sky dome / sky fog on WebGPURenderer" "threedog/tsl parity" "patch tsl field" "sky hooks tsl form" "look.materials.glow" "engine content on WebGPU looks like WebGL" "look no-bypass routes" "uniforms read back each render" "parity on WebGPU" look`；`npm run check` | 52 项 485 个检查全部通过；check 通过；故意加一个类型错误时退出码 1，最后一行写 "type check 1 error" | 中途一次失败（WebGPU 级联阴影）是这次改动自己引入的：注释插进一行中间，把 throw 注释掉了，已修 |
| 2026-11-03 | 28fae1fb | 分支上的"WebGPU 尾巴"（调色 / 色调阶段对比、素材画廊画节点材质、开放世界绘制次数）：`npm test -- "post on WebGPU" "engine content on WebGPU" "asset gallery draws node materials" "gallery review modes" "vegetation fade" 地形外观 河岸`；真显卡 `perf --only=pages --gpu 60` | 7 项 94 个检查全部通过；真显卡开放世界 WebGL 210 / WebGPU 209 次绘制（原来 263 / 198） | 查出 WebGPU 上开放世界几秒后冻住（近处植被淡出补丁、纹理地形颜色图补丁只有 GLSL 版），已修，见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md)。`npm run check` 类型检查 137 个错误，分支起点同样是 137 个，不是这次引入 |
| 2026-11-03 | c7dfc817 | 合并"远景合并每轮只查一次 + 时钟差一分钟"后复核：`npm test -- HLOD hlod "dev bridge" scenario snap "calendar.timeOfDay" calendar` | 39 项 454 个检查全部通过 | 之前"重新加载后回到初始状态"的失败已修：是引擎的小数误差（0.3 天显示成 07:11；写入时间时 0.3 变成 0.30000000000000004），不是测试的问题 |
| 2026-11-03 | 7cf6b038 | 合并"模块名挪回各模块 + 天空贴图走 useTexture + 测试假引擎补 useTexture"后复核：`npm test -- "physics leftovers" surface detail texture sky i18n loading water` | 68 项 545 个检查全部通过 | 之前 6 个"假引擎缺 useTexture"的失败已修 |
| 2026-11-03 | 46ed86a2 | 合并"工具输出尾巴"（重复报错合一行、相同材质合一行、describe 只算要的段、triggers grid 不再比时间）后复核：`npm test -- "tool output sizes" "MCP server" errors inspect describe "triggers grid" "风格测试页"` | 53 项 420 个检查全部通过 | 助手说有 3 项和其他页面一起跑时失败、单独跑通过；这次一起跑全部通过 |
| 2026-11-03 | 45a66f74 | 分支上的"模块名挪回各模块、天空贴图走 useTexture、假引擎补上真 useTexture"：`npm test -- "physics leftovers" surface detail texture sky settings loading describe` 和 `npm test -- i18n water grid photo hlod nav quest inventor`；`npm run check` | 103 项 839 个、65 项 589 个检查全部通过；规则检查 0 个错误 | 类型检查 137 个错误，改动前的代码上同样存在（后来在 270509f1 清零） |
| 2026-11-03 | f025e838 | 合并"分块加载共用 + 普通材质自动带云影"后复核（Describe、describeText、WebGPU 测试页有冲突，手工合并：文字摘要用工具输出那边的新写法，测试页两段都保留）：`npm test -- terrain vegetation cloud season "plain three" pickups cascades "headless loading" "tool output sizes" "E openWorld" describe engine-webgpu` | 88 项 691 个检查全部通过 | 之前转给它的拾取物缓存测试已修（测试读的是拆分前的旧字段）；助手报告的 6 个"假引擎缺 useTexture"失败来自更早的合并，已派助手修 |
| 2026-11-03 | 37221314 | 合并"工具输出瘦身"后复核：`npm test -- "tool output sizes" "E openWorld" "MCP server" "dev bridge" "output budget"` | 5 项 92 个检查，失败 1 个 | "dev bridge" 里"重新加载后回到初始状态"得到 07:12，单独跑也失败，和这次改动无关，可能来自单一时间来源的改动，已派助手查（在 c7dfc817 修好） |
| 2026-11-03 | a6fb41ed | 合并"WebGPU 小差别 + 真显卡性能"后复核：`npm test -- "engine content on WebGPU" slowdown "post WebGPU"` | 实际匹配 2 项 18 个检查，全部通过 | 另两个名字没匹配到，算没跑；后期效果对比留到全量测试里看 |
| 2026-11-03 | a6fb41ed 合并前的分支 | 性能实测：开放世界 WebGL，真显卡 RTX 5060：`npx threedog perf --only=pages --gpu 60` | 帧间隔 16.4 ms（卡在 60 帧），JS 5.3 ms，绘制 263，三角形 13.8 万，程序 27，几何体 75 / 纹理 17（3 MB），JS 堆 45 MB | 见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md) |
| 2026-11-03 | a6fb41ed 合并前的分支 | 性能实测：开放世界 WebGPU，真显卡 RTX 5060（真 WebGPU）：`npx threedog perf --only=pages --gpu 60` | 帧间隔 16.8 ms，JS 5.3 ms，绘制 198，三角形 10.7 万，程序 22，几何体 58 / 纹理 20（3 MB），JS 堆 51 MB | 这组数是冻住之后的，已在 28fae1fb 一行更正；见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md) |
| 2026-11-03 | a6fb41ed 合并前的分支 | 性能实测：小城 WebGL，真显卡 RTX 5060：`npx threedog perf --only=pages --gpu 60` | 帧间隔 16.7 ms，JS 2.0 ms，绘制 81，三角形 2777，程序 6，几何体 62 / 纹理 6（3 MB），JS 堆 26 MB | 见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md) |
| 2026-11-03 | a6fb41ed 合并前的分支 | 性能实测：小城 WebGPU，真显卡 RTX 5060（真 WebGPU）：`npx threedog perf --only=pages --gpu 60` | 帧间隔 16.6 ms，JS 3.3 ms，绘制 82，三角形 2789，程序 5，几何体 63 / 纹理 8（3 MB），JS 堆 38 MB | 见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md) |
| 2026-11-03 | a6fb41ed 合并前的分支 | 性能实测：开放世界 WebGL，软件渲染：`npx threedog perf --only=pages --software 30` | 帧间隔 135 ms，JS 6.2 ms，绘制 198，三角形 12.4 万，程序 19，几何体 83 / 纹理 5，JS 堆 40 MB | 见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md) |
| 2026-11-03 | a6fb41ed 合并前的分支 | 性能实测：开放世界 WebGPU（WebGL2 后端），软件渲染：`npx threedog perf --only=pages --software 30` | 帧间隔 164 ms（比 WebGL 慢 21%），JS 6.1 ms，绘制 198，三角形 10.7 万，程序 22，几何体 58 / 纹理 20，JS 堆 38 MB | 见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md) |
| 2026-11-03 | a6fb41ed 合并前的分支 | 性能实测：小城 WebGL，软件渲染：`npx threedog perf --only=pages --software 30` | 帧间隔 46.7 ms，JS 2.5 ms，绘制 83，三角形 2802，程序 6，几何体 64 / 纹理 5，JS 堆 23 MB | 见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md) |
| 2026-11-03 | a6fb41ed 合并前的分支 | 性能实测：小城 WebGPU（WebGL2 后端），软件渲染：`npx threedog perf --only=pages --software 30` | 帧间隔 61.4 ms（比 WebGL 慢 31%），JS 4.0 ms，绘制 83，三角形 2801，程序 5，几何体 64 / 纹理 6，JS 堆 38 MB | 见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md) |
| 2026-11-03 | a6fb41ed 合并前的分支 | 性能实测：慢了没有（压力测试参考场景，软件渲染）：`npm test -- slowdown` | 帧耗时 / JS 校准 11.007，基线 11.671（便宜约 6%），通过 | 见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md) |
| 2026-11-03 | 6cc76d44 | 合并"每帧浪费 + 读档冻结 + 画面尾巴"后复核（CHANGELOG 有冲突，已合并）：`npm test -- Leftovers leftovers weather "look no-bypass" camera ui ops saves style "how: offline" post-webgpu "post WebGPU" pickups`；`npm run check` | 165 项 1344 个检查，失败 2 个；check 通过 | ① 用 describe.add 登记的游戏状态没有出现在文字版 describe 里，交给正在压缩工具输出的助手（37221314 合并时文字版 describe 改为保留游戏的段）；② 植被按内容模型名定义时没有复用缓存的几何体，合并前就失败，交给正在改植被的助手 |
| 2026-11-03 | d51f003c | 合并"玩法工程尾巴"后复核（CHANGELOG、测试清单有冲突，已合并）：`npm test -- "physics leftovers" nav rigid collision interact weather water particles plugins "module types"`；`npm run check` | 63 项 590 个检查全部通过；check 通过 | — |
| 2026-11-03 | 9c2b9bc6 | 合并"插件文件夹 + 插槽表 + 普通灯接入"后复核：`npm test -- plugins "plain three" "lib:" "describe everywhere" "look no-bypass" budget` | 13 项 124 个检查全部通过 | 合并时发现一条中文注释，已改成英文 |
| 2026-11-03 | c15c2fe4 | 合并"补三处出路"后复核：`npm test -- cloud season snow vegetation engine-webgpu "look no-bypass" wind patch`；`npm run check` | 41 项 358 个检查全部通过；check 通过 | — |
| 2026-11-03 | 7c58983c | 合并文档搜索修复后复核：`npm test -- "how: offline" "doc rules"` | 35 个检查全部通过 | 原因是 THREE.md 新表格的每一列都被检索，这些词抢了引擎条目的位置；现在这张表只按第一列（"你写什么"）检索 |
| 2026-11-03 | 38171e87 | 合并"扫尾后半"（78aeda69）和"自动接入原生 three.js"后复核（测试清单、相机、交互、任务有冲突，手工合并：保留模块类型的 type 和 provides，再加上扫尾的改动）：`npm test -- Sweep2 "review guard" input grid photo inventory quest interact rts camera player cutscene music flow "module types" "module boundaries" createEngine`，以及 `npm test -- "plain three" thing post render save world light photo sky scene` | 前一组 142 项 984 个检查全部通过；后一组 220 项 1501 个检查，失败 4 个 | 4 个失败都在文档搜索（how）：THREE.md 新表格抢了位置，在 7c58983c 修好 |
| 2026-11-03 | fb2737dc | 合并两项过时测试的修复后复核：`npm test -- "ships no art" "probe restores" "look check" terrain calendar` | 32 项 331 个检查全部通过 | 两项都是测试过时，引擎没有问题：地面颜色改成从块数据读取（地形拆分后旧字段已经没了，没有画风时地面仍是中性灰）；探针恢复的时刻改在探针调用前一刻读取（时刻现在是从时间推算出来的，每走一步都会变） |
| 2026-11-03 | 6e0b0d64 | 合并"素材库"后复核：`npm test -- "lib:" "art:" "cli surface" "how: offline" "doc rules" mcp "ships no art"`；`npm run check` | 14 项 145 个检查，失败 1 个；check 通过 | 失败的是"引擎不带美术"守卫：没有画风时地面已经不是中性灰。和素材库无关，可能来自地形拆分或画面值的改动。已派助手修（在 fb2737dc 修好） |
| 2026-11-03 | d4c9864a | 合并"模块边界"后复核（I18n 和 CODEMAP 有冲突，手工合并；合并后新规则抓到两处：核心里还写着地形外观、植被外观两个模块名，已加入暂留名单；植被直接引用了地形的内部文件，改成通过 terrain.setPlanter 交接）：`npm test -- "net:" title session glow light settings describe water loading "module boundaries" "module types" terrain vegetation`；`npm run check` | 131 项 932 个检查全部通过；check 通过 | 助手报告的"探针恢复一天中的时刻"失败，在合并前的 master 上同样失败，不是这次引起的；可能和"日历时刻改成从时间推算"有关，已派助手修（在 fb2737dc 修好） |
| 2026-11-03 | 95022401 | 合并"地形植被拆成数据和外观"后复核（无冲突；AI.md 加两行，10.6 KB；s1 测试模块补 type）：`npm test -- "S1 lifecycle" terrain "module types" how "doc rules"`；助手在分支上跑过 1052 项相关测试；`npm run check` | 39 项 281 个检查全部通过；check 通过 | 助手报告的 S1 lifecycle 失败（测试里的模块没写 type），在这次提交里修好 |
| 2026-11-03 | dadfa748 | 合并"模块类型"后复核（与扫尾第一部分在 CHANGELOG、测试清单、两个工具测试的假引擎上有冲突，已手工合并；AI.md 补了模块类型和天气外观两行，10.3 KB）：`npm test -- "module types" "module boundaries" Sweep Lifecycle shared weather calendar TIME contracts describe "input owners" "character control" "look no-bypass" how "doc rules"`；`npm run check` | 89 项 791 个检查全部通过；check 通过 | 助手报告 describe-everywhere 有 1 项失败，这次合并后已经通过（扫尾那边改过的 stackFrames 检查覆盖了它） |
| 2026-11-03 | 9f5fe907 | 合并"一致性扫尾"第一部分后复核：`npm test -- "[guard]" Sweep ray shadow describe how "doc rules"`；`npm run check` | 161 项 1202 个检查，失败 1 个；修好后重跑该项通过；check 通过（AI.md 压回 9.98 KB） | 失败的是"threedog/tsl 只能引用不含 WebGL 的文件"这条守卫：新加的 core/threePatches.js 只引用 errorHints，本身不含 WebGL，已把它加进守卫的白名单 |
| 2026-11-03 | 6b4df18f | 合并修复后复核下面全量测试的 7 项失败：`npm test -- "运行时检查" "unknown options throw" "ships no art" "describe everywhere" "fixed phase" "time channels" "how: offline" "doc rules"`；`npm run check` | 11 项 113 个检查全部通过；check 1 个错误：AI.md 11.1 KB，超过 11 KB 上限 | 修复时给 AI.md 补回了 how 检索要用的词，导致超出上限；交给正在重整 AI.md 的扫尾助手（在 9f5fe907 压回 9.98 KB） |
| 2026-11-03 | c25e7c75 | **全量测试**：生命周期、工具、WebGPU、共享点核心、时间、按键、控制、画面值全部合并之后 | 614 项 4277 个检查，失败 7 个（11.6 分钟） | 都是几项改动叠在一起后旧测试没跟上：createEngine 已删掉 shadows 选项，两条测试还拿它当"写错选项会提示你是不是想写 shadows"的例子；工具测试里的假引擎缺 input.action、time._beginStep、stacks；"引擎不带美术"守卫读到了已删除的字段；how 检索里 "speed up time" 的期望答案。已派助手修，结果在 6b4df18f 一行 |
| 2026-11-03 | 24d2d4da | 合并"画面值上共享点"后复核：`npm test -- "X：读档" look sky weather shadow fog settings input control time-source shared engine-webgpu examples "dev bridge: threedog command line"`；`npm run check` | 107 项 847 个检查全部通过；check 通过 | 助手报告剩下的 1 个失败项（c.mjs "X：读档" 还在读旧的 clock 存档部分，时间改动后日历已经并进 time 部分）已修好 |
| 2026-11-03 | 1a498c9f | 合并"按场合分层的输入"和"角色控制主人"后复核（两边在 services / modules / Describe / Timeline / 菜谱 21 / 测试清单有冲突，手工合并：ctx 同时有 input 和 control；Timeline 用 ctx；跳过过场不再占默认键）：`npm test -- character control input keys timeline cutscene dialog settings net time-source Lifecycle shared examples template`；另跑工具测试 "only the control slot" 和 "dev bridge: threedog command line"；`npm run check` | 引擎 81 项 685 个检查全部通过；工具两项先有 1 个检查失败，修好后 56 个全部通过；check 通过 | 合并时发现两条新的中文注释，已改成英文。工具测试 bridge 还在按旧的 'menu' 键打开设置，而设置菜单现在用基础的取消键，测试改成 'cancel'。教训：按测试名过滤时写文件名匹配不到，"0 项匹配"不能当成通过（现在这种情况会直接失败） |
| 2026-11-03 | d0402e37 | 合并"单一时间来源"后复核：`npm test -- time-source TIME SKIP Lifecycle shared timeline net engine-webgpu`；`npm run check` | 24 项 162 个检查全部通过；check 通过 | 合并时发现一条新加的中文注释，已改成英文（单独提交） |
| 2026-11-03 | c76635e3 | 合并"共享点核心"后复核：`npm test -- shared mod stacks Lifecycle engine-webgpu` | 64 项 511 个检查全部通过 | — |
| 2026-11-03 | 94f982e3 | 合并"WebGPU 收尾"后复核：`npm test -- engine-webgpu tsl threedog/tsl 着色器补丁 "world 补丁" cascade particles weather` | 26 项 274 个检查全部通过 | 之前失败的两项"着色器补丁""world 补丁"已修：测试写法过时（补丁展开后 `#include` 那一行就找不到了），同时去掉了 detail 里重复的那份噪声代码 |
| 2026-11-03 | 618c5873 → 492221d6 | **全量测试**：生命周期、工具统一、WebGPU 第一轮合并之后 | 603 项 4224 个检查，失败 3 个（11.6 分钟） | ① "着色器补丁"、② "world 补丁"：生命周期助手说它们在合并前的 ec454cd3 上就失败，这一点没有亲自复核；后来在 94f982e3 修好。③ "SKIP 跳过时间"停在 05:59：单独重跑能通过，属于浮点误差，在 d0402e37 修好。另有"刚体树"一项和其他页面一起跑时失败，单独重跑通过（负载下才出现） |
| 2026-11-03 | 618c5873 | 合并生命周期后复核：`npm test -- Lifecycle engine-webgpu` | 5 项 24 个检查全部通过 | 合并时测试清单有冲突，补上了生命周期的测试（那时测试还要手工登记，现在自动发现） |
| 2026-11-03 | 8e31a4f4 | 合并工具统一后复核：`npm test -- cli-surface check-rule-ids project-context how`；`npm run check` | 16 项 119 个检查全部通过；规则检查 0 个错误，警告从 146 条降到 94 条 | — |
| 2026-11-03 | ff7efc12 | 合并 WebGPU 第一轮后复核：`npm test -- engine-webgpu WebGPU patch tsl TSL cascade backend fx-particles sky-tsl` | 31 项 365 个检查全部通过 | — |
| 2026-11-03 | 没记（0.4 审查前） | **全量测试**：0.4 测试提速和第一批审查修复合并之后 | 576 项 4091 个检查全部通过（11.0 分钟） | — |
| 2026-11-03 | （0.4 审查前） | **全量测试**：0.4 测试提速和第一批审查修复合并之后 | 576 项 4091 个检查全部通过（11.0 分钟） | — |
| 2026-11-03 | 45a66f74 | 模块显示名移回各模块、天空贴图改走 useTexture、假引擎补上真 useTexture：`npm test -- "physics leftovers" surface detail texture sky settings loading describe` 和 `npm test -- i18n water grid photo hlod nav quest inventor` | 103 项 839 个检查、65 项 589 个检查全部通过；规则检查 0 个错误 | 类型检查 137 个错误在改动前的代码上同样存在 |
| 2026-11-03 | dc6a9629 | 类型检查修复后复核（137 个类型错误清零，`npm run check` 最后一行写明哪部分失败）：`npm test -- "types guard" "check --rule" "cascaded shadows on WebGPU" "particles / weather on WebGPURenderer" "sky dome / sky fog on WebGPURenderer" "threedog/tsl parity" "patch tsl field" "sky hooks tsl form" "look.materials.glow" "engine content on WebGPU looks like WebGL" "look no-bypass routes" "uniforms read back each render" "parity on WebGPU" look` | 52 项 485 个检查全部通过；`npm run check` 0 个错误，故意加一个类型错误时退出码 1、最后一行“type check 1 error” | 中途一次失败（WebGPU 级联阴影）是本次改动自己引入的：注释插进一行中间把 throw 注释掉了，已修 |
| 2026-11-03 | cbf0e8f5 | 共享值修复（读档后旧句柄仍有效、设置层只能往下调且排在系统层之上）：`npm test -- "modifier stacks" "引擎写入不记成游戏层" shared` 和 `npm test -- settings look TIME save` | 7 项 102 个检查、160 项 1124 个检查全部通过；`npm run check` 0 个错误 | "引擎写入不记成游戏层"两项原先失败是测试过时（测试页的画风已经没有 ao），引擎的记录本来就对 |
| 2026-11-03 | 4582fe72 | 云影只作用于太阳、关着时不花钱、晚设退出生效、节点材质列出：`npm test -- cloud "plain three" season "engine content on WebGPU" cascades` | 21 项 227 个检查全部通过（2.8 分钟，含一个临时测量项）；`npm run check` 通过 | 软件渲染下逐帧计时噪声约 ±25%，量不出云影开关的差别；改按着色器里每像素实际执行的运算对比 |
| 2026-11-03 | b32f7678+ | 不干预原生 three.js 六处修复（小地图不算自己画画面、OutputPass 之后的 Pass 放到色调映射之后、后期跟随游戏自己的 setSize / setPixelRatio、临时物体移出场景后登记表放手、游戏灯的 shadow.autoUpdate 交还、对 three.js 的九处改动全部登记）：`npm test -- "plain three" how`；`npm test -- post "own frame" canvas hlod describe webgpu`；`npm test -- "后期 ao" "风格里的 bloom" fuse`；`npm test -- Sweep "plugins folder" plugins idle thing light photo resize` | 169 + 622 + 107 + 496 个检查；第二组先失败 2 个，修好后全过；check 0 个错误 | 失败原因：两个后期测试还在调用已删掉的 `post.setSize`（后期改为自己跟随渲染器尺寸），测试里删掉这句 |
| 2026-11-03 | e3e3a5ed | 易用性测试《一天》A 暴露的 WebGPU 报错与文档问题（节点构建出错写明补丁/插槽或后期效果名、Fn 外的 Loop 开发期警告、读深度的后期效果菜谱 59、how 能找到自定义天空和体积雾）：`npm test -- how "doc rules" recipe "on WebGPU" tsl patch`，修完后复跑 `npm test -- "threedog/tsl imports only" "shader errors on WebGPU" "threedog/tsl parity"` | 56 项 542 个检查 541 个通过、复跑 3 项 48 个检查全部通过；`npm run check` 0 个错误 | 第一次的 1 个失败是新文件引用了 core/validate.js，而只许 threedog/tsl 引用的文件名单里没有它（validate.js 本身只引用 errorHints.js），已加进名单；菜谱 59 的代码另在菜谱 56 的运行页上临时跑过（WebGPU、WebGL 各一次，故意改坏能报出来），临时测试已删 |
| 2026-11-03 | 8c4cd6b1 | 易用性测试 A 的修复（设置行公开限制共享值、renderer: 'webgl'、截图说明里 views 的参数名、游戏类型检查放宽）：`npm test -- settings createEngine views shot types template "new game" how "renderer backend"`、`npm test -- pack-external`、`npm test -- look`（44 项 308 个检查全部通过）；答题游戏去掉 `@ts-nocheck` 后的副本做类型检查 | 67 项 556 个检查 555 个通过、pack-external 33 个检查全部通过；`npm run check` 0 个错误；答题游戏副本类型错误 19 → 1（剩下的是内部接口 take，换成新的设置写法后 0，另有 17 条不算错误的提示） | pack-external 的冒烟检查原先失败是测试过时（测试输出改成只打印失败后找不到 "smoke:"），已改成看汇总行；"r4 W6 夜空星星"一项并行时失败、单跑通过（受负载影响） |
| 2026-11-03 | 58a1e3d7 | 后期效果只留一个入口 look.post.add（合并 master 后）：`npm test -- post plugins`、`npm test -- "lib:" style "on WebGPU" "plain three" "one post entry"`、`npm test -- how "doc rules" examples`、`npm test -- styletest day-night r4 describe contact outline night-lights stress` | 18 项 157 个、56 项 558 个、20 项 161 个、60 项 498 个检查；各轮剩下的一项失败已修好或单独复跑通过；`npm run check` 0 个错误 | "how" 一项是文档搜索把新写的 THREE.md 行排到了前面，改了措辞后通过；"PERF slowdown alarm" 在 60 项并跑时超 41%，单独复跑通过（机器负载） |
| 2026-11-03 | 78ac7054 | 后期唯一入口合并最新 master 后复跑：`npm test -- post plugins "one post entry" "plain three" "on WebGPU" "lib:" style how "doc rules" examples recipe "settings limits"`，再 `npm test -- pack-external` 和 `npm test -- how types` | 91 项 803 个检查 802 个通过；pack-external 33 个、how + types 199 个全部通过；`npm run check` 0 个错误 | 唯一失败是 how 的 "webgpu" 被菜谱 54 改过的色调映射行抢先，改措辞后通过；pack-external 原先因模板不再默认装 post-effects、新游戏 tsconfig 不认 import.meta.glob 失败，已修 |
| 2026-11-03 | d62b6409 | 不开效果时用画布自带的抗锯齿、sRGB 图片背景在所有路径上都做色调映射：`npm test -- post "on WebGPU" "engine content on WebGPU" "低档设备" background slowdown "Cold start" "抗锯齿" "describe render" "renderer backend" renderOnce`，再单跑 `slowdown` 和 `抗锯齿`；真显卡测显卡时间（见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md) 最后一节） | 41 项 356 个检查 355 个通过；slowdown 单跑两次都通过；抗锯齿 8 个检查全部通过；`npm run check` 0 个错误 | "PERF slowdown alarm" 在 41 项并跑时超 43%，单跑通过（机器负载）；开放世界在 WebGPU 页的回退检查原先靠开局档位猜错成"高"才有分级阴影，测试的画风里加了 low.cascades |

## 还没做的实测

- 对比实测《守灯人》答题者 A（新引擎）：等外观接口收窄合进来后跑，和已跑完的 B 对比（题目见 [usability-tasks.md](usability-tasks.md) 第二题）。
- 《一天》的纯 three.js 对照答题者 B：还没跑。
- 真显卡上的 WebGPU：2026-11-03 第一次跑通性能实测（RTX 5060 笔记本，见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md)）；画面逐像素对比仍只在软件渲染上做（为了每台机器结果一样）。
| 2026-11-03 | abac4778 | 外观接口收小（每个部件 set / patch / add / replace / manual / value，materials.patch 改 add，删 look.fog.replace，作者方法挪到 part.author）：`npm test -- look sky fog post style plugins "plain three" "on WebGPU" how "doc rules" examples recipe settings "one takeover entry"`，`npm test -- owned render art material shadow weather water terrain vegetation catalog describe` | 148 项 1186 个检查 1184 个通过（修后 "look guards" "Sweep2" 20 个全过）；210 项 1740 个检查 1739 个通过；`npm run check` 0 个错误 | 两项是测试还在调部件上的 remove()，改成 author.remove()；性能报警单跑 3 个检查全过（同时跑的测试多、机器忙） |
| 2026-11-03 | ce9ae6d2 | 修两项整套失败（纯 three.js 尊重测试在没开效果时拿不到后期链；画质档静态检查跟到新位置）+ ops 提醒日志写进各游戏自己的 .threedog：`npm test -- "plain three" "friction fixes" ops "test runner" "Follow camera looks up"`，新建临时游戏 `npx threedog test -w games/tmpops` | 52 项 415 个检查全过；临时游戏 6 个检查全过、没有 ops 提醒；`npm run check` 0 个错误 | 引擎整套那 1 处提醒来自镜头仰视测试页自己挪玩家（测试准备代码），已包进 ops.allow；新建游戏本身 0 处 |
| 2026-11-03 | (本分支) | 关阴影只关渲染器总开关、不再改游戏灯的 castShadow；lib pull 写好 plugins/ 接入文件；plugins/ 形状报错写明文件、找到的东西和改法：`npm test -- "shadow settings"`、`shadow`、`plugins`、`"lib:"`、`describe`、`"plain three" settings` | 6/6、241/241、29/29、27/27、295/295、175/175 个检查全过；`npm run check` 0 个错误 | — |
| 2026-11-03 | （本分支） | 首帧时间：引擎记下打开页面到第一帧画面的时间和八段（engine.startup.firstFrameMs / phases，inspect.perf 多一行），`threedog perf --only=startup` 测五个页面加空白模板（真显卡和软件渲染，构建版，见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md)「首帧时间」），新增首帧变慢报警并记下软件渲染基线：`npm test -- slowdown "first frame" "Cold start" loading "startup time"`，`npm run check` | 20 项 91 个检查全过；首帧报警另跑两次都过（1.23 倍，门槛 1.5 倍）；check 通过 | 报警第一版用刷新页面、在游戏页里校准，数字乱跳（详见实测文档），改成新标签页 + 空白页校准 + 取最快一次 |
| 2026-11-03 | (本分支) | 接口清理两类（类型里删 look.clouds、漏出的 three.js Light、几个 .engine 回指，藏起 audio.info / ambience.info / level.buildMs）+ api-count 把"留"的单独报：`npm test -- "api count" types look "doc rules" how` | 73 项 556 个检查全过；`npm run check` 0 个错误；`npm run map` 已更新；`threedog api-count` 合计 1719→1711，候选 243→115（留 119） | — |
| 2026-11-03 | (本分支) | 外部审查两处问题：共享数值在 engine.mod 和 handle.change 上同样检查数字（clamp 上下限要是有限数且下限不大于上限，set/add/mul 要是有限数，错了报 shared-value）；跟随镜头贴地缩短改成最多每 0.2 米采一次（最多 160 次），不再固定 12 次：`npm test -- "modifier stacks" "shared points" "Follow camera" "one failure shape"`，`npm run check` | 共享数值和报错形状 77/77、共享数值浏览器 32/32、镜头 30/30 个检查全过；新加的窄凸起用例在旧的 12 次采样下复现出整条 8 米臂长，新代码停在凸起前；`npm run check` 0 个错误 | 一次贴地检查实测：8 米臂不到 0.001 毫秒，40 米臂（160 次封顶）约 0.006 毫秒 |
| 2026-11-03 | （本分支） | 首帧砍三处浪费：房间环境图和后期链的程序跟场景一起并行编译（WebGL）；draw 段那约 170 ms 查出来是 Rapier 第一步编译 WASM，物理模块在开局等显卡的空档里用一个扔掉的小世界先走几步（新 `ctx.whileCompiling`）；perf 不再留下空的 games/。`npx threedog perf --only=startup --gpu`（改前改后各测）和 `--software`，数字见 [field/2026-11-03-perf.md](field/2026-11-03-perf.md)「首帧：砍掉三处浪费之后」；`npm test -- "first frame"`、`slowdown "Cold start" loading "startup time" post "on WebGPU" env interior`、`rigid "Cold start" "startup time" loading interior` | 真显卡 WebGL：开放世界 1638→1195/1272 ms，小城 1163→757/825，羊岛 1270→949/985；WebGPU 持平；软件渲染看不出变快（机器忙）。首帧报警 3/3 过（比值 81.61，基线 76.55，没改）；429/429、160/160 个检查全过；`npm run check` 0 个错误 |
| 2026-11-03 | （本分支） | "等待之后"三处漏洞（外部复审 0.4.0）：异步初始化过期后按名字动了同名新模块、异步读档里 await 之后的监听报错被吞、回滚快照和活状态共用对象；顺带修关卡连续两次 load 先到的旧文件叠上去；先写会失败的测试再修：`npm test -- Lifecycle lifecycle session save load S1 modules plugins "module types" stacks` | 155 项 989 个检查，988 过、1 个没过：`[guard] engine copies` 的 core/copies.js 版本号 0.3.0 与 package.json 0.4.0 不一致，本分支没碰这两个文件，基线上就这样；`npm run check` 通过 |
| 2026-11-03 | （本分支） | 合并 master 后补："等待之后"的安装身份也管 `ctx.whileCompiling`（已卸下的模块排进去的预热不再跑），先写失败测试再修：`npm test -- Lifecycle lifecycle session save load S1 modules plugins "module types" stacks rigid` | 164 项 1068 个检查全过；`npm run check` 通过 |
| 2026-11-03 | (本分支) | 外观值只走 look.*（water / sky / terrain 里的外观选项删掉，改成 look.water / look.sky / look.ground 参数，旧写法开发时报错给新写法；api-count 1711 → 1680）：`npm test -- water sky look style examples "api count" how "doc rules" "on WebGPU"`，再单跑 `"水面外观" "how:"` | 131 项 1095 个检查：首轮 2 项失败（水面外观测试还用已删的 depthColor 选项测拼错提示，改成 segments；how 的搜索因 AI.md 一行改词换了第一答案，改回原词），复跑这 2 项 26 个检查全过；`npm run check` 通过 |
| 2026-11-03 | （本分支） | 外部审查三处：安装说明统一（今天从仓库用，0.4.0 上 npm 后 `npm install threedog@0.4`，每处写明描述的版本）；Node 版本范围统一成 vite 8 要的 `^20.19.0 \|\| >=22.12.0`，dev/build/test/shot/perf 等先查 Node（测试里假装成 20.11）；新游戏 CLAUDE.md 改成请求清楚就直接做、只问会改结果又推不出的选择、小改只更新受影响的记录：`npm test -- "cli surface" doctor template "new game" "doc rules" "version pins"`，`npm run check` | 21 项 157 个检查全过（"doctor" 这个名字没有对应的测试，去掉后重跑）；在仓库里用 new-game 实建一个开放世界游戏，引擎和地形包都链到仓库里的 0.4.0，建完删掉；`npm run check` 通过 |
| 2026-11-03 | （本分支） | 一件事一个入口：删掉 `water({ material })`，自带水面材质只走 `look.water.replace(fn)`（画风层 `style.water.material`），旧写法开发时报错给出新写法；`water({ uniforms })` 留着（给 `look.water.patch` 的 GLSL 声明 uniform，内置材质上就用得到）；api-count 1681 → 1680：`npm test -- water "水面外观" "one entry per look value" "api count" "doc rules" how`，再单跑 `"水的材质入口"` | 30 项 296 个检查全过；水的材质入口 5/5 过；`npm run check` 通过 |
| 2026-11-03 | (本分支) | 外部审查插件组合四处问题：后期效果关了再开不再换位（效果名第一次登记定下槽内位置，插件按列表顺序预留）；画风包里每个插件自己是所有者，两个插件写同一个键开发时报 shared-conflict，`export const replaces` 声明谁替谁；新增 `look.materials.rebuild()`，材质类插件关开时自动重做已做出的材质（保留调用参数、手改颜色、风和云影）；`plugins.off/on` 返回做了什么和影响范围，画风包起始值不随之关掉。新增 tests/specs/plugin-composition.mjs（含 WebGL 像素组合：天空+天气+雾、材质+风+云影、泛光+调色+颗粒，以及两条路线的后期顺序）：`npm test -- plugins style "one post entry" look post material patch cloud wind "on WebGPU"`，`npm run check` | 135 项 1163 个检查全过；check 通过。开放世界页（208 个网格、11 个引擎材质）rebuild 调用约 3 ms，无变化重做后下一帧 11.6 ms（原 10.6 ms）；加一个颜色补丁插件后首帧约 650 ms（重新编译着色器），关掉后约 90 ms | 新用例先在旧代码上跑出 7 处失败（顺序变 pb、同包冲突不报、rebuild 不存在、补丁关掉画面不变）；look api / look no bypass 两条守卫的动词表加上 rebuild；最初 rebuild 立刻释放旧材质，导致下一帧全部重编译（99 ms），改为画完下一帧再释放 |
| 2026-11-03 | (本分支) | 只改文档：新增菜谱 60「把画面调好看」对照表（每个调节项：画面上管什么、怎么看对不对、引擎一行写法并链到菜谱 52/08/38/44 等原处、纯 three.js 一行；不给数值；写明不是步骤、按画风挑；写实黄昏/扁平卡通/阴雨夜三种画风下同一调节项往哪边动）；菜谱 52 和游戏模板 CLAUDE.md 各加一行链接（AI.md 已到 11264 字节上限，没加）；how 同义词加一组「好看/打磨」，CONVENTIONS 里一处 "for good" 改成 "take it over"（它让 "look good" 先命中开灯那行）；how 测试加四条问法：`npm test -- how "doc rules" "recipe code blocks"`，`npm run check`，`npm run map` | how 17 项 124 个检查全过；doc rules + recipe code blocks 2 项 23 个检查全过；check 0 错误（警告都是原有的） |
| 2026-11-04 | (本分支) | 修 0.5 验收五条发现（用户批准）：碰撞体 `occluder: false` 不挡跟随相机（新测试：16 棵树围一圈，标了臂长保持 8 m、不标缩到圈内）；`shot --play` + 引擎 `?play` 网址参数越过标题（新测试：界面测试页带 `?play` 打开后标题关、解冻、在玩）；页面参数按 Git Bash 的 `EXEPATH` 还原、被改写时 shot 写明真正打开的页面；`how "game test"` 指到游戏测试写法；`addBlocked` 的 bounds 形状进 api 页；.gitignore 去掉 `shots`；api-count 1681 → 1682：`npm test -- camera "Follow camera" collision shot how "api count" "cli surface" "UI title: the ?play"`，`npm run map`，`npm run check` | 67 项 639 个检查全过；check 通过 |
| 2026-11-04 | visuals/stage-c2-atmos | 删 look.tone / look.lights / look.fog；WebGPU 半透明雾：WebGPU 与 WebGL 走合成器逐像素相同（超过 2 级的 0%），WebGL 直出在显示值里混合，超过 8 级的 6.36%，属 three.js 渲染器差异；只跑相关项，全过 |
| 2026-11-04 | fix/review-render | 修渲染审查发现（H1、H3、M1-M6、L4）：WebGPU 程序键含 tsl 函数身份，同名补丁红蓝各画各的、内置效果 6 个材质仍 1 次构建；低档单图跟随相机；级联 intensity 传到每级、材质弱引用（垃圾回收后确认释放）；设备丢失走 contextLost（手动调钩子，没有真丢设备）；只跑相关项全过，`npm run check` 通过。WebGPU 相关都跑在 WebGPURenderer 的 WebGL2 后端，不是真 WebGPU |
| 2026-11-04 | fix/review-tools | 修工具审查：按 E、鼠标锁定、模板地点、文档死名字、R13/R18。逐包链接 node_modules，引擎和工具指向本工作树。相关测试：按键相关 62 项 568 检查里 1 项失败（contracts 的假引擎缺 isUnbound，补上后重跑通过），鼠标锁定等 37 项 429 检查全过，收尾 18 项 332 检查全过；新守卫在改回旧代码时会失败；check 通过；三种模板各新建一个游戏，真实按 E 通过，去掉按键时 check 和冒烟都报错；没跑全量 |
| 2026-11-04 | rename/picture | look 改名 picture（游戏文件夹、模块画图部件、模块类型、菜谱、工具和测试）。逐包链接 node_modules，引擎和工具指向本工作树。`npm run check` 通过；相关测试：template 148、picture 456、module types 20、example 114、terrain 155、vegetation 125、sky 248、bridge（含打包安装）134、cli 127、lib 29 全过；weather 165 里 1 项失败（locale zh 缺 interact 按键，相关文件这次没动）；doc 62 里 2 项失败（how 搜索排序，基线上同样的查询答案相同）。三个模板各建一个游戏，先 map 再 check 都通过，已删除。 |
| 2026-11-04 | picture/parts | 画面件：占位名字表、写入工具认占位（`picture-held`）、卸载残留检查（`picture-leftover`）、`engine.unuse`、菜谱 62 第 3e 节。逐包链接 node_modules，引擎和工具指向本工作树。新测试 picture parts：36 项全过，含三件共处、四种冲突、菜谱例子、WebGPU 渲染器；13 处故意改坏全部被抓（第一轮 2 处漏过，补了测试后抓到）。残留检查抓到引擎真 bug：`replaces` 换天空后穹顶留在场景里，已修。无上下文助手：check 跑 1 次改好且选了保住效果的共享值，但读了菜谱和源码，"不看文档"这条没通过，卡在 `handle.change` 没写；报错和菜谱各改一次，改后没复测，见 `docs/testing/field/2026-11-04-picture-parts.md`。`npm run check` 通过；相关测试：picture 492、module 269、sky 248、shared 49、api count 3，全过；没跑全量。 |
| 2026-11-04 | c1169d22 | 全量（0.6 改名、审查修复、画面件全部合并后）：707 项 5020 检查，0 失败，10.4 分钟。第一次全量（cfed5f1d，画面件合并前）706 项 2 失败，都是测试落后于有意改动，已修 |
| 2026-11-04 | df70501e | 0.6.0 发布前全量 | Total: 5022 checks in 707 items, 5022 passed, 0 failed (10.8 min) |
| 2026-11-04 | debff046 | **推送 0.6.0 到 GitHub 公开仓库**（5887046）；公开副本里 `npm ci`、`npm run check`、`npm run build`、四个包 `npm pack --dry-run` | 全部通过 | npm 由用户发布 |
| 2026-11-04 | assets/lib-records | 素材库第 1-3 步（拉取记录、说明卡、lib check）和玩法系统条目、空游戏证明：lib records / lib card / lib check / lib system / lib / art board / api-count 共 7 项 115 条全过（含真实浏览器空游戏证明）；npm run check 通过；没跑全量 |
| 2026-11-04 | light/probes-lightmap | 光照第 1、2 步。探针改逐像素网格（半精度）、`threedog bake light` + `engine.loadLightmap`。软件渲染（Playwright Chromium + SwiftShader；WebGPU 那路是 WebGL2 后备）：`light probes` 18/18、`renderOnce` 19/19、`lightmap` 12/12、`interior` 6/6、`look` 345/345；`check` 通过。真显卡（系统 Chrome 156，适配器 nvidia blackwell，后端 webgpu）：烘 512 图 3 个物体 2.6 秒；同一文件 WebGL 对真 WebGPU 平均差 0.35/255，最大 160（个别像素，没查）；同一场景 50 个探针两边烘，最大差 0.007（最大值 2.26）。 |
| 2026-11-04 | 92d49da1 | 全量（合并 assets/lib-records、light/probes-lightmap 后）：712 项 5084 检查，2 项失败，11.3 分钟。一项是 AI.md 压缩时删了 torches，how 搜不到；一项是 threedog/tsl 经 LightProbeGrid 碰到 'three'，只取四个通用类，和 CSMShadowNode 同类，加具名例外。修后 check 通过，相关 20 项 158 检查全过；没再跑全量 |
| 2026-11-04 | 7b285981 | 真人试玩（用户，Chrome，`--example` 模板）：点击锁定鼠标、Esc 一次放开并暂停、鼠标点菜单、恢复后重新锁定不跳、按住 W 时切窗口、按住 W 时切标签页 | 6 项全过；之前只有模拟的真实 Esc 和切窗口缺口关闭 |
| 2026-11-04 | (本分支) | 删 `--example` 模板（苹果、Search 示例）；打包安装测试改用 `--open-world`，hp 和箱子两条检查换成运行时定义的操作；相关 41 项 354 检查全过，`pack-external` 33 检查全过，check 通过；没跑全量 | 全过 |
| 2026-11-04 | (本分支 fix/time-and-doc-checks) | uTimeOfDay/uDaylight 改为只由 render/daylight.js 写（来自 calendar/sky 注册的 timeOfDay/daylight 量），新增无 sky 时 uTimeOfDay 跟日历走的检查；R13/R18 的 27+7 条警告已修（文档补变量声明、规则去掉两类 TS 误报、R18 加 7 个允许项）并升为错误。跑了：uNight/sky writes nothing/calendar 共 222 检查全过，名含 sky 的 35 项 249 检查全过，check 通过 0 错误；没跑全量 | 全过 |
| 2026-11-04 | (本分支) | 新游戏默认 WebGPU + TSL，`--webgl` 走 GLSL。四个游戏（空白/开放世界 × 两种模式）`check` 全过；烟雾测试各 7 项全过，都在无头 Chromium 的软件渲染（SwiftShader）上：WebGPU 游戏落在 WebGL2 后端（没有适配器），`--webgl` 游戏是 WebGLRenderer。真显卡：系统 Chrome 156、NVIDIA Blackwell 上真 WebGPU 跑 blank 和 open-world 两个默认游戏（`real-webgpu.mjs --game`，`?play`，起始节点材质画进场景，截图看过），无校验错误。拿掉 `navigator.gpu`：blank、open-world 都继续跑，`describe().renderer` 给出原因（软件渲染上）。相关 46 项 417 检查跑过一次，1 项失败（包体积，默认路线 1164 KB 超上限 1125），改成两条路线各设上限后这项 2 检查全过（WebGPU 1164/1455 KB，WebGL 950/1125 KB）；`pack-external` 34 检查全过（打包游戏落在 WebGL2 后端）；最后一次改动（describe 挪文件）后重跑相关 43 项 361 检查和 `pack-external`，check 通过；真显卡那轮在这次挪动之前跑的，没重跑。没跑：全量测试；`--webgl` 游戏没上真显卡；WebGPU 真设备丢失；画面对比 | 通过，未跑项见左 |
| 2026-11-05 | (本分支 docs/webgpu-first) | 文档改成新游戏默认 WebGPU + TSL、`--webgl` 走 GLSL；设计文档第 14 节重写；菜谱 43/44/56/62 和 GLSL 示例加说明。`npm run check` 通过；`doc rules`、`recipe code blocks`、`how` 共 20 项 158 检查全过。 |
| 2026-11-05 | visual/tsl-basics（基于 3b983875） | TSL 风格基础：`celLighting`、`paletteLut`、三种画面示例。Playwright Chromium，WebGPURenderer 走 WebGL2 后备：`style basics`、`three-looks`、`threedog/tsl`、`post on WebGPU`、`api count`、`technique`、`recipe`、`one post entry` 共 24 项 221 检查，首轮 2 项失败（配方代码块用了未声明的变量、示例没进 pullable.json），改后这 2 项 19 检查全过，其余 22 项没再重跑；`check` 通过。真 WebGPU（系统 Chrome 156，NVIDIA Blackwell）：`style basics` 10/10、`three-looks` 8/8、`one post entry` 3/3、`post on WebGPU` 28/28，三张截图页通过；`recipe 56` 5/6，失败的是第 1 块，这条测试只认 WebGL2 后备，真跑时后端是 webgpu，不是这次改的块，master 上没比较过。没跑全量、性能、模板新游戏 | 截图 [field/2026-11-04-tsl-looks/](field/2026-11-04-tsl-looks/)。真 WebGPU 上把最后一个后期效果关掉后，头几帧画面只有背景，几帧后恢复（测试等 6 帧），WebGL2 后备没有这现象，没查原因 |
| 2026-11-05 | (本分支 light/gi-volume-occlusion) | 实时光和遮挡剔除。真 WebGPU（系统 Chrome，RTX 5060）：`light-webgpu` 3 项 8 检查、`occlusion` r=gpu 1 项 7 检查，全过。WebGPURenderer 的 WebGL2 后备和 WebGLRenderer（普通测试）：voxel GI 3、sun shafts 2、light volumes 3、occlusion culling 两项 16，全过；voxelGI 在后备上按设计不运行，只验证它说明了原因。相关回归：post 175、tsl 145、batch 57、hlod 31、raycast 13、api count 3，全过；check 通过。没跑：全量；慢卡（780M）；手机；`voxelGI` 配级联阴影；动起来的 TRAA 拖影；遮挡配 outline normal 模式；遮挡只测了 `watch` 和 hlod 现有用例，hlod、批量接上后的真实隐藏没单独测 | 全过 |
| 2026-11-05 | 审查修复第一批 | R18 清单与引擎文档/游戏文档分级、R13 限制改问类型检查器并查 slot 名、three-looks 首帧、recipe-56 条件、删 templates/webgl、首次加载预算、天空在日历移除后接管信号、绘制前再写一次昼夜、api-count 合并总数 1763：`npm run check`；`npm test -- rule "doc rules" "recipe code blocks" "recipe 56" "bundle size" template "new game" sky calendar "api count"`；`node packages/tools/real-webgpu.mjs three-looks` | check 0 个错误；相关测试全部通过（规则/文档/recipe 380 个检查，sky+calendar 425 个，bundle/template/new game 191 个，api count 3 个）；真实 WebGPU 上 three-looks 9/9 通过 | R13 收紧后没有留下误报（recipe 55 的 type 字面量、recipe 56 的 slot 对象按别名判断放行） |
| 2026-11-05 | fix/review-light（基于 67652e5d） | 复查 GI、体积光、遮挡的修复：换渲染器后重建遮挡盒、额外渲染和阴影掩码排除遮挡盒、留用图层一张表（`threedog/layers`）、特效暂停规则统一、`/webgpu` 子路径改名 `/tsl`。 | `npm run check` 通过。WebGPURenderer 的 WebGL2 后备和 WebGLRenderer（Playwright Chromium）：`post` 175、`occlusion` 24、`voxel GI` 14、`sun shafts` 5、`light volumes` 8、`outline` 42、`hlod` 31、`batch` 57、`raycast` 13、`api count` 3，全过。真 WebGPU（系统 Chrome，NVIDIA Blackwell）：`light-webgpu` 5 项 23 检查、`occlusion` r=gpu 11 检查。 | 真 WebGPU 第一轮 voxelGI 的“关掉后不再花时间”差一点没过（4 ms，上限 3.9 ms），只是计时抖动，重跑通过；其余全过。 |
| 2026-11-05 | e2bc44fd | 全量（WebGPU 默认、TSL 基础、全局光照、遮挡、体积、资源测试、审查修复合并后）：727 项 5206 检查，3 项失败，13.2 分钟。`threedog/tsl` 检查没认 `render/layers.js`（常量表，加入允许）；`how` 两条排序被菜谱 34 新内容挤开（改字、补回 reflections）。修后 check 通过，相关项全过；没再跑全量 | 见左 |
| 2026-11-05 | assets/optimize（基于 546d49e1） | `threedog assets optimize [--dry]`：Meshopt + KTX2（法线 UASTC 线性、颜色 ETC1S sRGB）输出到 public/optimized/，assets.js 指向结果，重跑跳过，逐文件报大小/显存/问题。顺手修了 `npm run assets` 启动即崩（变量 cli 重名）：`npm run check`；`threedog test "assets optimize" assets "cli surface" "api count" "optimized model"`；真 WebGPU `real-webgpu.mjs "optimized model"` | check 通过；相关项全过（assets optimize 11 检查含 KTX2 头校验、原文件字节不变、重跑跳过、--dry 不写文件；assets 系列/cli surface/api count 全过；optimized model 在 WebGL、WebGPU(WebGL2 后备)、真 WebGPU 各 5 检查通过，三处平均色都是 42,42,38，真 WebGPU 转成 BC7，其他两处 ETC2/ASTC） | 用 KTX-Software 4.4.2 的 ktx.exe（本机未装，放临时目录，测试靠 THREEDOG_KTX_DIR；没有 ktx 时 KTX2 部分记为跳过）。光照贴图未压缩（色带未测）；LOD、素材库未做 |
| 2026-11-05 | fix/island-verify（基于 e8cf5fa2） | 海岛两份反馈的修复：无人验证（`?fresh`、`inputLocked` 带原因、`snap --play`、截图写明后端、`snap` 超时说明、脚本等停住的时钟会报错、WebGPU 回退一行）；脚本移动玩家（`placeAt` 站上平台、`manual` 跑 `states`、配方 57/32）；相机默认也测登记的网格。只跑相关项：how、movers、cli surface、mcp、doc rules、api count 175 项检查全过；相机、标题、交互、控制 331 项，1 项是测试写错，改后通过；标题、bridge、shot、recipe 294 项全过；新增检查后 dev bridge 80 项全过（并行跑时有 1 次服务器启动 5 秒超时，单独重跑通过）。`npm run check` 通过。没跑全量。 |
| 2026-11-05 | fix/island-find（基于 e8cf5fa2） | 两个 AI 做同一款岛的反馈：找不到的东西（toast、cel、lut 进 AI.md 和模板表，新增 hud.value 读计数，time.now 与 addBlocked 文档，配方 56 TSL 名单，配方 63 深度水）和误导的提示（frozen-definition 只匹配普通对象，类型检查把 TSL/Fn/兄弟几何体误报改成提示）。`check` 规则 0 错误；相关测试 how 132、template 168、AI tools 12、types guard 15、doc rules 23、recipe code blocks 4、api count 3、hud 67 检查，全过。未跑全量。 |
| 2026-11-05 | fix/review-batch2（基于 6a4b6c70） | 0.7 第二批审查修复：优化失败不动 assets.js；`?fresh` 只认明确的开、发布版链接不删存档；`js --wait` 取代 20 秒规则；站位规则统一（给 y 走台阶规则，不给 y 上最高平台，NPC 有无模型一个答案）；安全点不取不安全或移动的平台；相机遮挡先看标记，关卡和内容道具的遮挡规则；类型提示收紧；文档修正；`check` 分阶段打印；hud 页列出 HudAnchor | `check` 通过；相关测试 2531 项中 2527 过，修完后重跑失败的三组 201 项全过 | 落地那一步移动平台速度还读作 0，安全点被写入（测试查出，已修）；TS 的 `Number<"` 没有能写进探针的代码，这一种没有测试 |
| 2026-11-05 | 950f10f3 | 全量（assets optimize、海岛修复、第 2 次审查、接口清理合并后）：736 项 5262 检查，1 项失败，13.4 分钟。失败是 time channels 的假引擎缺 `movement`，补上后这一项重跑通过；第 3 次审查的文档修复合并后要再跑相关项 | 见左 |
| 2026-11-05 | docs/review3（基于 950f10f3） | 文档审查第三批：FAQ/README/design 的“还没进引擎”和“每个效果两种写法”改成现状；四个只有 TSL 的效果在四种情况下的表格；CHANGELOG、MIGRATING-0.7、AI.md、README 入口表补全；配方 52/56 加“从哪里导入”；lightVolumes 的 `resolution` 改名 `scale`；occlusion 用词与三种遮挡区分；层表注明 OUTLINE_OFF_LAYER。map、check（0 错）；how 132/132、doc rules 23/23、recipe code blocks 4/4、api count 3/3、light volumes 8/8 |
| 2026-11-05 | d3958d58 | 0.7 候选版全量：736 项 5263 检查，0 失败，12.2 分钟。普通测试到 WebGL2 后端，真 WebGPU 另由 `real-webgpu.mjs` 分批跑过 | 全过 |
| 2026-11-05 | release/0.7.0（ccc0b1ef、4449309c） | 0.7.0 发版准备：全量 736 项 5263 检查 0 失败（13.8 分钟）；`pack-external` 34 检查 0 失败，打包后的游戏在无头环境没有显卡，退到 WebGL2 跑；公开副本 `npm ci`、check、build、`npm pack --dry-run` 通过 | 全过 |

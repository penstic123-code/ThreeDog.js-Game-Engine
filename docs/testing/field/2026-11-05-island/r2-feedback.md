# 《海风小岛》反馈

## 做完了什么、没做完什么（按 TASK.md 的清单）
做完并实测过（脚本跑过或截图看过）：
- 约 120 米的风格化海岛：起伏地形、缓坡、小山、沙滩、岸边浅水带泡沫、带波光的海面、渐变天空加太阳、会飘的云、雾。
- 树（阔叶树三种、沙滩椰树）、灌木、约 16000 簇草（风吹摆动）、花田（约 800 朵）、岩石。树叶和草的摆动是 TSL 顶点位移。
- 小木屋、栅栏、码头、小木船、灯塔（红白条纹、螺旋坡道、栏杆）。
- WASD、鼠标转镜头（pointerLock）、Shift 跑、空格跳。
- 老人 NPC 对话，按进度换台词，带“在哪找”的提示。
- 5 个风之碎片：草地、花田、西边沙滩、山顶、礁石。任务条、方向箭头、HUD 计数。
- 可采：9 朵大花、6 个苹果、6 个贝壳、一个漂在海边的木箱（计数都在 HUD 右上）。
- 小木船：在码头按 E，自动航行约 11 秒到礁石区，到后下船；在礁石区按 E 可以坐回来。脚本跑了一个来回，正常。
- 灯塔：沿螺旋坡道走一圈到顶（脚本走过，y 从 0.57 到 8.2）。碎片不够时给提示，够了触发结局（灯光变亮、光束、镜头绕转、终幕文字，可“继续探索”或“再玩一次”）。
- 存档：碎片、花、苹果、贝壳、船位置、是否通关都进存档（自己的状态用 `engine.saves.register`，拾取用 `once`）。
- 声音：风、海浪、鸟鸣用引擎自带合成器，脚步声用 `footstep`。**声音我没有听到过，只能确认没报错**。

没做完或不够好：
- “简单攀爬”：没有做抓边攀爬，只有螺旋坡道和跳跃。如实说，这一条算部分完成。
- 船是自动航行，不能自己划。
- 结局动画比较朴素（光束加镜头转加文字），不是电影式的。
- 游玩时的真实 WebGPU 没验证：无头浏览器没有 WebGPU，全程跑在 WebGL2 回退上，画面检查也是这个后端。
- 主角是积木拼的小人，腿和手臂用代码摆动，不是骨骼动画。
- 没写测试文件（用 eval 脚本验证的，没留成 `tests/specs`）。
- 草地上自己的阴影有些大块暗斑（草不投影，但树和灌木的影子偏重）。没有花时间再调。
- `npm run check` 剩下 0 个错误，几个 R1/R40 警告没处理。

## 卡住的地方
1. 开头找 node_modules：游戏目录里没有 `node_modules`，文档在上两层的 `node_modules/threedog/docs`。找了约 2 次工具调用，靠 `ls` 上一层解决。CLAUDE.md 里写的路径 `node_modules/threedog/docs/recipes/` 在这个目录下并不存在。
2. 用 `eval` 在无头页上走路测试，约 8 次调用：
   - `walkTo` 在“游戏冻结”的无头页里不动，脚本卡住 120 秒被后台化。
   - 后来换成 `engine.control.take(...)` 的 `move`，再配 `engine.step`，才走通。每一步错误信息都给了下一步写法，这部分很顺。
3. 船载人：先用 `characters.support(boat)`，玩家实际站在海底（y=-3），摄像机也跟着到水下。约 3 次调用定位到。最后改成 `setGround` 的高度函数里，船航行时给船周围一个圆形甲板高度。是个凑合的做法，已写 `shortcut` 注释。
4. 页面标题界面一直挡着：HMR 重载后，无头页回到标题，`eval` 里调 `session.newGame()` 没关掉它，`interaction.use` 一直返回 `inputLocked`。约 4 次调用，靠 `threedog press Enter` 加 `threedog resume` 解决。
5. 一处自己的疏忽：通关后把船交互禁用了（`disabled`），因为存档带着 `ended=true`，花了 2 次调用才发现。

## 查找失败
- `threedog how "third person walk jump"`：命中了 recipe 63，很准。
- 没找到弹出提示（toast）的 API。我 grep 了 `toast`，只找到 `quests({ notify })` 和选项里的 `ui.toast` 描述，没有 `engine.ui.toast(text)` 这样的调用，最后自己写了一个 DOM 提示。想要的是“一行文字弹一下”。
- 没找到“HUD 计数器随 interaction 的 `counter` 自动加”后怎么读值。我改成自己维护 `game` 状态并每次重设 `hud.counter`。
- 没找到在“冻结的无头页里走路”的说明，是靠错误信息才知道 `control.take`。
- 想查 `collision.addBlocked` 里能不能读 `engine.ground`：文档只说 “fn must be pure”。我读了外部的 `engine.ground.height`，现在跑得通，但不确定是不是保证行为。

## 写错的引擎名字
- `placeAt([x, z])`：对的是 `placeAt({ x, z })`，错误信息说清楚了。
- 一开始想用 `engine.session.newGame()` 实现“再玩一次”，不确定它会不会重置我自己建的场景物体，改成 `location.reload()`。
- `engine.cameraRig.view`：类型检查说不存在，我改成自己记 yaw，再调 `cameraRig.setView`。
- 其余引擎名字（`createPlayer`、`interactions.add`、`dialogue.define`、`quests.define`、`hud.counter`、`collision.addCircle/addBox`、`setGround`）一次写对。

## 有帮助的 / 没帮助的错误信息
有帮助：
- `A horizontal position needs finite x and z: pass [x, y, z] ... or { x, z }`：直接告诉了写法。
- `character 'player' is controlled by 'walkTo' ... Fix: engine.control.take(ch, { owner, layer })`：照着改就通了。连续两个 `control-conflict` 也都给了下一步。
- 类型检查（`npm run check`）指出的 `best.x`、`cameraRig.view`，行号准确。
没帮助：
- `interaction.use` 返回 `inputLocked`，但没说是“标题界面还开着”还是“对话中”。我花了几次才查到。
- `snap` 在页面卡住时只报 `page.screenshot: Timeout 30000ms exceeded`，没说页面在忙什么。
- 无头页的 WebGPU 回退警告很吵，每次都出现在 errors.log，容易把真错误盖住。

## 调画面用了多少次
- 跑游戏看图：`snap` 2 次（第 1 次被标题界面挡住，浪费了），`shot --play` 共 10 次（起点、码头、灯塔、山、花田、沙滩两次、礁石、第一次的整体）。
- 看图后的改动只有两处：海面波光点太规则像点阵，改成三个正弦相乘并降低强度；其余画面第一次出来就能用。
- 没有用 `threedog art board` 或 `lib list`。

## 我会改引擎或文档的地方
1. 文档里统一写清 node_modules 的位置，或在游戏目录里放一个到文档的链接。
2. 增加一个标准的 toast / 提示条 API，小游戏几乎都要“拾取了 X”。
3. `interaction` 的 `counter` 说明里写清读取和 `hud.counter` 值的关系，或让 `hud.counter` 能直接读。
4. 给“船/筏/电梯这种载人物”一个最小例子：`characters.support` 要求什么形状的碰撞才能站得住。现在文档只有一句话，我的船没有站住。
5. 无头 `eval` 里 `inputLocked` 的原因写进错误的 `facts`（例如 `{ by: 'title' }`）。
6. `threedog snap` 或 `shot` 要有 “--play” 的统一说法，我走了弯路才发现 `snap` 不带标题跳过。
7. 引擎自带一个“简单爬坡/抓边”的现成状态例子（`states` 选项里提到了 climb），但配方里没有完整做法，我就没敢用。

# cove 反馈

## 做完了
- 第三人称走动和转镜头（followCamera，没开指针锁定）。
- 小船停岸边，走近按 E 上船，船自己开到对岸，再按 E 下船。
- 岛上有土丘高台，能走上去；顶上有宝石，E 拾取后弹 toast，右上角 Gems 加一。
- 5 棵树、1 座带屋顶的小屋（有碰撞）。
- 卡通画面：MeshToonNodeMaterial + celLighting 三档平涂，outline 后处理描边，无色调映射。
- 测试 `tests/specs/cove.mjs`：开始、走到码头、上船、过海、下船、爬高台、拾宝，连跑 3 次都过。
- 看了一张 `threedog shot --play` 的图，只看了出生点镜头，岛和高台没拍。

## 没做完 / 不够好
- 玩家还是灰色胶囊；船上没有人形，只是把胶囊挪到船上。
- 船只能单程，岛上不能再坐回去。
- 存档只存了船的状态，没测读档（没跑 npm run check，见下）。
- 没写 DESIGN.md / STATUS.md，没跑 npm run map。
- 树冠阴影边缘有锯齿感；水只是一块半透明平面，没有岸线泡沫。
- 船上船下靠“每步直接改玩家位置”，没用 characters.support；没试它是否更好。

## 卡住的地方
- `npm run check` 跑了 2 分钟以上没输出，我把它停了，最后没跑成。原因没查（可能是类型检查慢）。约损失 4 分钟。
- 用 bash 的 `node -e "..."` 改 main.js 时反引号被 shell 吃了，改动静默没生效，约 3 分钟后才发现。后来写成脚本文件才行。
- 测试里 `player.move()` 报 control-bypass，错误信息直接给了修法（engine.control.take），1 分钟。
- 测试一开始点不动：标题界面锁输入（inputLocked, by title）。错误信息给了 applyState({play:true})，但要等几帧才生效，我多试了两次，约 3 分钟。
- 走到码头失败：目标点 -6.5 在水里被 addBlocked 拦住，自己算错坐标，改成 -8。

## 查不到的东西
- 想知道 HudAnchor 有哪些值：api/hud.md 里没写，查 types/gameplay.d.ts 才找到。
- 想知道 characters.support 能不能当水上的船：文档只写“平台、电梯、筏”，没说水面上能不能站。
- 想要“玩家被脚本接管时锁住输入”的一句话做法（坐船时）：没找到，我是每步直接覆盖位置。
- 想要“post-effects 包在哪”：文档说 `@threedog/post-effects`，实际在 R3/node_modules，游戏目录下没有 node_modules，一开始我以为没装。

## 名字写错的
- 没有写错的引擎名字。一开始 e.player.move 的用法错了（见上），测试里 interaction 用的是 ops `interaction.use`，是读文档找到的，一次对。

## 画面用到的引擎功能和怎么找到的
- `rampTexture` + `celLighting`（threedog/tsl）：读 recipes/56 的 “A consistent style” 一节，grep celLighting 找到。
- `outline({ mode: 'both' })`：recipes/52 的后处理段，grep outline 找到。
- `engine.setGround({ height })` + `collision.addBlocked`：recipes/63 和 api/engine.md。
- `interactions.add`（label 用函数）、`hud.counter(anchor)`、`toast`：api/interactions.md、api/hud.md、CLAUDE.md 表格。
- 地形、水面、树、屋、船、宝石都是自己写的普通 three.js（cove.js），没用引擎的地形或水模块。

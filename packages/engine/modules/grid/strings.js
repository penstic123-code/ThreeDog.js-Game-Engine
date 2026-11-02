// Player text for the grid failure codes (string table grid.<code>, zh-CN and en), registered when grids() installs, like the other modules' default
// text. A game shows a failure with engine.t('grid.' + r.code) and overrides any line with engine.i18n.add. Codes the game makes itself (its own
// can, a layer rule's not<Field> such as notTilled) need their own grid.<code> line.
// 为什么在引擎里：recipe 一直让游戏写 engine.t('grid.' + r.code)，但没有这些键，玩家看到的是 [unknown-name]；内置文字由模块自带是引擎别处的做法（inventory.full 等）。
export const STRINGS = {
  'zh-CN': { 'grid.rotate': '旋转', 'grid.outOfBounds': '超出范围了', 'grid.occupied': '这里已经有东西了', 'grid.wrongGround': '这块地面不能放',
    'grid.notFlat': '地面不够平', 'grid.noGrid': '没有这个网格', 'grid.idTaken': '这个编号已经有了', 'grid.unknown': '找不到这件东西',
    'grid.notPlaced': '它不在网格上', 'grid.noTarget': '先指向一个格子', 'grid.badFields': '用了保留的字段名' },
  en: { 'grid.rotate': 'Rotate', 'grid.outOfBounds': 'Out of bounds', 'grid.occupied': 'Something is already here', 'grid.wrongGround': 'Cannot go on this ground',
    'grid.notFlat': 'The ground is not flat enough', 'grid.noGrid': 'No such grid', 'grid.idTaken': 'That id is already taken', 'grid.unknown': 'Nothing with that id',
    'grid.notPlaced': 'It is not on a grid', 'grid.noTarget': 'Point at a cell first', 'grid.badFields': 'Uses a reserved field name' },
};

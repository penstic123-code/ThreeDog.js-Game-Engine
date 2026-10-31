// Player-control error texts, i18n strings and the control check (split out of index.js)
// The engine picks no player feel: control has no default (genericity rule: core carries no preset). A preset is one spread away, so the error names it first.
const CONTROL_FIX = "pick how the player moves: createPlayer({ ...presets.player.thirdPerson, spawn }) (import { presets } from 'threedog'), " +
  "control: 'camera' (keys relative to the camera), control: 'none' (the game calls player.move() itself) or a function (player, input, dt) => ({ x, z, run?, speed? })";
export const DEV_STRINGS = { noControl: 'characters.createPlayer(): no control given; ' + CONTROL_FIX,
  badControl: "characters.createPlayer(): control {got} is not a control; " + CONTROL_FIX + ". (true / false were renamed 'camera' / 'none')",
  noFollow: "characters.createPlayer(): a camera module is installed but cameraFollow was not given, so the camera does not follow the player. " +
    'Pass cameraFollow: true (presets.player.* do), or cameraFollow: false if the game aims the camera itself',
  noWorld: 'characters.createPlayer() needs world() installed first: the player is a record in world (position is saved, world splits near/far by it). Use engine.use(world(), …); openWorld() already installs it' };
export const STRINGS = { 'zh-CN': { 'npc.talk': '和{name}说话', 'input.jump': '跳跃', 'input.brake': '刹车' }, en: { 'npc.talk': 'Talk to {name}', 'input.jump': 'Jump', 'input.brake': 'Brake' } };

export const validControl = c => c === 'camera' || c === 'none' || typeof c === 'function';

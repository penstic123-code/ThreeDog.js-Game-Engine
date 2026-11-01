// Rule R33 on fixture texts: startup calls that create something saved whole are errors, world.add initial anywhere is an error, code managing a
// world model is a warning; startup engine.add / colliders / interactions (rebuilt by code every start) are fine.
import { scanText } from '../rules/R33-authored-placement.mjs';

export const name = 'rule R33: saved-whole creation at setup, world models managed by code';

const found = (text, level) => scanText(text).filter(r => !level || r.level === level).length;
const flagged = (text, n = 1, level) => found(text, level) === n;

export async function run({ check }) {
  // errors: saved whole, so a load restores it and the startup code makes it again
  check('top-level world.add is an error', flagged("engine.world.add({ kind: 'crate', position: [0, 0, 0] });\n", 1, 'error'));
  check('level:loaded handler with world.add is an error', flagged("engine.events.once('level:loaded', () => engine.world.add({ kind: 'gate', position: p }));\n", 1, 'error'));
  check('engine.spawn and engine.spawn at setup are errors', flagged("engine.spawn('chest', { x: 1, z: 2 });\nengine.spawn('chest', { x: 3, z: 4 });\n", 2, 'error'));
  check('spawnPickup / npcs.add / entities.spawn in engine:ready are errors', flagged("engine.events.on('engine:ready', () => {\n  engine.inventory.spawnPickup('apple', p);\n  engine.npcs.add(def);\n  engine.entities.spawn('wolf', {});\n});\n", 3, 'error'));
  check('a function called from setup is setup (one level)', flagged("function seed() { engine.spawn('chest', p); }\nseed();\n", 1, 'error'));
  check('install method of a module is setup', flagged("const mod = { install(e) { e.world.add({ kind: 'a' }); } };\n", 1, 'error'));
  check('forEach at top level keeps the setup context', flagged("[1, 2].forEach(i => engine.spawn('rock', { x: i, z: 0 }));\n", 1, 'error'));
  check('world.add with initial: true is an error even inside an op', flagged("engine.ops.define('x', { run: e => e.world.add({ id: 'a', kind: 'a' }, { initial: true }) });\n", 1, 'error'));

  // allowed: rebuilt by code every start
  check('startup engine.add / scene.add / colliders / rigid / interactions / rays / grids / stream are fine', flagged('engine.add(windmill, { id: \'windmill\' });\nengine.scene.add(sky);\n'
    + "engine.collision.addBox({ x: 0, z: 0 }, { halfWidth: 1, halfDepth: 1 });\nengine.rigid.addBox(m, { mass: 4 });\nengine.interactions.add(m, { label: 'Use' });\n"
    + "engine.rays.addStatic(m);\nengine.grids.add('farm', {});\nengine.stream.add({ at, build });\nengine.inventory.container('chest', { items: { gold: 3 } });\n", 0));
  check('world.add with save: false at setup is fine (not saved)', flagged("engine.world.add({ kind: 'marker' }, { save: false });\n", 0));
  check('engine.spawn inside an op run is fine', flagged("engine.ops.define('chest.build', { run: (e, { x, z }) => e.spawn('chest', { x, z }).id });\n", 0));
  check('spawns in onFixed / onFrame / other events are fine', flagged("engine.onFixed(() => engine.entities.spawn('wolf', {}));\n"
    + "engine.events.on('item:add', () => engine.inventory.spawnPickup('apple', p));\n", 0));
  check('a line tagged // runtime: <reason> is not flagged', flagged("engine.world.add({ kind: 'a' });   // runtime: debug marker, removed before save\n", 0));
  check('a tag without a reason does not count', flagged("engine.world.add({ kind: 'a' });   // runtime:\n"));
  check('Set.add / group.add are not findings', flagged('const s = new Set(); s.add(1); group.add(mesh);\n', 0));

  // warnings: code managing a model world places every frame
  check('engine.add of a world.view() model warns', flagged("engine.onFrame(() => engine.add(engine.world.view('chest-1')));\n", 1, 'warn'));
  check('writing a world model transform warns (direct, through a const, .set)', flagged("engine.world.view('a').position.x = 3;\nconst m = engine.world.view('b');\nm.rotation.y += 1;\nm.position.set(0, 1, 0);\n", 3, 'warn'));
  check('the model in present update is not flagged', flagged("engine.world.present('chest', { build, update(rec, obj) { obj.rotation.y = rec.rot; } });\n", 0));
}

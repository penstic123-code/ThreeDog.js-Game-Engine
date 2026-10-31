// Rule R33 (no authored placement in game code) on fixture texts: setup-time placements are flagged, runtime ones are not.
import { scanText } from '../rules/R33-authored-placement.mjs';

export const name = 'rule R33: authored placement in game code';

const flagged = (text, n = 1) => scanText(text).length === n;

export async function run({ check }) {
  check('top-level engine.add is flagged', flagged('const m = new THREE.Mesh();\nengine.add(m);\n'));
  check('engine:ready handler with rigid.addBox is flagged', flagged("engine.events.on('engine:ready', () => {\n  engine.rigid.addBox(m, { mass: 4 });\n});\n"));
  check('level:loaded handler with world.add is flagged', flagged("engine.events.once('level:loaded', () => engine.world.add({ kind: 'gate', position: p }));\n"));
  check('forEach at top level keeps the setup context', flagged('[1, 2].forEach(i => engine.collision.addBox(p, { halfWidth: 1, halfDepth: 1 }));\n'));
  check('a function called from setup is setup (one level)', flagged('function buildArena() { engine.add(wall); }\nbuildArena();\n'));
  check('install method of a module is setup', flagged('const mod = { install(e) { e.add(ground); } };\n'));
  check('world.add with initial: true is flagged even inside an op', flagged("engine.ops.define('x', { run: e => e.world.add({ kind: 'a' }, { initial: true }) });\n"));
  check('inventory.container with items at top level is flagged', flagged("engine.inventory.container('chest', { capacity: 4, items: { gold: 3 } });\n"));

  check('content.spawn inside an op run is not flagged', flagged("engine.ops.define('chest.build', { run: (e, { x, z }) => e.content.spawn('chest', { x, z }).id });\n", 0));
  check('spawns in onFixed / onFrame / other events are not flagged', flagged("engine.onFixed(() => engine.entities.spawn('wolf', {}));\n"
    + "engine.onFrame(() => engine.add(fx));\nengine.events.on('item:add', () => engine.inventory.spawnPickup('apple', p));\n", 0));
  check('rigid body in a world.present build is presentation, not flagged', flagged("engine.events.on('engine:ready', () => engine.world.present('body', { build(rec) { engine.rigid.addBox(m); return m; } }));\n", 0));
  check('a function never called at setup is not flagged', flagged("function drop() { engine.inventory.spawnPickup('apple', p); }\nengine.onFixed(drop);\n", 0));
  check('a line tagged // runtime: <reason> is not flagged', flagged('engine.add(gizmo);   // runtime: debug gizmo, never saved\n', 0));
  check('a tag without a reason does not count', flagged('engine.add(gizmo);   // runtime:\n'));
  check('inventory.container without items and level({ scene }) are not flagged', flagged("engine.inventory.container('chest', { capacity: 4 });\nengine.use(level({ scene: ground }));\n", 0));
  check('Set.add / group.add are not placements', flagged('const s = new Set(); s.add(1); group.add(mesh);\n', 0));
}

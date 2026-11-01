// Rule R40 (bypass hints) on fixture texts: each hint fires on the hand-rolled pattern, stays quiet on the neighbouring plain use, is warn-only,
// and can be switched off per line, per file and per project.
import { scanText, activeKinds, KINDS } from '../rules/R40-bypass-hints.mjs';

export const name = 'rule R40: bypass hints (positive and negative samples, switches)';

const kinds = (text, active) => scanText(text, active).map(r => r.kind).join();

export async function run({ check }) {
  // timers
  check('setInterval for game timing -> timers', kinds('setInterval(() => spawnWave(), 5000);\n') === 'timers');
  check('setTimeout with a delay -> timers', kinds('setTimeout(() => door.open(), 1500);\n') === 'timers');
  check('await-delay helper setTimeout(resolve, ms) is not flagged', kinds('await new Promise(resolve => setTimeout(resolve, 200));\n') === '');
  check('setTimeout(fn, 0) is not flagged', kinds('setTimeout(() => init(), 0);\n') === '');
  check('a presentation tag lets timers through', kinds('setTimeout(fade, 300);   // presentation: fade-out\n') === '');
  check('engine.clock.after is not flagged', kinds('engine.clock.after(2, () => door.open());\n') === '');
  check('the word in a comment or a string is not flagged', kinds('// we used setInterval( once\nconst s = "setTimeout(x)";\n') === '');

  // random
  check('Math.random in gameplay -> random', kinds('const drop = Math.random() < 0.2 ? "gem" : "coal";\n') === 'random');
  check('engine.random is not flagged', kinds('const drop = engine.random.chance(0.2) ? "gem" : "coal";\n') === '');
  check('Math.random tagged presentation is fine (line and line above)', kinds('const j = Math.random();   // presentation\n') === '' && kinds('// presentation: pitch jitter\nconst j = Math.random();\n') === '');

  // inventory
  check('a hand-made inventory array -> inventory', kinds('const inventory = [];\nfunction pick(i) { inventory.push(i); }\n') === 'inventory');
  check('this.backpack = {} counts too', kinds('class P { constructor() { this.backpack = {}; } }\n') === 'inventory');
  check('a file that uses engine.inventory is not flagged', kinds('const bag = {};\nengine.inventory.add("gem", 1);\n') === '');
  check('inventory() installed in the file is not flagged', kinds('const inv = [];\nengine.use(inventory({}));\n') === '');
  check('unrelated arrays are not flagged', kinds('const items = [];\nconst bagOfTricks = foo();\nconst invoice = {};\n') === '');

  // grid
  const bilinear = 'const x0 = Math.floor(u), z0 = Math.floor(v), tx = u - x0, tz = v - z0;\nconst a = heights[z0 * W + x0], b = heights[z0 * W + x0 + 1];\nreturn a * (1 - tx) + b * tx;\n';
  check('bilinear over a heights array -> grid (one finding)', kinds(bilinear) === 'grid');
  check('a file that uses sampleGrid is not flagged', kinds('const h = sampleGrid(heights, o);\n' + bilinear) === '');
  check('a plain height read without a blend is not flagged', kinds('const y = heights[j * W + i];\n') === '');
  check('a blend over something else is not flagged', kinds('const t = Math.floor(x);\nconst c = colors[t] * (1 - f) + colors[t + 1] * f;\n') === '');

  // material
  check('new MeshStandardMaterial with a color -> material', kinds('const m = new THREE.MeshStandardMaterial({ color: 0x8844aa });\n') === 'material');
  check('constructor plus a later color edit -> material', kinds('const m = new MeshBasicMaterial();\nm.color.set(0xff0000);\n') === 'material');
  check('makeMaterial is not flagged', kinds("const m = makeMaterial('prop');\nm.color.set(0xff0000);\n") === '');
  check('a material without any color is not flagged', kinds('const m = new THREE.MeshStandardMaterial({ roughness: 1 });\n') === '');

  // warnings only, with the three parts of the message
  const r = scanText('setInterval(tick, 1000);\n')[0];
  check('level is warn, message names what was seen, the system and how to switch off', r.level === 'warn' && /setInterval/.test(r.msg) && /engine\.clock/.test(r.fix) && /DESIGN\.md/.test(r.fix) && /hint-off\(timers\)/.test(r.fix));

  // switches
  check('// hint-off on the line silences every hint there', kinds('setInterval(tick, 1000);   // hint-off: poller for the backend\n') === '');
  check('// hint-off(random) names a kind; others still fire', kinds('const a = Math.random(), t = setInterval(f, 9);   // hint-off(random)\n') === 'timers');
  check('// hint-off on the whole line above works', kinds('// hint-off(timers)\nsetInterval(tick, 1000);\n') === '');
  check('a hint-off two lines up does not', kinds('// hint-off(timers)\nconst x = 1;\nsetInterval(tick, 1000);\n') === 'timers');
  check('// hint-off-file at the top silences the file (all or named)', kinds('// hint-off-file\nsetInterval(a, 1);\nMath.random();\n') === ''
    && kinds('// hint-off-file(random)\nsetInterval(a, 1);\nMath.random();\n') === 'timers');
  check('project setting: false switches all off, a map switches named kinds', activeKinds(false, undefined).size === 0 && activeKinds({ random: false }, undefined).has('timers')
    && !activeKinds({ random: false }, undefined).has('random') && activeKinds(undefined, undefined).size === KINDS.length);
  check('THREEDOG_HINTS=off switches all off', activeKinds(undefined, 'off').size === 0);
  check('scanText honors the active set', kinds('Math.random();\nsetInterval(a, 1);\n', new Set(['timers'])) === 'timers');
}

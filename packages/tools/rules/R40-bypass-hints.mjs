// R40 bypass hints (warnings only, never errors): game code (games/*, engine examples; not the engine itself, R4/R19-R21 cover that) that hand-rolls
// something an engine system already does. Each warning says what was seen, which system covers it, and how to say "this is on purpose".
//   timers     setInterval / setTimeout for game timing                 -> engine.clock.after / every, or onFixed (pause, step and saves see them)
//   random     Math.random() in gameplay code                           -> engine.random (seeded: replay and saves reproduce it)
//   inventory  a hand-made items / backpack array or object             -> the inventory module (add / remove / has, containers, saves, events)
//   grid       bilinear blending over a height / field array            -> sampleGrid (nearest / linear / cubic, edges, image input)
//   material   new THREE.Mesh*Material with color set by hand           -> makeMaterial(role) / look.materials (style packs and looks reach it)
// Patterns are line based, with context (the inventory hint needs a declaration and no use of the module in that file; the grid hint needs a floor, a
// height-like array read and a blend within a few lines; the material hint needs a color too), so a plain use of the same word does not fire.
// Not flagged: tests, docs and scripts folders, tagged presentation code (the same tags as R4: // presentation, // measure, // debug, // wall-clock,
// // main-loop), setTimeout(resolve, ...) delays, setTimeout(fn, 0).
//
// Switching off. Per line (this line or the whole-line comment above): `// hint-off` for every hint, or `// hint-off(random, timers)` for named ones.
//   Whole file (one of the first 30 lines): `// hint-off-file` or `// hint-off-file(material)`.
//   Whole project: package.json  "threedog": { "hints": false }  (all), or { "hints": { "random": false, "timers": false } } (named kinds);
//   one run: THREEDOG_HINTS=off npm run check. Kinds: timers random inventory grid material.
// If you have a reason, write it in DESIGN.md under Systems (what you built by hand and why), so the next reader and the next AI see it.
import { readFileSync, existsSync } from 'node:fs';
import { walk, lines, codeOnly, ROOT, P } from './_lib.mjs';

export const KINDS = ['timers', 'random', 'inventory', 'grid', 'material'];
const R4_TAGS = ['presentation', 'measure', 'debug', 'wall-clock', 'main-loop'];
const HOW = 'a reason? write it in DESIGN.md (Systems), or switch the hint off: // hint-off(KIND) on the line, // hint-off-file(KIND) at the top, or package.json "threedog": { "hints": { "KIND": false } }';

const SAY = {
  timers: ['setInterval / setTimeout used for game timing',
    'engine.clock.after(seconds, fn) / engine.clock.every(seconds, fn), or accumulate dt in engine.onFixed (they follow pause, step and saves)'],
  random: ['Math.random() in game code', 'engine.random (seeded: next / range / int / pick / chance; replays, tests and saves get the same numbers)'],
  inventory: ['a hand-made inventory (items kept in your own array / object)',
    'the inventory module: engine.use(inventory()), engine.inventory.add / remove / has (counts, containers, events, saved with the game)'],
  grid: ['blending over a height / field array by hand', 'sampleGrid(data, { width, height, size, interp }) -> (x, z) => value; engine.assets.gridFromImage reads one from a PNG'],
  material: ['a three.js material built by hand with its color set in game code', "makeMaterial('role') / look.materials, so style packs and looks reach it (hard rule 1)"],
};

/** Hints that stay on for the project: package.json "threedog.hints" (false / 'off' / { kind: false }) and THREEDOG_HINTS=off. Returns a Set of kinds */
export function activeKinds(pkgHints, env = process.env.THREEDOG_HINTS) {
  if (env === 'off' || pkgHints === false || pkgHints === 'off') return new Set();
  const off = pkgHints && typeof pkgHints === 'object' ? KINDS.filter(k => pkgHints[k] === false) : [];
  return new Set(KINDS.filter(k => !off.includes(k)));
}

/** Kinds a hint-off comment names: null = no such comment, KINDS = all of them */
function offKinds(comment, word) {
  const m = comment.match(new RegExp(`${word}(?!-)(?:\\(([^)]*)\\))?`));
  if (!m) return null;
  return m[1] ? m[1].split(',').map(s => s.trim()) : KINDS;
}
const commentOf = s => s?.match(/\/\/(.*)$/)?.[1] ?? s?.match(/\/\*(.*?)\*\//)?.[1] ?? '';
const wholeLineComment = s => /^\s*(\/\/|\/\*)/.test(s || '');

/**
 * Hints in a text: [{ level: 'warn', line, kind, msg, fix }]. active: the kinds that stay on (default all).
 * @param {string} text @param {Set<string>} [active]
 */
export function scanText(text, active = new Set(KINDS)) {
  const L = text.split('\n'), out = [];
  const fileOff = new Set(L.slice(0, 30).flatMap(l => offKinds(commentOf(l), 'hint-off-file') ?? []));
  const lineOff = i => new Set([...(offKinds(commentOf(L[i]), 'hint-off') ?? []), ...(wholeLineComment(L[i - 1]) ? offKinds(commentOf(L[i - 1]), 'hint-off') ?? [] : [])]);
  const tagged = i => R4_TAGS.some(t => commentOf(L[i]).includes(t) || (wholeLineComment(L[i - 1]) && commentOf(L[i - 1]).includes(t)));
  const add = (i, kind) => {
    if (!active.has(kind) || fileOff.has(kind) || lineOff(i).has(kind)) return;
    const [what, use] = SAY[kind];
    out.push({ level: 'warn', line: i + 1, kind, msg: `${what}: ${L[i].trim().slice(0, 80)}`, fix: `use ${use}. If you have a reason: ${HOW.replaceAll('KIND', kind)}` });
  };
  const code = L.map(l => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : codeOnly(l)));
  const whole = code.join('\n');
  const usesInventory = /\b(engine|e|eng)\.inventory\b|\binventory\(\s*[{)]/.test(whole);
  const usesGrid = /\bsampleGrid\b/.test(whole);
  const colorEdits = /\.color\.(set|setHex|setRGB|copy|lerp|multiplyScalar)\(|\.color\s*=[^=]/.test(whole);
  code.forEach((c, i) => {
    if (!c.trim()) return;
    if (/\b(setInterval|setTimeout)\s*\(/.test(c) && !tagged(i) && !/setTimeout\s*\(\s*(r|res|resolve|done)\b/.test(c) && !/setTimeout\s*\([^,]*,\s*0\s*\)/.test(c)) add(i, 'timers');
    if (/\bMath\.random\s*\(/.test(c) && !tagged(i)) add(i, 'random');
    if (!usesInventory && /(?:\b(?:const|let|var)\s+|\bthis\.)(inventory|backpack|bag|pockets|inv)(?:Items|Slots|List|Contents|Data|Map|Counts?|s)?\s*=\s*(\[\s*\]|\{\s*\}|new Map\b|new Set\b)/i.test(c)) add(i, 'inventory');
    if (/\bnew\s+(?:THREE\.)?Mesh(?:Basic|Standard|Lambert|Phong|Toon|Physical|Matcap)?Material\s*\(/.test(c) && (colorEdits || /\bcolor\s*:/.test(c))) add(i, 'material');
    // grid: a floor, a height-like array read and a blend ((1 - t), lerp, mix) within 6 lines
    if (!usesGrid && /\b(heights?|heightmap|hm|elevation|terrainData|heightData|field)\w*\s*\[/i.test(c)) {
      const win = code.slice(Math.max(0, i - 6), i + 7).join('\n');
      if (/Math\.floor\(/.test(win) && /\(\s*1\s*-\s*\w+\s*\)|\blerp\s*\(|\bmix\s*\(/.test(win)) add(i, 'grid');
    }
  });
  // one hint per kind per 7 lines (a blend over four array reads is one finding)
  return out.filter((r, k) => !out.slice(0, k).some(p => p.kind === r.kind && r.line - p.line < 7));
}

export default {
  id: 'R40', title: 'Bypass hints: hand-rolled versions of engine systems in game code (warnings only)', game: true,
  run() {
    let pkg = {};
    try { const f = `${ROOT}/package.json`; if (existsSync(f)) pkg = JSON.parse(readFileSync(f, 'utf8')); } catch { /* unreadable package.json: no project setting */ }
    const active = activeKinds(pkg.threedog?.hints);
    if (!active.size) return Object.assign([], { note: 'bypass hints are switched off for this project' });
    const out = [];
    for (const f of [...walk(P.GAMES_REL, ['.js', '.mjs']), ...walk(P.EXAMPLES_REL, ['.js', '.mjs'])]) {
      if (/(^|\/)(tests|docs|scripts)\//.test(f)) continue;
      let text; try { text = lines(f).join('\n'); } catch { continue; }
      for (const r of scanText(text, active)) out.push({ ...r, file: f });
    }
    return out;
  },
};

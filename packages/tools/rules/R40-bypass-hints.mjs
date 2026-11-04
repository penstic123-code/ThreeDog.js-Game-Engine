// R40 bypass hints (warnings only, never errors): game code (games/*, engine examples; not the engine itself, R4/R19-R21 cover that) that hand-rolls
// something an engine system already does. Each warning says what was seen, which system covers it, and how to say "this is on purpose".
//   timers     setInterval / setTimeout for game timing                 -> engine.clock.after / every, or onFixed (pause, step and saves see them)
//   random     Math.random() in gameplay code                           -> engine.random (seeded: replay and saves reproduce it)
//   inventory  a hand-made items / backpack array or object             -> the inventory module (add / remove / has, containers, saves, events)
//   grid       bilinear blending over a height / field array            -> sampleGrid (nearest / linear / cubic, edges, image input)
//   save       localStorage.setItem of a save (a save-like key, or JSON of state) -> engine.saves (versions, a corrupt save, slots, Continue on the start screen)
//              A remembered preference (a volume, a language) is not a save and stays quiet; so is a file that uses engine.saves.
//   pause      an Esc handler or a paused flag of its own, in a file with no settings / flow / freeze -> settings({ freezeWorld: true })
// Patterns are line based, with context (the inventory hint needs a declaration and no use of the module in that file; the grid hint needs a floor, a
// height-like array read and a blend within a few lines), so a plain use of the same word does not fire.
// Not flagged: tests, docs and scripts folders, tagged presentation code (the same tags as R4: // presentation, // measure, // debug, // wall-clock,
// // main-loop), setTimeout(resolve, ...) delays, setTimeout(fn, 0).
//
// Switching off. Per line (this line or the whole-line comment above): `// hint-off` for every hint, or `// hint-off(random, timers)` for named ones.
//   Whole file (one of the first 30 lines): `// hint-off-file` or `// hint-off-file(random)`.
//   Whole game: the game's package.json (games/<name>/package.json; the repo root's applies to every game)  "threedog": { "hints": false }  (all), or
//   { "hints": { "random": false, "timers": false } } (named kinds); one run: THREEDOG_HINTS=off npm run check. Kinds: timers random inventory grid save pause.
//   A switch that cannot work (an unknown kind, hint-off-file below line 30, a wrong hints value) is reported as its own warning, never silently ignored.
// If you have a reason, write it in DESIGN.md under Systems (what you built by hand and why), so the next reader and the next AI see it.
import { readFileSync, existsSync } from 'node:fs';
import { walk, lines, codeOnly, ROOT, P } from './_lib.mjs';

export const KINDS = ['timers', 'random', 'inventory', 'grid', 'save', 'pause'];
const R4_TAGS = ['presentation', 'measure', 'debug', 'wall-clock', 'main-loop'];
const HOW = 'a reason? write it in DESIGN.md (Systems), or switch the hint off: // hint-off(KIND) on the line, // hint-off-file(KIND) at the top, or package.json "threedog": { "hints": { "KIND": false } }';

const SAY = {
  timers: ['setInterval / setTimeout used for game timing',
    'engine.clock.after(seconds, fn) / engine.clock.every(seconds, fn), or accumulate dt in engine.onFixed (they follow pause, step and saves)'],
  random: ['Math.random() in game code', 'engine.random (seeded: next / range / int / pick / chance; replays, tests and saves get the same numbers)'],
  inventory: ['a hand-made inventory (items kept in your own array / object)',
    'the inventory module: engine.use(inventory()), engine.inventory.add / remove / has (counts, containers, events, saved with the game)'],
  grid: ['blending over a height / field array by hand', 'sampleGrid(data, { width, height, size, interp }) -> (x, z) => value; engine.assets.gridFromImage reads one from a PNG'],
  save: ['a save of its own in localStorage', "engine.saves: autosave(minutes), register('game', { version: 1, save, load }), and Continue on the start screen (recipe 63); versions, slots and a corrupt save are handled"],
  pause: ['a pause or Esc handler of its own', 'settings({ freezeWorld: true }): Esc stops every system and opens the menu (recipe 63); engine.freeze(why) for a pause with no menu'],
};

/** Hints that stay on for the project: package.json "threedog.hints" (false / 'off' / { kind: false }) and THREEDOG_HINTS=off. Returns a Set of kinds */
export function activeKinds(pkgHints, env = process.env.THREEDOG_HINTS) {
  if (env === 'off' || pkgHints === false || pkgHints === 'off') return new Set();
  const off = pkgHints && typeof pkgHints === 'object' ? KINDS.filter(k => pkgHints[k] === false) : [];
  return new Set(KINDS.filter(k => !off.includes(k)));
}
/** Why a package.json "threedog.hints" value does not do what it seems to: [message] (unknown kinds, a wrong value type) */
export function hintsConfigProblems(pkgHints) {
  if (pkgHints == null || pkgHints === false || pkgHints === 'off') return [];
  if (typeof pkgHints !== 'object') return [`"threedog": { "hints": ${JSON.stringify(pkgHints)} } is ignored: use false (all off) or { "<kind>": false }`];
  return Object.keys(pkgHints).filter(k => !KINDS.includes(k)).map(k => `"threedog.hints.${k}" is ignored: no hint kind "${k}" (kinds: ${KINDS.join(', ')})`);
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
  const L = text.split(/\r?\n/), out = [];
  const fileOff = new Set(L.slice(0, 30).flatMap(l => offKinds(commentOf(l), 'hint-off-file') ?? []));
  // a switch naming no known kind, or a file switch too far down, would silently do nothing: say so where it is written
  const ignored = (i, why) => out.push({ level: 'warn', line: i + 1, kind: 'switch', msg: `hint switch ignored: ${why}`, fix: `kinds: ${KINDS.join(', ')}; // hint-off-file(...) goes in the first 30 lines` });
  L.forEach((l, i) => {
    const c = commentOf(l), file = offKinds(c, 'hint-off-file');
    if (i >= 30 && file) ignored(i, 'hint-off-file below line 30 (only the first 30 lines are read)');
    for (const k of [...(file ?? []), ...(offKinds(c, 'hint-off') ?? [])]) if (!KINDS.includes(k)) ignored(i, `no hint kind "${k}"`);
  });
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
  const usesSaves = /\bengine\.saves\b/.test(whole);
  const usesPause = /\bsettings\(|\bengine\.(freeze|flow|settings)\b|\buiFocus\(/.test(whole);
  code.forEach((c, i) => {
    if (!c.trim()) return;
    if (/\b(setInterval|setTimeout)\s*\(/.test(c) && !tagged(i) && !/setTimeout\s*\(\s*(r|res|resolve|done)\b/.test(c) && !/setTimeout\s*\([^,]*,\s*0\s*\)/.test(c)) add(i, 'timers');
    if (/\bMath\.random\s*\(/.test(c) && !tagged(i)) add(i, 'random');
    if (!usesInventory && /(?:\b(?:const|let|var)\s+|\bthis\.)(inventory|backpack|bag|pockets|inv)(?:Items|Slots|List|Contents|Data|Map|Counts?|s)?\s*=\s*(\[\s*\]|\{\s*\}|new Map\b|new Set\b)/i.test(c)) add(i, 'inventory');
    // on the raw line: codeOnly blanks strings, and the key and the Esc name are strings
    if (!usesSaves && /\blocalStorage\.setItem\s*\(/.test(c) && /save|progress|JSON\.stringify/i.test(L[i])) add(i, 'save');
    if (!usesPause && (/\b(?:let|var)\s+(?:is|game)?paused\s*=/i.test(c) || /(?:\.key|\.code)\s*===?\s*['"]Escape['"]/.test(L[i]))) add(i, 'pause');
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
    // The switch belongs in the game's own package.json (games/<name>/): reading only the repo root's ignored it in this repository.
    // Both apply: the root's to every game, the game's to its own files. Each package.json is read once
    const hintsOf = new Map(), out = [];
    const settingOf = pj => {
      if (!hintsOf.has(pj)) {
        let h; try { h = existsSync(`${ROOT}/${pj}`) ? JSON.parse(readFileSync(`${ROOT}/${pj}`, 'utf8')).threedog?.hints : undefined; } catch { /* unreadable package.json: no setting */ }
        hintsOf.set(pj, h);
        for (const msg of hintsConfigProblems(h)) out.push({ level: 'warn', file: pj, line: 1, kind: 'switch', msg, fix: `"threedog": { "hints": { "${KINDS[0]}": false } }` });
      }
      return hintsOf.get(pj);
    };
    const rootSet = activeKinds(settingOf('package.json'));
    if (!rootSet.size) return Object.assign([], { note: 'bypass hints are switched off for this project' });
    for (const f of [...walk(P.GAMES_REL, ['.js', '.mjs']), ...walk(P.EXAMPLES_REL, ['.js', '.mjs'])]) {
      if (/(^|\/)(tests|docs|scripts)\//.test(f)) continue;
      const game = f.startsWith(P.GAMES_REL + '/') ? f.split('/').slice(0, 2).join('/') + '/' : null;
      const active = game ? new Set([...activeKinds(settingOf(game + 'package.json'))].filter(k => rootSet.has(k))) : rootSet;
      if (!active.size) continue;
      let text; try { text = lines(f).join('\n'); } catch { continue; }
      for (const r of scanText(text, active)) out.push({ ...r, file: f });
    }
    return out;
  },
};

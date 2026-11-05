// threedog lib check: do the things this game pulled from a library fit together?
//   problems (exit 1): a need nothing in the game gives, two entries writing the same three.js value, code that cannot draw on the game's renderer.
//   notes (exit 0): sizes and styles that do not fit. A giant or a mix of styles may be exactly what the game wants, so these never fail.
// Why it reads the game's copies and not the library: a pull belongs to the game. Once the game has removed the fog line from one of two skies the
//   clash is gone, and only the file in the game can say so. Style tags cannot be read from code, so they come from the pull record.
// What it cannot see: a value set through a helper, a module named differently from its factory, what a composite such as openWorld() installs.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { backendsOf, cardOf, noComments, sizeNotes } from './lib-card.mjs';
import { readRecords } from './lib-records.mjs';
import { gameCodeFiles } from './text.mjs';

/** A composite module installs others under its own call, so a static read cannot say what is missing */
const COMPOSITE = /\bopenWorld\s*\(/;
/** Biggest model over smallest: past this, one of them is in other units */
const SCALE_GAP = 100;

/** The game's own code as one text, for "is this module used here" */
const gameCode = game => gameCodeFiles(game).map(f => readFileSync(f, 'utf8')).join('\n');
/** The top-level files, where createEngine is: a pulled plugin's own helper renderer must not read as the game's */
function topCode(game) {
  const top = readdirSync(game).filter(f => /\.m?js$/.test(f) && !f.startsWith('vite.')).map(f => join(game, f));
  return top.map(f => readFileSync(f, 'utf8')).join('\n');
}

/**
 * The renderer this game asks for, read from its code the way createEngine reads its option: 'webgpu', 'webgl' (no renderer option means WebGLRenderer), or null when the
 * code does not say (no createEngine in a top-level file, a renderer held in a variable, or options that are not written in the call: createEngine(cfg), { ...cfg }).
 * Null lets a pull through: stopping on a guess costs more than a note.
 * @param {string} game @returns {'webgpu' | 'webgl' | null}
 */
export function rendererOf(game) {
  const code = noComments(topCode(game));
  if (/\brenderer\s*:\s*['"]webgpu['"]|\bnew\s+(?:\w+\.)?WebGPURenderer\b/.test(code)) return 'webgpu';
  if (/\brenderer\s*:\s*['"]webgl['"]|\bnew\s+(?:\w+\.)?WebGLRenderer\b/.test(code)) return 'webgl';
  // only a call whose options are all in sight can mean "no renderer option": createEngine(cfg) or { ...cfg } may name one in another file
  const calls = [...code.matchAll(/\bcreateEngine\s*\(\s*/g)];
  return calls.length && calls.every(m => optionsInSight(code, m.index + m[0].length)) && !/\brenderer\s*[:,}]/.test(code) ? 'webgl' : null;
}

/** Is the argument at i nothing, or an object literal with no spread of its own? (a spread inside a nested value, bindings: { ...x }, names no engine option) */
function optionsInSight(code, i) {
  if (code[i] === ')') return true;
  if (code[i] !== '{') return false;
  for (let depth = 0; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return true;
    else if (depth === 1 && code.startsWith('...', i)) return false;
  }
  return false;
}

const SAY = { webgl: 'WebGL', webgpu: 'WebGPU' };
/** Why this entry cannot draw in this game, with the way out, or null when it fits. One wording for lib pull and lib check */
export function misfit(name, backends, renderer) {
  if (!renderer || !backends?.length || backends.includes(renderer)) return null;
  const fix = renderer === 'webgpu' ? 'port it to TSL (recipe 56, "GLSL to TSL")' : "move this game to renderer: 'webgpu' (recipe 56)";
  return `${name} draws only on ${backends.map(b => SAY[b] ?? b).join(', ')} and this game runs on ${SAY[renderer]}, so it would stop the game at start: ${fix}, or use an entry that fits (threedog lib list ${renderer})`;
}

/** Names the game's package.json lists */
function packagesOf(game) {
  const f = join(game, 'package.json');
  if (!existsSync(f)) return new Set();
  const p = JSON.parse(readFileSync(f, 'utf8'));
  return new Set(Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.peerDependencies }));
}

/**
 * @param {string} game @returns {{ pulled: number, problems: string[], notes: string[] }} every line says what to do about it
 */
export function checkGame(game) {
  const cards = readRecords(game).map(r => {
    const files = Object.keys(r.files).map(f => join(game, f)).filter(existsSync);
    return { name: r.entry, backends: backendsOf(files), ...cardOf(files, { tags: r.style, entries: r.needs ?? [], packages: r.packages ?? [] }) };
  });
  const problems = [], notes = [], code = gameCode(game), packages = packagesOf(game), composite = COMPOSITE.test(code), renderer = rendererOf(game);
  const given = new Set(cards.flatMap(c => c.provides.modules));

  if (!renderer && cards.length) notes.push("this game's renderer could not be read from its code, so entries were not checked against it: say renderer: 'webgpu' or 'webgl' in createEngine in a top-level file");
  for (const c of cards) {
    const wrong = misfit(c.name, c.backends, renderer);
    if (wrong) problems.push(wrong);
    for (const m of c.needs.modules) {
      if (given.has(m) || new RegExp(`\\b${m}\\s*\\(`).test(code)) continue;
      if (composite) notes.push(`${c.name} needs module "${m}": openWorld() may install it; describe().modules in the running game tells`);
      else problems.push(`${c.name} needs module "${m}", which this game does not install: add engine.use(${m}()) in main.js (import { ${m} } from 'threedog'), or pull the entry that provides it`);
    }
    for (const e of c.needs.entries) if (!cards.some(x => x.name === e)) problems.push(`${c.name} needs library entry "${e}": threedog lib pull ${e}`);
    for (const p of c.needs.packages) if (!packages.has(p)) problems.push(`${c.name} imports package "${p}", which package.json does not list: npm install ${p}`);
    notes.push(...sizeNotes(c.name, c.size));
  }

  const writers = new Map();
  for (const c of cards) for (const w of c.writes) writers.set(w, [...(writers.get(w) ?? []), c.name]);
  for (const [w, names] of writers) if (names.length > 1) problems.push(`${names.join(' and ')} both write ${w}, and the last one wins each frame: remove it from all but one (the copies are this game's own), or give them one shared value in the picture code`);

  const sized = cards.filter(c => c.size?.box).map(c => ({ name: c.name, long: Math.max(...c.size.box) })).sort((a, b) => a.long - b.long);
  if (sized.length > 1 && sized.at(-1).long > SCALE_GAP * sized[0].long)
    notes.push(`${sized.at(-1).name} (${sized.at(-1).long} m) is over ${SCALE_GAP} times ${sized[0].name} (${sized[0].long} m): check that both are in meters; scale one at export or where it is placed`);

  const tagged = cards.filter(c => c.style.tags.length);
  for (const [i, a] of tagged.entries()) for (const b of tagged.slice(i + 1))
    if (!a.style.tags.some(t => b.style.tags.includes(t))) notes.push(`${a.name} (${a.style.tags.join(', ')}) and ${b.name} (${b.style.tags.join(', ')}) share no style tag: make their materials come from the same picture code, or keep one out of the same shot`);
  return { pulled: cards.length, problems, notes };
}

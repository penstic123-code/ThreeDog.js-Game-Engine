// Copy and capture of arrangements: `threedog content stamp|capture` and `content set --source`. Arrangements are a tool-time thing:
// content/arrangements/<name>.js is an array of entries around zero, each with a local `part` name, and nothing reads it at run time.
//   stamp    copies an arrangement: one place in content/places.js, one plain entry per part in props (id <place>-<part>, source: <arrangement>).
//   set --source <name> <part> field=value   an explicit batch edit of every copy's part. Copies never follow an arrangement or each other on
//            their own: an entry is plain data once written, and the game loads nothing else. That is the whole point of flat content.
//   capture  reads a named group's direct children from the running game over the dev bridge and writes the arrangement. It records placement only;
//            shape stays in code as a named model, so a child with no named model stops the capture instead of being dropped or serialized.
// Every write goes through contentWrite (content-write.mjs), one entry at a time. contentWrite is atomic per file, not per batch, so a batch
// first checks what it can and snapshots the files it touches: any failure puts them all back, and nothing stays half-written.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { rel, command } from './paths.mjs';
import { loadGame, importFresh } from './content-check/load.mjs';
import { buildIndex, indexPath } from './content-check/index-ids.mjs';
import { contentWrite, lit, pairsOf } from './content-write.mjs';
import { writeAtomic } from './lib/atomic.mjs';
import { pagePath } from './lib/cli-args.mjs';
import { bridgeDriver } from './threedog/connect.mjs';
import { ev } from './threedog/pageFns.mjs';

const NAME = /^[\w-]+$/;
/** Kinds whose ids share one space with a stamped copy: props and pickups are both world records, places are what `place` names */
const CLASH_KINDS = ['places', 'props', 'pickups'];
const fail = (error, extra) => ({ ok: false, error, ...extra });
const arrangementFile = (dir, name) => join(dir, 'content', 'arrangements', name + '.js');
const round = v => { const r = Math.round(v * 1e4) / 1e4; return r === 0 ? 0 : r; };

/** All content read fresh, and the index rewritten from it: a batch decides on what is in the files now, not on an index an edit may have outdated */
async function freshGame(dir) {
  const { data, parts, errors } = await loadGame(dir);
  if (errors.length) return { error: `content does not load, fix it first: ${errors[0]}` };
  const { index } = buildIndex(dir, data, parts);
  mkdirSync(join(dir, '.threedog'), { recursive: true });
  writeAtomic(indexPath(dir), JSON.stringify(index));
  return { data, parts, index };
}

/** The texts of these files, and a function that puts them back (a file made since is deleted) */
function snapshot(dir, paths) {
  const saved = paths.map(path => [path, existsSync(path) ? readFileSync(path, 'utf8') : null]);
  return () => {
    // only what changed: a file that cannot be written is often the one the batch failed on, and it must not stop the rest going back
    for (const [path, text] of saved) { if (text == null) rmSync(path, { force: true }); else if (readFileSync(path, 'utf8') !== text) writeAtomic(path, text); }
    rmSync(indexPath(dir), { force: true });   // it described the undone writes; the next write rebuilds it
  };
}

/** The writes one after another; one refused or thrown puts every file back: { ok: true } or the failure */
async function batch(dir, undo, writes) {
  for (const w of writes) {
    const r = await contentWrite(dir, w).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) { undo(); return fail(`${w.id ?? w.entry.id}: ${r.error}. Nothing written`); }
  }
  return { ok: true };
}

/** Make an empty content file when the game has none of this kind yet: contentWrite only adds to files that exist */
function ensureKindFile(dir, parts, kind, empty) {
  const path = join(dir, 'content', kind + '.js');
  if (!parts[kind]?.length && !existsSync(path)) writeFileSync(path, `export default ${empty};\n`);
}

/** The entries of an arrangement, checked: { entries } or { error }. Nothing about a copy (id, place, source) may be in it: stamp writes those */
async function readArrangement(dir, name) {
  if (!NAME.test(name ?? '')) return { error: `arrangement name '${name}': use letters, digits, - and _` };
  const path = arrangementFile(dir, name);
  if (!existsSync(path)) return { error: `no arrangement ${rel(path)}: write it, or make it from the running game with threedog content capture <group> --as ${name}` };
  let list;
  try { list = (await importFresh(path)).default; } catch (e) { return { error: `${rel(path)} cannot be loaded: ${e.message}` }; }
  if (!Array.isArray(list) || !list.length) return { error: `${rel(path)}: the default export must be a non-empty array of entries` };
  const seen = new Set();
  for (const [i, e] of list.entries()) {
    const at = `${rel(path)}[${i}]`;
    if (!NAME.test(e?.part ?? '')) return { error: `${at}: every entry needs a local part name (letters, digits, - and _), e.g. part: 'chest'` };
    if (seen.has(e.part)) return { error: `${at}: part '${e.part}' is used twice; the part name makes the copy's id, so it must be unique` };
    seen.add(e.part);
    if (e.template == null && e.model == null) return { error: `${at} (${e.part}): an arrangement holds props, so it needs template or model` };
    const own = ['id', 'place', 'source'].find(k => e[k] !== undefined);
    if (own) return { error: `${at} (${e.part}): remove ${own}; stamp writes it for each copy` };
  }
  return { entries: list };
}

/**
 * Copy an arrangement into the game: one place, one entry per part.
 * @param {string} dir  game folder
 * @param {{ arrangement: string, id: string, x: number, z: number, rot?: number }} req
 * @param {{ dry?: boolean }} [opt]
 * @returns {Promise<{ ok: boolean, dry?: boolean, error?: string, clash?: string[], place?: any, entries?: any[] }>}
 */
export async function stamp(dir, { arrangement, id, x, z, rot }, opt = {}) {
  if (!NAME.test(id ?? '')) return fail(`id '${id}': use letters, digits, - and _ (it names the place and starts every copy's id)`);
  if (typeof x !== 'number' || typeof z !== 'number') return fail('stamp needs numbers x= and z=: where the copy stands');
  if (rot !== undefined && typeof rot !== 'number') return fail('rot= is a number, radians about Y');
  const { entries: list, error } = await readArrangement(dir, arrangement);
  if (error) return fail(error);
  const game = await freshGame(dir);
  if (game.error) return fail(game.error);

  const place = { x, z, ...(rot !== undefined && { rot }) };
  const entries = list.map(({ part, template, model, ...rest }) =>
    ({ id: `${id}-${part}`, ...(template != null ? { template } : { model }), place: id, ...rest, source: arrangement }));
  // every clash in one report, before any file is touched
  const taken = name => (game.index.ids[name] || []).filter(e => CLASH_KINDS.includes(e.kind)).map(e => `'${name}' is used by ${e.file}:${e.line}`);
  const clash = [...taken(id), ...entries.flatMap(e => taken(e.id))];
  if (clash.length) return fail(`id clash, nothing written: ${clash.join('; ')}. Pick another id=`, { clash });
  if (opt.dry) return { ok: true, dry: true, place, entries };

  const files = [...game.parts.places ?? [], ...game.parts.props ?? []].map(p => p.path);
  const undo = snapshot(dir, [...new Set([...files, join(dir, 'content/places.js'), join(dir, 'content/props.js')])]);
  ensureKindFile(dir, game.parts, 'places', '{\n}');
  ensureKindFile(dir, game.parts, 'props', '[\n]');
  const done = await batch(dir, undo, [{ kind: 'places', entry: { id, ...place } }, ...entries.map(entry => ({ kind: 'props', entry }))].map(w => ({ op: 'add', ...w })));
  return done.ok ? { ok: true, place, entries } : done;
}

/**
 * The same field change in one part of every copy of an arrangement. The part of a copy is its id minus `<place>-`.
 * All or nothing: every entry is dry-run first, so an entry that cannot be edited (built by code) refuses the whole batch.
 * @param {string} dir  game folder
 * @param {{ source: string, part: string, fields: Record<string, any>, expect?: any }} req
 * @param {{ dry?: boolean }} [opt]
 * @returns {Promise<{ ok: boolean, dry?: boolean, error?: string, changed?: { id: string, line?: number, where?: string, change?: string }[], same?: string[], odd?: string[] }>}
 */
export async function setBySource(dir, { source, part, fields, expect }, opt = {}) {
  const own = ['id', 'place', 'source'].find(k => k in fields);
  if (own) return fail(`--source cannot change ${own}: the part name and the batch hang on it. Change one entry at a time: threedog content set <id> ${own}=…`);
  const game = await freshGame(dir);
  if (game.error) return fail(game.error);
  const copies = (game.data.props ?? []).filter(p => p?.source === source);
  if (!copies.length) return fail(`no props entry has source: '${source}'`);
  const partOf = p => p.place != null && String(p.id ?? '').startsWith(p.place + '-') ? String(p.id).slice(p.place.length + 1) : null;
  const hits = copies.filter(p => partOf(p) === part);
  if (!hits.length) return fail(`no copy of '${source}' has part '${part}'. Its parts: ${[...new Set(copies.map(partOf).filter(Boolean))].join(', ') || '(none)'}`);
  // an entry renamed by hand has no readable part: say so rather than leave it behind unmentioned
  const odd = copies.filter(p => partOf(p) == null).map(p => String(p.id ?? '(no id)'));
  const same = hits.filter(p => Object.entries(fields).every(([k, v]) => JSON.stringify(p[k]) === JSON.stringify(v))).map(p => p.id);
  const todo = hits.filter(p => !same.includes(p.id));
  const req = p => ({ op: 'set', id: p.id, kind: 'props', fields, expect });
  const changed = [];
  for (const p of todo) {
    const r = await contentWrite(dir, req(p), { dry: true });
    if (!r.ok) return fail(`${p.id}: ${r.error}. Nothing written`);
    changed.push({ id: p.id, where: r.where, line: r.line, change: r.change });
  }
  if (opt.dry || !todo.length) return { ok: true, dry: !!opt.dry, changed, same, odd };
  const undo = snapshot(dir, game.parts.props.map(p => p.path));
  const done = await batch(dir, undo, todo.map(req));
  return done.ok ? { ok: true, changed, same, odd } : done;
}

const STAY_IN_CODE = 'or take this child out of the group so it stays in code';
const FIX_NO_MODEL = "make it a named model: engine.assets.manifest({ models: { name: () => build() } }), then create the child with await engine.assets.model('name') "
  + `(a .clone() of that copy counts too). If it cannot be one (a light, particles), ${STAY_IN_CODE.slice(3)}`;
const FIX_TILT = `content turns an entry about Y only (rot): build the tilt into the named model, ${STAY_IN_CODE}`;
const FIX_SCALE = `content scales an entry uniformly (scale): build the proportions into the named model, ${STAY_IN_CODE}`;

/** One child as read in the page -> { entry } or { problem }. A name is what ties a copy to its shape in code, so without one there is nothing to place */
function childEntry(c, part) {
  const label = `'${c.name || part}' (${c.type})`;
  if (c.template == null && c.model == null) return { problem: `${label}: no named model. Fix: ${FIX_NO_MODEL}` };
  if (c.tilted) return { problem: `${label}: turned about x or z. Fix: ${FIX_TILT}` };
  const [sx, sy, sz] = c.scale;
  if (Math.abs(sx - sy) > 1e-4 || Math.abs(sx - sz) > 1e-4 || sx <= 0) return { problem: `${label}: scale ${c.scale.map(round).join(', ')} is not uniform. Fix: ${FIX_SCALE}` };
  const entry = { part, ...(c.template != null ? { template: c.template } : { model: c.model }), x: round(c.x), z: round(c.z) };
  if (round(c.y)) entry.y = round(c.y);
  if (round(c.rot)) entry.rot = round(c.rot);
  if (Math.abs(sx - 1) > 1e-4) entry.scale = round(sx);
  return { entry };
}

/** Part names: the child's own name, else its model; repeats get -2, -3 (a part name is half of a copy's id, so it must be unique and id-safe) */
function partNames(children) {
  const used = new Map();
  return children.map(c => {
    const model = Array.isArray(c.model) ? c.model[0] : c.model;
    const base = String(c.name || c.template || model || c.type).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'part';
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

/** The arrangement file. The header names the group: that is how `check` (R52) can tell the code placing it is still there */
const arrangementText = (name, group, entries) => `// Arrangement '${name}', captured from group '${group}' (threedog content capture). Read by tools only: threedog content stamp ${name} copies it.
// Copies are plain entries and do not follow this file. Shape stays in code as the named models below.
export default [
${entries.map(e => `  ${lit(e)},`).join('\n')}
];
`;

/**
 * Read a named group from the running game and write its arrangement.
 * @param {string} dir  game folder the arrangement goes to
 * @param {{ group: string, as: string, driver?: any, dry?: boolean, force?: boolean, page?: string }} req  driver: the dev bridge (default: this game's dev server)
 * @returns {Promise<{ ok: boolean, dry?: boolean, error?: string, problems?: string[], notes?: string[], entries?: any[], text?: string, path?: string, stands?: any[] }>}
 */
export async function capture(dir, { group, as, driver, dry, force, page }) {
  if (!group) return fail('capture needs the group name: threedog content capture <groupName> --as <arrangement>');
  if (!NAME.test(as ?? '')) return fail('capture needs --as <arrangement> (letters, digits, - and _)');
  const path = arrangementFile(dir, as);
  if (existsSync(path) && !force && !dry) return fail(`${rel(path)} already exists: nothing written. Pick another --as, or --force to replace it (copies already stamped do not change)`);
  const r = await ev(driver ?? bridgeDriver(dir, { page }), 'contentGroup', { name: group });
  if (!r.groups.length) return fail(`no group named '${group}' in the scene. ${r.names.length ? `Named groups: ${r.names.join(', ')}` : 'No group has a name: set group.name in the code that builds it'}`);
  const [first, ...others] = r.groups;
  if (!first.children.length) return fail(`group '${group}' has no children to capture`);
  const parts = partNames(first.children), read = first.children.map((c, i) => childEntry(c, parts[i]));
  const problems = read.flatMap(x => x.problem ? [x.problem] : []), entries = read.flatMap(x => x.entry ? [x.entry] : []);
  const notes = [];
  for (const [i, c] of first.children.entries()) if (!c.visible) notes.push(`'${parts[i]}' is hidden in the game; a content entry has no hidden state, so it will show`);
  if (first.scale.some(s => Math.abs(s - 1) > 1e-4)) notes.push(`group '${group}' is scaled ${first.scale.map(round).join(', ')} in the world; the arrangement holds its local values, so a stamped copy is at scale 1`);
  if (first.tilted) notes.push(`group '${group}' is turned about x or z in the world; a place turns about Y only, so a stamped copy stands upright`);
  // y in content is above the ground at that spot, not above a group: the two agree only when the group stood on the ground
  if (Math.abs(first.y) > 1e-3) notes.push(`group '${group}' stands at y ${round(first.y)}; a stamped copy stands on the ground (add y to the parts if it must float)`);
  others.forEach((g, i) => { if (JSON.stringify(g.children) !== JSON.stringify(first.children)) notes.push(`group '${group}' number ${i + 2} has a different layout; only the first was read`); });
  if (problems.length) return fail(`group '${group}': ${problems.length} of ${first.children.length} children cannot be captured, nothing written`, { problems, notes });
  const text = arrangementText(as, group, entries);
  if (!dry) { mkdirSync(join(dir, 'content', 'arrangements'), { recursive: true }); writeAtomic(path, text); }
  return { ok: true, dry: !!dry, entries, text, path, notes, stands: r.groups.map(g => ({ x: round(g.x), z: round(g.z), rot: round(g.rot) })) };
}

const USAGE = `Usage:
  threedog content stamp <arrangement> id=<place> x=<n> z=<n> [rot=<radians>] [--dry]
  threedog content capture <groupName> --as <arrangement> [--page /p.html] [--force] [--dry]
  threedog content set --source <arrangement> <part> field=value … [--expect field=value …] [--dry]
  (set --source is an explicit batch edit: copies are plain entries and never follow an arrangement or each other on their own)`;

/** CLI body of `threedog content stamp …` */
export async function stampMain(argv) {
  let dir, args, opt;
  try { ({ dir, rest: args, opt } = command(argv, { positional: true, flags: ['dry'], values: ['dir'] })); } catch (e) { console.log('✗ ' + e.message); return 1; }
  if (opt.dir) dir = resolve(opt.dir);
  const pairs = pairsOf(args.slice(1));
  if (!args[0] || !pairs || pairs.bad) { console.log(USAGE); return 1; }
  const unknown = Object.keys(pairs).find(k => !['id', 'x', 'z', 'rot'].includes(k));
  if (unknown) { console.log(`✗ stamp takes id, x, z and rot, not ${unknown}\n${USAGE}`); return 1; }
  const r = await stamp(dir, { arrangement: args[0], id: pairs.id == null ? pairs.id : String(pairs.id), x: pairs.x, z: pairs.z, rot: pairs.rot }, { dry: opt.dry });
  if (!r.ok) { console.log('✗ ' + r.error); return 1; }
  console.log(`place ${pairs.id}: ${lit(r.place)}`);
  for (const e of r.entries) console.log(`  ${lit(e)}`);
  console.log(r.dry ? 'dry run: nothing written' : `✓ stamped ${r.entries.length} entries of '${args[0]}' (full check: threedog check). They are plain entries now: to change every copy, threedog content set --source ${args[0]} <part> field=value`);
  return 0;
}

/** CLI body of `threedog content set --source …` */
export async function sourceMain(argv) {
  const own = [], expectArgs = [];
  for (let i = 0; i < argv.length; i++) {   // the same --expect reading as `content set`: every field=value after it
    if (argv[i] !== '--expect') { own.push(argv[i]); continue; }
    while (argv[i + 1] && !argv[i + 1].startsWith('-')) expectArgs.push(argv[++i]);
  }
  let dir, args, opt;
  try { ({ dir, rest: args, opt } = command(own, { positional: true, flags: ['dry'], values: ['source', 'dir'] })); } catch (e) { console.log('✗ ' + e.message); return 1; }
  if (opt.dir) dir = resolve(opt.dir);
  const fields = pairsOf(args.slice(1)), expect = expectArgs.length ? pairsOf(expectArgs) : undefined;
  if (!opt.source || !args[0] || !fields || !Object.keys(fields).length || expect === null) { console.log(USAGE); return 1; }
  if (fields.bad || expect?.bad) { console.log(`✗ ${fields.bad || expect.bad}: the value must be JSON (strings in double quotes) or a bare word`); return 1; }
  const r = await setBySource(dir, { source: opt.source, part: args[0], fields, expect }, { dry: opt.dry });
  if (!r.ok) { console.log('✗ ' + r.error); return 1; }
  for (const c of r.changed) console.log(`${c.where} (line ${c.line}): ${c.change}`);
  if (r.same.length) console.log(`already so, left alone: ${r.same.join(', ')}`);
  if (r.odd.length) console.log(`! not touched, their id is not <place>-<part>: ${r.odd.join(', ')}`);
  const n = r.changed.length;
  console.log(r.dry ? `${n} entries would change (dry run: nothing written)`
    : `✓ changed ${n} entries (part '${args[0]}' of '${opt.source}'). That was this one edit: copies do not follow by themselves, and content/arrangements/${opt.source}.js is unchanged, so a new stamp still has its old values. Reload the page for it to take effect (threedog reload)`);
  return 0;
}

/** CLI body of `threedog content capture …` */
export async function captureMain(argv) {
  let dir, args, opt;
  try { ({ dir, rest: args, opt } = command(argv, { positional: true, live: true, flags: ['dry', 'force'], values: ['as', 'page'] })); } catch (e) { console.log('✗ ' + e.message); return 1; }
  if (args.length !== 1) { console.log(USAGE); return 1; }
  let r;
  try { r = await capture(dir, { group: args[0], as: opt.as, dry: opt.dry, force: opt.force, page: opt.page && pagePath(opt.page) }); }
  catch (e) { console.log('✗ ' + e.message); return 1; }   // no dev server, no page: the bridge's own message says what to start
  for (const n of r.notes ?? []) console.log('! ' + n);
  if (!r.ok) {
    console.log('✗ ' + r.error);
    for (const p of r.problems ?? []) console.log('  ' + p);
    return 1;
  }
  if (r.dry) { console.log(r.text + 'dry run: nothing written'); return 0; }
  console.log(`✓ wrote ${rel(r.path)}: ${r.entries.length} parts (${r.entries.map(e => e.part).join(', ')}). Placement only: shape stays in code as the named models`);
  console.log(`Stamp it where ${r.stands.length > 1 ? `the ${r.stands.length} groups stood` : 'the group stood'}:`);
  r.stands.forEach((s, i) => console.log(`  threedog content stamp ${opt.as} id=${opt.as}-${i + 1} x=${s.x} z=${s.z}${s.rot ? ` rot=${s.rot}` : ''}`));
  console.log(`Then delete the code that placed group '${args[0]}', or it will appear twice: once from code and once from content. threedog check warns (R52) while that name is still in the code.`);
  return 0;
}

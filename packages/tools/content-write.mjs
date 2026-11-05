// Content write-back: the one implementation of "change the design data" (CLI `threedog content set|add|remove`, and the editor through the
// dev-server endpoint vite/vite-threedog-editor.js; contentRead is the matching read).
//   set     one or more fields of the entry with this id: only the value's text is replaced (or `field: value` added after the last property)
//   add     append one entry at the end of a kind's array (always with a written id) or one key to an object kind
//   remove  delete that one object literal and its comma; the reply carries what was cut, so
//   restore puts those exact bytes back (the editor's undo: a re-add would lose the entry's place in the file and its comment)
// Why a targeted text edit and no re-print of the file: the author's comments, column alignment and trailing commas stay as they are.
// Why only one file: the id index (.threedog/content-index.json, content-check/index-ids.mjs) says which file holds the id, so a write reads,
// parses and checks that file alone; a game with thousands of placements in many files costs the same as a small one. The full check stays in
// `npm run check`. When the index is missing or wrong (the id is not in the file it names), it is rebuilt once from all files, then the write retries.
// Safety: `expect` (the value the caller believes is there) refuses a write when the file changed under it (another tool or the AI edited it);
// entries built by code (a loop, after a spread, a computed value) are refused with the line of that code; the write is atomic (temp + rename)
// and restored when the check after it fails (lib/atomic.mjs).
// Fields are the content file's own names (x, z, y, rot, scale, template, place, model...), not the runtime record's `position`.
import * as nodeFs from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { parseAst } from 'vite';
import { rel, command } from './paths.mjs';
import { loadGame, dupKeys, importFresh } from './content-check/load.mjs';
import { buildIndex, readIndex, indexPath, fileEntries, entryId, positional } from './content-check/index-ids.mjs';
import { exportedLiteral } from './vite/vite-threedog-content-src.js';
import { writeAtomic, writeChecked } from './lib/atomic.mjs';
import { keyName, literalValue } from './lib/ast-value.mjs';

const IDENT = /^[A-Za-z_$][\w$]*$/;
const BARE = /^[A-Za-z_][\w.-]*$/;
const SIMPLE = /^(Literal|ArrayExpression|ObjectExpression|UnaryExpression|TemplateLiteral)$/;
const lineAt = (text, off) => text.slice(0, off).split('\n').length;
// key order is not a value: an undo that puts a cleared field back puts it at the end of the entry
const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** Counters for tests: how many content texts were parsed (a write parses its one file) */
export const stats = { parsed: 0 };
const parse = text => { stats.parsed++; return parseAst(text); };

/** A JS source literal for a JSON value: single-quoted strings, `{ a: 1 }`, `[1, 2]` (the style the content files are written in) */
export function lit(v) {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;   // \r too: a raw CR inside a quoted string does not parse
  if (Object.is(v, -0)) return '-0';
  if (Array.isArray(v)) return `[${v.map(lit).join(', ')}]`;
  if (v && typeof v === 'object') { const e = Object.entries(v); return e.length ? `{ ${e.map(([k, x]) => `${IDENT.test(k) ? k : lit(k)}: ${lit(x)}`).join(', ')} }` : '{}'; }
  return String(v);
}

/**
 * Why a value cannot be written as a content literal, or null. NaN, Infinity, undefined, functions and bigints would be written as CODE
 * (`x: NaN`), which reads back as "computed by code" and is not data the editor or a save can hold: refuse by name instead of writing it.
 */
export function unwritable(v, path = 'value') {
  if (typeof v === 'number' && !Number.isFinite(v)) return `${path} is ${v}: a content file holds finite numbers`;
  if (v === undefined || typeof v === 'function' || typeof v === 'bigint' || typeof v === 'symbol') return `${path} is ${typeof v === 'undefined' ? 'undefined' : 'a ' + typeof v}: a content file holds numbers, strings, booleans, null, arrays and plain objects (use unset to remove a field)`;
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { const why = unwritable(x, `${path}.${k}`); if (why) return why; }
  return null;
}

/** Kind of a content file from its path: content/props.js -> props, content/props/town.js -> props; null outside content/ */
export function kindOfFile(dir, path) {
  const r = relative(join(dir, 'content'), path).split(sep);
  if (r[0] === '..' || r.some(x => x === '..')) return null;
  return r.length === 1 ? r[0].replace(/\.js$/, '') : r.length === 2 && r[1].endsWith('.js') ? r[0] : null;
}

/**
 * Find the one literal for `id` in a content file's text: { root, el, prop?, index?, ast } or { error } (el: the entry's ObjectExpression;
 * for an object kind prop is its Property)
 */
function findEntry(text, id, kind, from, where) {
  const root = exportedLiteral(parse(text));
  if (root?.type === 'ArrayExpression') {
    const hits = [];
    for (let i = 0; i < root.elements.length; i++) {
      const el = root.elements[i];
      if (el?.type === 'SpreadElement') {   // after a spread the positions (and so the index ids) are unknown
        if (!hits.length) return { error: `${where}: the entries from line ${lineAt(text, el.start)} on are built by code (a spread); '${id}' is not a literal before it: edit that code by hand`, generated: true };
        break;
      }
      if (el?.type !== 'ObjectExpression') continue;
      const lid = el.properties.find(p => p.type === 'Property' && keyName(p) === 'id')?.value;
      if (lid ? lid.type === 'Literal' && String(lid.value) === id : entryId(kind, literalValue(el) ?? {}, from + i) === id) hits.push({ el, index: i });
    }
    if (hits.length > 1) return { error: `${where}: id '${id}' is written ${hits.length} times (lines ${hits.map(h => lineAt(text, h.el.start)).join(', ')}): ids must be unique` };
    return hits.length ? { root, ...hits[0] } : { error: null };
  }
  if (root?.type === 'ObjectExpression') {
    const prop = root.properties.find(p => p.type === 'Property' && keyName(p) === id);
    if (!prop) return { error: null };
    return { root, prop, el: prop.value };
  }
  return { error: `${where} does not export a plain array or object literal (it is built by code): edit it by hand`, generated: true };
}

/** set: the new text with every [field, value] applied in order and every `unset` name cut, or { error } / { conflict } */
function planSet(text, hit, fields, unset, expect, where, spot = {}) {
  const { el } = hit;
  if (el?.type !== 'ObjectExpression') return { error: `${where} is not a plain object literal (built by code at line ${lineAt(text, (el ?? hit.prop).start)}): edit it by hand` };
  if (el.properties.some(p => p.type !== 'Property' || p.computed || keyName(p) == null)) return { error: `${where} has a spread or computed property (line ${lineAt(text, el.start)}): edit it by hand` };
  for (const [f, want] of Object.entries(expect || {})) {
    const p = el.properties.find(q => keyName(q) === f), now = p ? literalValue(p.value) : undefined;
    if (!same(now ?? undefined, want ?? undefined)) return { conflict: true, error: `${where}.${f} is ${now === undefined ? 'not set' : lit(now)} in the file now, not ${lit(want)} as expected (someone else, maybe the AI, changed it): nothing written. Write again with the value you want, or keep the file's` };
  }
  const edits = [], changes = [];
  let after = el.properties.length ? el.properties[el.properties.length - 1].end : null;
  const added = [];
  for (const [field, value] of Object.entries(fields)) {
    const prop = el.properties.find(p => keyName(p) === field), lt = lit(value), fkey = IDENT.test(field) ? field : lit(field);
    if (prop) {
      if (prop.shorthand || !SIMPLE.test(prop.value.type) || literalValue(prop.value) === undefined) return { error: `${where}.${field} is computed by code (${text.slice(prop.value.start, prop.value.end).slice(0, 40)}, line ${lineAt(text, prop.start)}): edit it by hand` };
      edits.push({ start: prop.value.start, end: prop.value.end, text: lt });
      changes.push(`${field}: ${text.slice(prop.value.start, prop.value.end)} -> ${lt}`);
    } else if (spot[field] != null && el.properties.some(p => keyName(p) === spot[field])) {
      // back to its place (the editor's undo of a cut field): in front of the property it stood before, with the separator the file keeps between two properties
      const next = el.properties.find(p => keyName(p) === spot[field]), prev = el.properties[el.properties.indexOf(next) - 1];
      edits.push({ start: next.start, end: next.start, text: `${fkey}: ${lt}${prev ? text.slice(prev.end, next.start) : ', '}` });
      changes.push(`${field}: ${lt} (added)`);
    } else { added.push(`${fkey}: ${lt}`); changes.push(`${field}: ${lt} (added)`); }
  }
  for (const field of unset) {
    const i = el.properties.findIndex(p => keyName(p) === field), prop = el.properties[i], next = el.properties[i + 1], prev = el.properties[i - 1];
    if (!prop) continue;   // already gone is what was asked for; expect says when that matters
    if (Object.hasOwn(fields, field)) return { error: `${where}: ${field} is both set and unset` };
    // the comma that goes is the one written after it, or before it when it is last: a field added at the end comes off again byte for byte
    edits.push(next ? { start: prop.start, end: next.start, text: '' } : { start: prev?.end ?? prop.start, end: prop.end, text: '' });
    changes.push(`${field}: ${text.slice(prop.value.start, prop.value.end)} (removed)`);
    if (!next) after = prev?.end ?? null;
  }
  if (added.length) edits.push(after != null ? { start: after, end: after, text: ', ' + added.join(', ') } : { start: el.start + 1, end: el.end - 1, text: ` ${added.join(', ')} ` });
  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { after: out, change: changes.join('; '), line: lineAt(text, el.start) };
}

/** add: append one element / property at the end, matching the container's layout (one entry per line, trailing comma or not) */
function planAdd(text, root, entryText) {
  const items = root.type === 'ArrayExpression' ? root.elements.filter(Boolean) : root.properties;
  const close = root.end - 1;
  if (!items.length) return { after: text.slice(0, root.start + 1) + `\n  ${entryText},\n` + text.slice(close), line: lineAt(text, root.start) + 1 };
  const last = items[items.length - 1];
  const lineStart = text.lastIndexOf('\n', last.start) + 1, indent = /^\s*/.exec(text.slice(lineStart, last.start))[0];
  if (lineAt(text, root.start) === lineAt(text, last.start) || lineStart === 0 || text.slice(lineStart, last.start).trim()) {   // one-line container
    return { after: text.slice(0, last.end) + ', ' + entryText + text.slice(last.end), line: lineAt(text, last.start) };
  }
  const tail = text.slice(last.end, close), comma = /^\s*,/.exec(tail);
  if (comma) {   // trailing comma style: the new entry goes on its own line after the last one's line (its end-of-line comment stays with it)
    const nl = text.indexOf('\n', last.end + comma[0].length), at = nl < 0 || nl > close ? last.end + comma[0].length : nl;
    return { after: text.slice(0, at) + `\n${indent}${entryText},` + text.slice(at), line: lineAt(text, at) + 1 };
  }
  return { after: text.slice(0, last.end) + `,\n${indent}${entryText}` + text.slice(last.end), line: lineAt(text, last.end) + 1 };
}

/** remove: the span to cut: the entry and its comma; a line left empty goes too (with the entry's own end-of-line comment) */
function cutSpan(text, node) {
  let start = node.start, end = node.end;
  const after = /^\s*,/.exec(text.slice(end));
  if (after) end += after[0].length;
  else { const before = /,\s*$/.exec(text.slice(0, start)); if (before) start -= before[0].length; }
  const ls = text.lastIndexOf('\n', start - 1) + 1, nl = text.indexOf('\n', end), le = nl < 0 ? text.length : nl;
  if (!text.slice(ls, start).trim() && /^\s*(\/\/.*)?$/.test(text.slice(end, le))) { start = ls; end = nl < 0 ? le : nl + 1; }
  return { start, end };
}

const CONTEXT = 80;   // characters kept on each side of a cut: enough to find the spot again after edits elsewhere in the file
/** The values an entry spells out, without the properties computed by code (those cannot be compared, and a cut takes them along anyway) */
function writtenFields(el) {
  if (el?.type !== 'ObjectExpression') return literalValue(el);
  const o = {};
  for (const p of el.properties) { const k = p.type === 'Property' ? keyName(p) : null, v = k == null || p.shorthand ? undefined : literalValue(p.value); if (v !== undefined) o[k] = v; }
  return o;
}

/** restore: the text with `cut` back between its two neighbours, or { error, conflict } when that spot is not there exactly once any more */
function planRestore(text, { cut, before, after }, where) {
  const seam = before + after, at = text.indexOf(seam);
  if (at < 0 || text.indexOf(seam, at + 1) >= 0) return { conflict: true, error: `${where}: the text around the removed entry changed since, so it has no safe place to go back to: nothing written. Add it again by hand` };
  const spot = at + before.length;
  return { after: text.slice(0, spot) + cut + text.slice(spot), line: lineAt(text, spot) + 1, change: `restored ${cut.trim().slice(0, 80)}` };
}

/**
 * Problems of the one written file that the write introduced: it loads, exports the same shape, has no new duplicate keys, and the entry it
 * touched names a template / item that exists (looked up in the index, not by loading templates.js). The full check is `npm run check`.
 */
async function checkFile(path, before, after, kind, entryValue, index, wasArray) {
  const out = [];
  let mod;
  try { mod = await importFresh(path); } catch (e) { return [`the file no longer loads: ${e.message}`]; }
  if (Array.isArray(mod.default) !== wasArray) out.push('the default export changed shape');
  const dups = s => dupKeys(s).map(d => `"${d.key}" on line ${d.line} is a duplicate key`);
  const was = new Set(dups(before).map(s => s.replace(/line \d+/, '')));
  out.push(...dups(after).filter(s => !was.has(s.replace(/line \d+/, ''))));
  const has = (k, id) => (index?.ids?.[id] || []).some(e => e.kind === k);
  const kinds = new Set(Object.values(index?.files || {}).map(f => f.kind));
  if (entryValue && typeof entryValue === 'object') {
    if (kind === 'props' && entryValue.template != null && kinds.has('templates') && !has('templates', entryValue.template)) out.push(`template '${entryValue.template}' is not in content/templates`);
    if (kind === 'pickups' && entryValue.item != null && kinds.has('items') && !has('items', entryValue.item)) out.push(`item '${entryValue.item}' is not in content/items`);
  }
  return { problems: out, value: mod.default };
}

/** Rebuild the index from every content file (the slow path: only when it is missing or wrong) */
async function rebuildIndex(dir, io) {
  const { data, parts } = await loadGame(dir);
  const { index } = buildIndex(dir, data, parts);
  try { io.mkdirSync(join(dir, '.threedog'), { recursive: true }); writeAtomic(indexPath(dir), JSON.stringify(index), io); } catch { /* read-only folder: still usable in memory */ }
  return index;
}

/**
 * Which one file and entry an id names: { target, index, rebuilt } or { error, generated? }. The index is rebuilt once when it does not know the id.
 * req.file narrows to one file, req.kind to one kind (an npc and its dialogue share an id).
 */
async function locate(dir, req, index, rebuilt, io) {
  const cdir = join(dir, 'content'), abs = req.file && resolve(dir, req.file);
  for (;;) {
    let hits = abs ? [{ file: relative(dir, abs).replace(/\\/g, '/'), kind: kindOfFile(dir, abs) }]
      : (index?.ids?.[req.id] || []).filter(e => !req.kind || e.kind === req.kind);
    if (hits.some(h => h.placed)) hits = hits.filter(h => h.placed);   // a placed thing first; a named entry (npc, template) only when none is
    if (!hits.length && !rebuilt && !abs) { index = await rebuildIndex(dir, io); rebuilt = true; continue; }
    if (!hits.length) return { error: `no content entry with id '${req.id}' in ${rel(cdir)}${req.kind ? ` (${req.kind})` : ''} (a thing added by code has no entry: edit the code line explain().definition.at names)` };
    if (hits.length > 1) return { error: `id '${req.id}' matches ${hits.length} entries (${hits.map(h => `${h.kind} ${h.file}:${h.line}`).join(', ')}): pick one with --in <kind>, e.g. --in ${hits[0].kind}` };
    if (hits[0].generated) return { error: `${hits[0].file}:${hits[0].line}: '${req.id}' is built by code there (a loop, a spread or a computed value), not written as a literal: edit that code by hand`, generated: true };
    return { target: hits[0], index, rebuilt };
  }
}

/**
 * Read one entry as the file has it now, for a caller that will write it back (the editor): the written values, not the running game's.
 * @param {string} dir  game folder
 * @param {{ id: string, kind?: string, file?: string }} req
 * @param {{ io?: any }} [opt]
 * @returns {Promise<{ ok: boolean, error?: string, generated?: boolean, kind?: string, file?: string, line?: number, fields?: Record<string, any>, computed?: string[] }>}
 *   fields: every literal property; computed: the names written as code (a write to those is refused)
 */
export async function contentRead(dir, req, opt = {}) {
  const io = opt.io ?? nodeFs;
  for (let rebuilt = false; ; rebuilt = true) {
    const found = await locate(dir, req, rebuilt ? await rebuildIndex(dir, io) : readIndex(dir, io), rebuilt, io);
    if (found.error) return { ok: false, error: found.error, ...(found.generated && { generated: true }) };
    const { file, kind } = found.target, from = found.index?.files?.[file]?.from ?? 0, text = io.readFileSync(resolve(dir, file), 'utf8');
    const hit = findEntry(text, req.id, kind, from, `${file} '${req.id}'`);
    if (hit.error) return { ok: false, error: hit.error, ...(hit.generated && { generated: true }) };
    if (!hit.el && !found.rebuilt) continue;   // the index is out of date: the id moved since it was written
    if (hit.el?.type !== 'ObjectExpression') return { ok: false, error: `${file}: '${req.id}' is not a plain object literal: edit it by hand`, generated: true };
    const fields = {}, computed = [];
    for (const p of hit.el.properties) {
      const k = p.type === 'Property' ? keyName(p) : null, v = k == null || p.shorthand ? undefined : literalValue(p.value);
      if (v === undefined) computed.push(k ?? '...'); else fields[k] = v;
    }
    return { ok: true, kind, file, line: lineAt(text, hit.el.start), fields, computed };
  }
}

/**
 * Write one change into a game's content files.
 * @param {string} dir  game folder
 * @param {{ op: 'set' | 'add' | 'remove' | 'restore', id?: string, kind?: string, file?: string, fields?: Record<string, any>, unset?: string[], expect?: any, entry?: Record<string, any>, cut?: string, before?: string, after?: string }} req
 *   set: id + fields (+ unset: names to cut from the entry; + spot: { added field: the property it goes in front of }; + expect: { field: old value }); restore: id + file + the reply's `restore` of a remove; add: kind + entry (with id; + file to pick one part of a folder kind); remove: id (+ expect: the whole entry).
 *   kind / file narrow the lookup when an id names entries in two kinds (an npc and its dialogue).
 * @param {{ dry?: boolean, io?: any }} [opt]  io: the fs functions used (tests pass counting wrappers)
 * @returns {Promise<{ ok: boolean, error?: string, conflict?: boolean, where?: string, file?: string, line?: number, change?: string, path?: string, problems?: string[], restore?: Record<string, string> }>}
 */
export async function contentWrite(dir, req, opt = {}) {
  const io = opt.io ?? nodeFs, fail = (error, extra) => ({ ok: false, error, ...extra });
  const { op } = req;
  if (!['set', 'add', 'remove', 'restore'].includes(op)) return fail(`unknown op '${op}': set, add, remove or restore`);
  let index = readIndex(dir, io), rebuilt = !!opt.rebuilt, isArray = false;
  const cdir = join(dir, 'content');
  const fileOf = f => resolve(dir, f);
  const inContent = p => { const r = relative(cdir, p); return !!r && !r.startsWith('..') && !r.includes(':') && p.endsWith('.js'); };
  const odd = unwritable(req.fields ?? {}, 'fields') ?? unwritable(req.entry ?? {}, 'entry');
  if (odd) return fail(`${odd}: nothing written`);
  if (req.file && !inContent(fileOf(req.file))) return fail(`${req.file}: write-back only edits .js files inside ${rel(cdir)}`);

  // 1. Which file: the given one, else the index (rebuilt once when it does not know the id)
  let target;
  for (;;) {
    if (op === 'add') {
      const kind = req.kind ?? (req.file && kindOfFile(dir, fileOf(req.file)));
      if (!kind) return fail('add needs the kind (props, pickups, npcs…) or --file');
      const files = Object.entries(index?.files || {}).filter(([, f]) => f.kind === kind).sort((a, b) => a[1].from - b[1].from);
      if (!files.length && !req.file && !rebuilt) { index = await rebuildIndex(dir, io); rebuilt = true; continue; }
      const file = req.file ? relative(dir, fileOf(req.file)).replace(/\\/g, '/') : files[files.length - 1]?.[0];
      if (!file || !io.existsSync(fileOf(file))) return fail(`no content file for '${kind}' yet: create ${rel(join(cdir, kind + '.js'))} (export default [ ]) first`);
      target = { file, kind };
      break;
    }
    if (!req.id) return fail(`${op} needs the id of the entry`);
    if (op === 'restore') {
      if (!req.file) return fail('restore needs the file of the cut');
      target = { file: relative(dir, fileOf(req.file)).replace(/\\/g, '/'), kind: kindOfFile(dir, fileOf(req.file)) };
      break;
    }
    const found = await locate(dir, req, index, rebuilt, io);
    if (found.error) return fail(found.error, found.generated && { generated: true });
    ({ index, rebuilt, target } = found);
    break;
  }
  const path = fileOf(target.file), kind = target.kind, info = index?.files?.[target.file], from = info?.from ?? 0;
  const before = io.readFileSync(path, 'utf8');
  const where = `${target.file}${req.id ? ` '${req.id}'` : ''}`;

  // 2. The edit, on the text read now (so an edit elsewhere in the file by someone else is no conflict)
  let plan, entryValue;
  if (op === 'add') {
    const entry = req.entry || {};
    if (entry.id == null || entry.id === '') return fail('add: the entry needs an id (write it, e.g. id=crate-7): an entry without one gets its position as id, which the next insert shifts');
    const root = exportedLiteral(parse(before));
    if (root?.type !== 'ArrayExpression' && root?.type !== 'ObjectExpression') return fail(`${target.file} does not export a plain array or object literal: add the entry by hand`);
    const id = String(entry.id);
    const taken = (index?.ids?.[id] || []).filter(e => e.kind === kind && e.file !== target.file);
    if (taken.length || findEntry(before, id, kind, from, where).el) return fail(`id '${id}' is already used${taken.length ? ` by ${taken[0].file}:${taken[0].line}` : ` in ${target.file}`}: pick another`, { conflict: true });
    const later = Object.entries(index?.files || {}).filter(([f, x]) => x.kind === kind && f !== target.file && x.from > from && x.indexIds > 0);
    if (root.type === 'ArrayExpression' && later.length) return fail(`${later[0][0]} has ${later[0][1].indexIds} entr(y/ies) whose id is their position; adding to ${target.file} (an earlier file) would shift them. Give them ids first (threedog content ids --write), or add to the last file`);
    const { id: _, ...rest } = entry;
    isArray = root.type === 'ArrayExpression';
    const text = root.type === 'ArrayExpression' ? lit({ id, ...rest }) : `${IDENT.test(id) ? id : lit(id)}: ${lit(rest)}`;
    entryValue = root.type === 'ArrayExpression' ? entry : rest;
    plan = { ...planAdd(before, root, text), change: `added ${text}` };
  } else if (op === 'restore') {
    const root = exportedLiteral(parse(before));
    isArray = root?.type === 'ArrayExpression';
    if (findEntry(before, req.id, kind, from, where).el) return fail(`id '${req.id}' is in ${target.file} again: nothing written`, { conflict: true });
    plan = planRestore(before, req, where);
    if (plan.error) return fail(plan.error, { conflict: true });
  } else {
    const hit = findEntry(before, req.id, kind, from, where);
    if (hit.error) return fail(hit.error, hit.generated && { generated: true });
    if (!hit.el) {
      if (!rebuilt && !req.file) { index = await rebuildIndex(dir, io); return contentWrite(dir, req, { ...opt, rebuilt: true }); }
      return fail(`no literal entry '${req.id}' in ${target.file} (the index is out of date: run threedog check, or pass --file)`);
    }
    isArray = hit.root.type === 'ArrayExpression';
    if (op === 'set') {
      plan = planSet(before, hit, req.fields || {}, req.unset || [], req.expect, where, req.spot);
      if (plan.error) return fail(plan.error, plan.conflict && { conflict: true });
      entryValue = { ...literalValue(hit.el), ...req.fields };
    } else {
      if (req.expect !== undefined && !same(writtenFields(hit.el), req.expect)) return fail(`${where} in the file now is ${lit(literalValue(hit.el))}, not what you expected: nothing removed`, { conflict: true });
      if (hit.index != null) {   // entries after it whose id is their position would shift onto other entries' saved state
        // read the literal's keys, not its value: a field computed by code (scale: gen.length) does not make an entry with a written id positional
        const keys = x => Object.fromEntries(x.properties.filter(p => p.type === 'Property').map(p => [keyName(p), 1]));
        // the index knows the evaluated entries (also those a spread adds); without it, the literals after this one
        const shifted = info?.positional ? (info.positional.some(i => i > hit.index) ? { start: hit.el.end } : null)
          : hit.root.elements.slice(hit.index + 1).find(x => x?.type === 'ObjectExpression' && positional(kind, keys(x)));
        const laterFile = Object.entries(index?.files || {}).find(([f, x]) => x.kind === kind && f !== target.file && x.from > from && x.indexIds > 0);
        if (shifted || laterFile) return fail(`removing ${where} would shift the ids of the entries after it that have no written id (${shifted ? `${target.file}:${lineAt(before, shifted.start)}` : laterFile[0]}). Give them ids first (threedog content ids --write), then remove`);
      }
      const { start, end } = cutSpan(before, hit.prop ?? hit.el);
      plan = { after: before.slice(0, start) + before.slice(end), change: `removed ${text1(before, hit.prop ?? hit.el)}`, line: lineAt(before, (hit.prop ?? hit.el).start),
        restore: { file: target.file, cut: before.slice(start, end), before: before.slice(Math.max(0, start - CONTEXT), start), after: before.slice(end, end + CONTEXT) } };
    }
  }
  try { parse(plan.after); } catch (e) { return fail(`the edited file would not parse (${e.message}): nothing written`); }
  const res = { where, file: target.file, kind, line: plan.line, change: plan.change, path, ...(plan.restore && { restore: plan.restore }) };
  if (opt.dry) return { ok: true, dry: true, ...res };

  // 3. Write, check this file, restore on failure
  let value;
  const w = await writeChecked(path, before, plan.after, async () => {
    const r = await checkFile(path, before, plan.after, kind, op === 'remove' ? null : entryValue, index, isArray);
    if (Array.isArray(r)) return r;
    value = r.value; return r.problems;
  }, io);
  if (!w.ok) return fail(`content check fails after the edit, the file is restored: ${w.problems.join('; ')}`, { problems: w.problems });

  // 4. Keep the index right for this one file (add / remove in an earlier part of a folder shifts later parts: rebuild next time instead)
  if (index && value !== undefined) {
    const shifts = op !== 'set' && Object.values(index.files).some(x => x.kind === kind && x.from > from);
    if (shifts) { try { io.rmSync(indexPath(dir), { force: true }); } catch { /* rebuilt on next write */ } }
    else {
      for (const [id, list] of Object.entries(index.ids)) { const keep = list.filter(e => e.file !== target.file); if (keep.length) index.ids[id] = keep; else delete index.ids[id]; }
      const { ids, indexIds, positional } = fileEntries(kind, target.file, value, from, plan.after);
      for (const [id, e] of ids) (index.ids[id] ??= []).push(e);
      index.files[target.file] = { kind, mtime: io.statSync(path).mtimeMs, from, count: Array.isArray(value) ? value.length : Object.keys(value || {}).length, indexIds, positional };
      try { writeAtomic(indexPath(dir), JSON.stringify(index), io); } catch { /* the next write rebuilds it */ }
    }
  }
  return { ok: true, ...res };
}
const text1 = (text, n) => text.slice(n.start, n.end).replace(/\s+/g, ' ').slice(0, 80);

/** A CLI value: JSON, or a bare word as a string (place=home) */
const cliValue = v => { try { return JSON.parse(v); } catch { return BARE.test(v) ? v : undefined; } };
export const pairsOf = list => {
  const o = {};
  for (const a of list) { const i = a.indexOf('='); if (i <= 0) return null; const v = cliValue(a.slice(i + 1)); if (v === undefined) return { bad: a }; o[a.slice(0, i)] = v; }
  return o;
};

const USAGE = `Usage:
  threedog content set <id> field=value [field=value …] [--expect field=value …] [--in kind] [--file content/x.js] [--dry]
  threedog content set --source <arrangement> <part> field=value … [--dry]   (every copy of that part, in one explicit edit: copies never follow on their own; --dry lists them first)
  threedog content add <kind> id=<id> field=value … [--file content/props/town.js] [--dry]
  threedog content remove <id> [--in kind] [--file content/x.js] [--dry]
  (-w game or --dir folder picks the game; values are JSON, a bare word is a string: place=home)`;

/** CLI body of `threedog content set|add|remove …` (argv after the subcommand) */
export async function main(op, argv) {
  // --expect takes every field=value after it (up to the next option), so it is taken out before the one strict parse of the rest
  const own = [], expect = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--expect') { own.push(argv[i]); continue; }
    while (argv[i + 1] && !argv[i + 1].startsWith('-')) expect.push(argv[++i]);
  }
  let dir, args, opt;
  try { ({ dir, rest: args, opt } = command(own, { positional: true, flags: ['dry'], values: ['in', 'dir', 'file'] })); } catch (e) { console.log('✗ ' + e.message); return 1; }
  opt.expect = expect;
  if (opt.dir) dir = resolve(opt.dir);
  let req;
  if (op === 'set') {
    // also the older `<id> <field> <json>` form
    const kv = args.length === 3 && !args[1].includes('=') ? [`${args[1]}=${args[2]}`] : args.slice(1);
    const fields = pairsOf(kv), expect = opt.expect.length ? pairsOf(opt.expect) : undefined;
    if (!args[0] || !fields || !Object.keys(fields).length || (expect === null)) { console.log(USAGE); return 1; }
    if (fields.bad || expect?.bad) { console.log(`✗ ${fields.bad || expect.bad}: the value must be JSON (strings in double quotes) or a bare word`); return 1; }
    req = { op, id: args[0], fields, expect, kind: opt.in, file: opt.file };
  } else if (op === 'add') {
    const entry = pairsOf(args.slice(1));
    if (!args[0] || !entry) { console.log(USAGE); return 1; }
    if (entry.bad) { console.log(`✗ ${entry.bad}: the value must be JSON (strings in double quotes) or a bare word`); return 1; }
    req = { op, kind: args[0], entry, file: opt.file };
  } else {
    if (args.length !== 1) { console.log(USAGE); return 1; }
    req = { op, id: args[0], kind: opt.in, file: opt.file };
  }
  const r = await contentWrite(dir, req, { dry: opt.dry });
  if (!r.ok) { console.log('✗ ' + r.error); return 1; }
  console.log(`${r.where} (line ${r.line}): ${r.change}`);
  if (r.dry) { console.log('dry run: nothing written'); return 0; }
  console.log(`✓ wrote ${rel(r.path)}, the file's check passes (full check: threedog check). Reload the page for it to take effect (threedog reload); the running session keeps the old value`);
  return 0;
}

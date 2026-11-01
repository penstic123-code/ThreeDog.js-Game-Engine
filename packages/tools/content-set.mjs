// threedog content set <id> <field> <json> [-w game] [--dir folder] [--in file] [--dry]: write one permanent change into the content file entry
// that defines a placed thing / prop / pickup / npc ("Defined in content/props.js:14" in explain()), then validate and tell the AI to reload.
// Why a targeted text edit and no re-print of the file: the author's comments, column alignment and trailing commas stay as they are; only the value
// of one property changes (or `field: value` is added after the last property). Refuses when the entry is not a plain object literal in the exported
// array / object (built by a loop, after a spread, a spread property, a computed key) or when the id matches more than one entry.
// Fields are the content file's own names (x, z, y, rot, scale, template, place, model...), not the record's `position`; the value is JSON.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseAst } from 'vite';
import { abs, rel, pickWorkspace, CONTENT_IDS_REL } from './paths.mjs';
import { loadGame } from './content-check/load.mjs';
import { checkGame } from './content-check.mjs';
import { exportedLiteral } from './vite/vite-threedog-content-src.js';

const { pickupId, templateId } = await import(pathToFileURL(abs(CONTENT_IDS_REL)).href);
const IDENT = /^[A-Za-z_$][\w$]*$/;
const BARE = /^[A-Za-z_][\w.-]*$/;
const isJson = t => { try { JSON.parse(t); return true; } catch { return false; } };

/** A JS source literal for a JSON value: single-quoted strings, `{ a: 1 }`, `[1, 2]` (the style the content files are written in) */
export function lit(v) {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  if (Array.isArray(v)) return `[${v.map(lit).join(', ')}]`;
  if (v && typeof v === 'object') { const e = Object.entries(v); return e.length ? `{ ${e.map(([k, x]) => `${IDENT.test(k) ? k : lit(k)}: ${lit(x)}`).join(', ')} }` : '{}'; }
  return String(v);
}
const keyName = p => p.computed ? null : p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? String(p.key.value) : null;
const SIMPLE = /^(Literal|ArrayExpression|ObjectExpression|UnaryExpression|TemplateLiteral)$/;

/**
 * Edit plan for one game folder: { path, before, after, where, line, change } or { error }
 * @param {string} dir  game folder  @param {string} id  @param {string | [string, string][]} field  one field name (then json is its value) or several [field, json] pairs (all edits go into one text, one write)
 * @param {string} json  @param {string} [only]  restrict to one content file ('props')
 */
export async function planSet(dir, id, field, json, only) {
  const pairs = Array.isArray(field) ? field : [[field, json]];
  const values = [];
  for (const [f, j] of pairs) {
    try { values.push(JSON.parse(j)); } catch { return { error: `<json> must be JSON (strings in double quotes, e.g. '"home"' or 12.5 or [1,2]); got: ${j}${pairs.length > 1 ? ` (for ${f})` : ''}` }; }
  }
  const { data, files } = await loadGame(dir);
  const hits = [];   // placed entries (array files) first; named entries (npcs, templates...) only when no placed one matches
  for (const [name, d] of Object.entries(data)) {
    if (name === 'startItems' || (only && name !== only)) continue;
    if (Array.isArray(d)) d.forEach((p, i) => { if (p && typeof p === 'object' && (p.id === id || (p.id == null && ((name === 'pickups' && pickupId(p, i) === id) || (name === 'props' && p.template && templateId(p, i) === id))))) hits.push({ name, index: i, placed: true }); });
    else if (d && typeof d === 'object' && d[id] && typeof d[id] === 'object') hits.push({ name, key: id, placed: false });
  }
  const pool = hits.some(h => h.placed) ? hits.filter(h => h.placed) : hits;
  if (!pool.length) return { error: `no content entry with id '${id}' in ${rel(dir)}/content (a thing added by code has no entry: edit the code line explain().definition.at names)` };
  if (pool.length > 1) return { error: `id '${id}' matches ${pool.length} entries (${pool.map(h => `${h.name}${h.key ? '.' + h.key : '[' + h.index + ']'}`).join(', ')}): pick one with --in <file>, e.g. --in ${pool[0].name}` };
  const h = pool[0], path = files[h.name], before = readFileSync(path, 'utf8');
  const where = `${rel(path)}${h.key ? '.' + h.key : '[' + h.index + ']'}`;
  // One field at a time on the text so far (a later field sees the earlier edit; a field added twice or a new key is then found as existing)
  let text = before, line = 0;
  const changes = [];
  for (let n = 0; n < pairs.length; n++) {
    const field = pairs[n][0], value = values[n], root = exportedLiteral(parseAst(text));
    // The index came from the loaded (evaluated) array; if the source array is sorted/filtered by code the literal at that index may be another entry
    const literalId = x => x?.properties?.find(p => p.type === 'Property' && keyName(p) === 'id')?.value;
    let el;
    if (h.placed) {
      if (root?.type !== 'ArrayExpression' || root.elements.slice(0, h.index + 1).some(x => x?.type === 'SpreadElement')) return { error: `${where} is built by code (spread or generated array): edit the generator by hand` };
      el = root.elements[h.index];
      const lid = literalId(el);
      if (lid?.type === 'Literal' && lid.value !== id) return { error: `${where}: the source literal at that position has id '${lid.value}', not '${id}' (the array is reordered by code): edit it by hand` };
    } else el = root?.type === 'ObjectExpression' ? root.properties.find(p => p.type === 'Property' && keyName(p) === h.key)?.value : null;
    if (el?.type !== 'ObjectExpression') return { error: `${where} is not a plain object literal in the exported content (built by code): edit it by hand` };
    if (el.properties.some(p => p.type !== 'Property' || p.computed || keyName(p) == null)) return { error: `${where} has a spread or computed property: edit it by hand` };
    const prop = el.properties.find(p => keyName(p) === field), lt = lit(value), fkey = IDENT.test(field) ? field : lit(field);
    let edit;
    if (prop) {
      if (prop.shorthand || !SIMPLE.test(prop.value.type)) return { error: `${where}.${field} is computed by code (${text.slice(prop.value.start, prop.value.end).slice(0, 40)}): edit it by hand` };
      edit = { start: prop.value.start, end: prop.value.end, text: lt };
    } else if (el.properties.length) {
      const last = el.properties[el.properties.length - 1];
      edit = { start: last.end, end: last.end, text: `, ${fkey}: ${lt}` };
    } else edit = { start: el.start + 1, end: el.end - 1, text: ` ${fkey}: ${lt} ` };
    if (!n) line = text.slice(0, el.start).split('\n').length;
    changes.push(prop ? `${field}: ${text.slice(prop.value.start, prop.value.end)} -> ${lt}` : `${field}: ${lt} (added)`);
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  try { parseAst(text); } catch (e) { return { error: `the edited file would not parse (${e.message}): nothing written` }; }
  return { path, before, after: text, where, line, change: changes.join('; ') };
}

/** CLI body of `threedog content set …` (argv after "set") */
export async function main(argv) {
  const rest = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry') opt.dry = true;
    else if (argv[i] === '--in' || argv[i] === '--dir') opt[argv[i].slice(2)] = argv[++i];
    else rest.push(argv[i]);
  }
  let dir, args;
  try { ({ dir, args } = pickWorkspace(rest)); } catch (e) { console.log('✗ ' + e.message); return 1; }
  if (opt.dir) dir = resolve(opt.dir);
  const multi = args.length >= 2 && args[1].includes('=');   // `<id> a=1 b="x"`: several fields, one write, one check
  if (!multi && args.length !== 3) { console.log('Usage: threedog content set <id> <field> <json>  |  <id> field=value [field=value …] [-w game | --dir folder] [--in props] [--dry]   (e.g. content set cabin x=12 z=3 --in props)'); return 1; }
  let pairs;
  if (multi) {
    pairs = args.slice(1).map(a => { const i = a.indexOf('='); return i > 0 ? [a.slice(0, i), a.slice(i + 1)] : null; });
    if (pairs.includes(null)) { console.log('✗ every field after the id must be field=value (JSON value; a bare word counts as a string, e.g. place=home)'); return 1; }
    for (const p of pairs) if (!isJson(p[1]) && BARE.test(p[1])) p[1] = JSON.stringify(p[1]);
  }
  const id = args[0], plan = await (multi ? planSet(dir, id, pairs, undefined, opt.in) : planSet(dir, id, args[1], args[2], opt.in));
  if (plan.error) { console.log('✗ ' + plan.error); return 1; }
  console.log(`${plan.where} (line ${plan.line}): ${plan.change}`);
  if (opt.dry) { console.log('dry run: nothing written'); return 0; }
  const was = (await checkGame(dir)).errors;
  // Atomic write (temp file + rename) and always restore on any failure, also an exception thrown by the check itself
  const put = text => { const tmp = plan.path + '.threedog-tmp'; writeFileSync(tmp, text); renameSync(tmp, plan.path); };
  put(plan.after);
  let now;
  try { now = (await checkGame(dir)).errors.filter(e => !was.includes(e)); }
  catch (e) { put(plan.before); console.log(`✗ content check threw after the edit, reverted: ${e.message}`); return 1; }
  if (now.length) { put(plan.before); console.log('✗ content check fails after the edit, reverted:\n  ' + now.join('\n  ')); return 1; }
  console.log(`✓ wrote ${rel(plan.path)}, content check passes. Reload the page for it to take effect (threedog reload); the running session keeps the old value`);
  return 0;
}

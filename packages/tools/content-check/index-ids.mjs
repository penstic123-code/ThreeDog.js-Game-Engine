// The content id index, .threedog/content-index.json in the game folder: id -> the file and line that define it, plus per file its kind, mtime,
// where its entries start in the joined kind (a folder kind joins several files) and how many entries rely on their position for their id.
// Why: write-back (content-write.mjs) must open only the one file it edits. Without the index it would import every content file to find an id,
// which is what made `content set` slow on a game with thousands of placements in many files. Content check writes it (it has loaded everything
// anyway); write-back updates the one file's entry after each write and rebuilds the whole index only when an id is not where the index says.
// Also the one place that sees all files of a kind at once, so duplicate ids across files (content/props/forest.js and town.js) are reported here.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAst } from 'vite';
import { abs, CONTENT_IDS_REL } from '../paths.mjs';
import { keyName } from '../lib/ast-value.mjs';
import { exportedLiteral } from '../vite/vite-threedog-content-src.js';

const { pickupId, templateId } = await import(pathToFileURL(abs(CONTENT_IDS_REL)).href);
/** Above this many entries in one file content check suggests splitting the kind into a folder (a hint, not an error) */
const SPLIT_HINT = 2000;
export const indexPath = dir => join(dir, '.threedog', 'content-index.json');
const relOf = (dir, path) => relative(dir, path).replace(/\\/g, '/');

/**
 * The id an array entry has at load: the written id, else the index id the engine gives it (ids.js / props.js), else null (no id: not addressable).
 * Must match the engine's rule, or write-back would look for an id the running game does not use.
 */
export function entryId(kind, p, i) {
  if (!p || typeof p !== 'object') return null;
  if (p.id != null) return String(p.id);
  if (kind === 'pickups') return pickupId(p, i);
  if (kind === 'props') return p.template ? templateId(p, i) : p.model != null ? `prop:${Array.isArray(p.model) ? p.model[0] : p.model}:${i}` : null;
  return null;
}
/** Entries whose id is their position (no written id) shift when an entry above them is added or removed: only pickups and template props keep state */
export const positional = (kind, p) => p && typeof p === 'object' && p.id == null && (kind === 'pickups' || (kind === 'props' && !!p.template));

/** Line of every character offset (1-based) */
function lineIndex(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) starts.push(i + 1);
  return off => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= off) lo = m; else hi = m - 1; } return lo + 1; };
}

/**
 * Index entries of one file: { ids: [[id, { file, kind, line, placed, generated? }]], indexIds }. value is what the file exports (evaluated),
 * text its source; an entry that is not a plain literal in the exported array / object (a loop, after a spread) gets generated: true and the
 * line of the export, which is the code to edit.
 */
export function fileEntries(kind, file, value, from, text) {
  const lineOf = lineIndex(text);
  let root = null, exportLine = 1;
  try {
    const ast = parseAst(text);
    root = exportedLiteral(ast);
    const s = ast.body.find(x => x.type === 'ExportDefaultDeclaration');
    if (s) exportLine = lineOf(s.start);
  } catch { /* not parseable: the load error is reported elsewhere */ }
  const ids = [], positions = [];
  if (Array.isArray(value)) {
    const els = root?.type === 'ArrayExpression' ? root.elements : [];
    const spread = els.findIndex(x => x?.type === 'SpreadElement');
    value.forEach((p, i) => {
      const id = entryId(kind, p, from + i);
      if (positional(kind, p)) positions.push(i);
      if (id == null) return;
      // the literal at the same position, unless a spread came first or code filtered / reordered the array (lengths differ)
      const el = (spread < 0 ? els.length === value.length : i < spread) ? els[i] : null;
      const lid = el?.type === 'ObjectExpression' ? el.properties.find(q => q.type === 'Property' && keyName(q) === 'id')?.value : null;
      const literal = el?.type === 'ObjectExpression' && (!lid || (lid.type === 'Literal' && String(lid.value) === id));
      ids.push([id, { file, kind, line: literal ? lineOf(el.start) : exportLine, placed: true, ...(!literal && { generated: true }) }]);
    });
  } else if (value && typeof value === 'object') {
    const props = root?.type === 'ObjectExpression' ? root.properties : [];
    for (const k of Object.keys(value)) {
      const p = props.find(q => q.type === 'Property' && keyName(q) === k);
      ids.push([k, { file, kind, line: p ? lineOf(p.start) : exportLine, placed: false, ...(!p && { generated: true }) }]);
    }
  }
  return { ids, indexIds: positions.length, positional: positions };
}

/**
 * The whole index from loaded content (loadGame's data and parts): { index, errors, warnings }
 * @param {string} dir game folder  @param {Record<string, any>} data  @param {Record<string, { path: string, from: number, count: number }[]>} parts
 */
export function buildIndex(dir, data, parts) {
  const index = { version: 1, files: {}, ids: {} }, errors = [], warnings = [];
  for (const [kind, list] of Object.entries(parts)) {
    if (kind === 'startItems' || kind === 'rules') continue;
    const joined = data[kind];
    for (const { path, from, count } of list) {
      const file = relOf(dir, path), text = readFileSync(path, 'utf8');
      const value = Array.isArray(joined) ? joined.slice(from, from + count) : list.length > 1 ? null : joined;
      // a part of an object folder: its own keys only (the joined object has every file's keys)
      const own = value ?? Object.fromEntries(Object.keys(joined || {}).filter(k => fileHasKey(text, k)).map(k => [k, joined[k]]));
      const { ids, indexIds, positional } = fileEntries(kind, file, own, from, text);
      index.files[file] = { kind, mtime: statSync(path).mtimeMs, from, count, indexIds, positional };
      for (const [id, e] of ids) (index.ids[id] ??= []).push(e);
      if (count > SPLIT_HINT) warnings.push(`${file}: ${count} entries in one file. Consider splitting it into a folder, content/${kind}/<part>.js (by area or by theme, your choice); `
        + 'write-back and the dev server then reread only the part that changed');
    }
  }
  for (const [id, list] of Object.entries(index.ids)) {
    const byKind = new Map();
    for (const e of list) { if (!byKind.has(e.kind)) byKind.set(e.kind, []); byKind.get(e.kind).push(e); }
    for (const [kind, es] of byKind) if (es.length > 1 && es[0].placed)
      errors.push(`${es[1].file}:${es[1].line}: id "${id}" is also used by ${es[0].file}:${es[0].line} (${kind}). Ids name an entry in saves and write-back, so each must be unique across every file of a kind: rename one`);
  }
  return { index, errors, warnings };
}
// Object kinds split over files: which file defines key k (the merged object lost that). A plain text test is enough: loadGame already
// refused a key defined in two files, so the key appears as a property in exactly one part.
const fileHasKey = (text, k) => new RegExp(`(^|[\\s{,])(${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|'${k}'|"${k}")\\s*:`).test(text);

/** Build and write .threedog/content-index.json (content check calls this): { errors, warnings } */
export function writeIndex(dir, data, parts) {
  const { index, errors, warnings } = buildIndex(dir, data, parts);
  try { mkdirSync(join(dir, '.threedog'), { recursive: true }); writeFileSync(indexPath(dir), JSON.stringify(index)); }
  catch (e) { warnings.push(`could not write ${relOf(dir, indexPath(dir))}: ${e.message} (write-back will rebuild it)`); }
  return { errors, warnings };
}

/** The index, or null when there is none yet / it cannot be read @param {string} dir @param {any} [io] */
export function readIndex(dir, io = { readFileSync, existsSync }) {
  try { return io.existsSync(indexPath(dir)) ? JSON.parse(io.readFileSync(indexPath(dir), 'utf8')) : null; } catch { return null; }
}

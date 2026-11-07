// threedog catalog [id]: prints engine.catalog() from the running page and adds what only the file system knows (api page, recipes,
// examples, the source file that defines the module or op). Why split this way: the page has the live registrations (the single source),
// node has the files; neither side keeps its own list.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { abs, rel, ENGINE, DOCS_REL, API_DIR_REL, EXAMPLES_REL, MODULES_REL } from '../paths.mjs';
import { metadata } from 'threedog/metadata';
import { walk, esc } from '../lib/text.mjs';

const MAX_FILES = 3, MAX_TEXT = 6000, MAX_SIZE = 200_000;

/** Every .js / .mjs / .md under dir (skipping build output, tests and dependencies) */
const files = (dir, exts = /\.(m?js|md)$/) => walk(dir, { exts, skip: ['tests', 'generated'], skipDir: n => n.startsWith('.') });
const read = p => { try { return statSync(p).size < MAX_SIZE ? readFileSync(p, 'utf8') : ''; } catch { return ''; } };

/** Files under dirs whose text matches re, most matches first, as 'path:line' of the first match */
function find(dirs, re, ext, max = MAX_FILES) {
  const hits = [], seen = new Set();
  for (const d of dirs) for (const p of files(d, ext)) {
    if (seen.has(p)) continue;   // the game dir may contain the engine (monorepo root): count each file once
    seen.add(p);
    const text = read(p), all = text.match(new RegExp(re.source, 'g'));
    if (!all) continue;
    const line = text.slice(0, text.search(re)).split('\n').length;
    hits.push({ at: `${rel(p)}:${line}`, n: all.length });
  }
  return hits.sort((a, b) => b.n - a.n).slice(0, max).map(h => h.at);
}

/** Where an entry is defined and documented. Module: api page by name, recipes and examples that use engine.<id>, source with name: '<id>' */
function locate(id, kind, gameDir) {
  const codeDirs = [abs(MODULES_REL), join(ENGINE, 'core'), gameDir].filter(d => d && existsSync(d));
  const docs = [abs(`${DOCS_REL}/recipes`)], examples = [abs(EXAMPLES_REL)];
  if (kind === 'op') {
    return { source: find(codeDirs, new RegExp(`define\\(\\s*['"\`]${esc(id)}['"\`]`), /\.m?js$/, 2),
      recipes: find(docs, new RegExp(`['"\`]${esc(id)}['"\`]`), /\.md$/) };
  }
  if (kind !== 'module') return {};
  const api = `${API_DIR_REL}/${id}.md`, use = new RegExp(`\\b(engine|e)\\.${esc(id)}\\b`);
  return {
    source: find(codeDirs, new RegExp(`name:\\s*['"\`]${esc(id)}['"\`]`), /\.m?js$/, 2),
    api: existsSync(abs(api)) ? api : null,
    recipes: find(docs, use, /\.md$/),
    examples: find(examples, use, /\.m?js$/, 2),
  };
}

const MAX_API = 40;

/** Fill type / desc of the live params from the metadata (the live schema's own desc wins); returns the keys with no description anywhere */
function mergeDocs(params, docs) {
  const missing = [];
  for (const [k, s] of Object.entries(params || {})) {
    const d = docs?.[k];
    if (d?.docType && s.type === 'any') s.docType = d.docType;
    if (!s.desc && d?.desc) s.desc = d.desc;
    if (!s.desc) missing.push(k);
  }
  return missing;
}
const paramLine = (k, s) => {
  const base = argText({ [k]: s.docType ? { ...s, type: s.docType } : s }) + ('value' in s ? ` (now ${JSON.stringify(s.value)})` : '');
  return `  ${base} — ${s.desc ?? '(no doc)'}`;
};

const list = a => a?.length ? a.join(', ') : '—';
const argText = args => Object.entries(args || {}).map(([k, s]) => {
  let t = `${k}:${s.type}${s.optional ? '?' : ''}`;
  if ('default' in s) t += `=${JSON.stringify(s.default)}`;
  if (s.min != null || s.max != null) t += `[${s.min ?? ''}..${s.max ?? ''}]`;
  if (s.values) t += `{${s.values.join('|')}}`;
  return t;
}).join(' ');
const opLine = o => `  ${o.name}(${argText(o.args)})${o.failures?.length ? ' fails: ' + o.failures.join(', ') : ''}${o.desc ? ' — ' + o.desc : ''}`;
const filesLines = l => [l.source?.length && `source: ${l.source.join(', ')}`, l.api && `api: ${l.api}`,
  l.recipes?.length && `recipes: ${l.recipes.join(', ')}`, l.examples?.length && `examples: ${l.examples.join(', ')}`].filter(Boolean);

const rowLine = s => `${s.id} [${[s.stage, s.state].filter(Boolean).join(', ') || s.kind}] ops: ${list(s.ops)} · saves: ${list(s.saves)}`
  + `${s.time ? ' · time: ' + s.time : ''}${s.blockedBy ? ` · blocked by ${s.blockedBy.map(b => b.module).join(', ')}` : ''}${s.problems ? ` · ${s.problems} problem(s)` : ''}`;
/**
 * Answer first: the rows that can do something (ops) or have problems get a line each; the rest are named on one line per kind.
 * Why: 18 drawing parts and a dozen op-less modules were 35 of 50 lines on the world example, all saying "ops: — · saves: —". full = every row.
 */
function summaryText(rows, full) {
  const loud = s => full || s.ops?.length || s.problems || s.state === 'failed' || s.state === 'initializing';
  const quiet = rows.filter(s => !loud(s)), byKind = {};
  for (const s of quiet) (byKind[s.kind === 'capability' ? 'capabilities' : 'modules without ops'] ??= []).push(s.id);
  return [...rows.filter(loud).map(rowLine), ...Object.entries(byKind).map(([k, ids]) => `${ids.length} ${k}: ${ids.join(', ')}`),
    `Details: threedog catalog <id> (module, op name, core or game)${full ? '' : '; --full for one line per module'}`].join('\n');
}

function moduleText(x, where) {
  const out = [`${x.id}${x.label ? ' (' + x.label + ')' : ''} · ${x.kind}${x.state ? ' · ' + x.state : ''}${x.stage ? ' · stage ' + x.stage + ' #' + x.runIndex : ''}`
    + `${x.critical ? ' · critical' : ''}`];
  if (x.requires?.length || x.optional?.length)
    out.push(`requires: ${list(x.requires)} · optional: ${list(x.optional.map(o => o.name + (o.installed ? '' : ' (missing)')))}`);
  if (x.params) out.push('params:', ...Object.entries(x.params).map(([k, s]) => paramLine(k, s)));
  if (x.ops?.length) out.push('ops:', ...x.ops.map(opLine));
  if (x.kind === 'capability') out.push(`now: ${JSON.stringify(x.facts)}`);
  else out.push(`saves: ${list(x.saves.map(p => `${p.key} v${p.version}`))}`);
  if (x.time) out.push(`time: hooks ${list(x.time.hooks)} · steps in ${x.time.step} · skip kind ${x.time.kind ?? 'undeclared'} · skip hook ${x.time.skip ? 'yes' : x.time.noSkip ? 'no (noSkip: ' + x.time.noSkip + ')' : 'no'}`);
  const q = x.queries, qs = q ? [q.describe, ...q.extra].filter(Boolean) : [];
  if (q) out.push(`queries: ${list(qs)}${q.api.length ? ' · api: ' + q.api.join(' ') : ''}`);
  for (const p of x.problems ?? []) out.push('⚠ ' + p);
  return [...out, ...filesLines(where)].join('\n');
}

function opText(o, where) {
  const out = [`${o.id} · op of ${o.owner}${o.desc ? ' — ' + o.desc : ''}`, `args: ${argText(o.args) || '(none)'}`,
    `fails: ${Object.entries(o.reasons).map(([k, v]) => `${k} (${v})`).join(', ') || '—'} (plus unknownOp, halted, loading (save parts still loading), error from the engine; badOffer / offersFailed in ops.list({ available }) for a broken offers)`,
    `can: ${o.can ? 'yes' : 'no'} · offers: ${o.offers ? 'yes' : 'no'} · undo: ${o.undo ? 'yes' : 'no'} · net: ${o.net}`];
  if (o.last) out.push(`last: tick ${o.last.tick} ${o.last.ok ? '✓' : '✗ ' + o.last.code} ${JSON.stringify(o.last.args)} (${o.last.source})`);
  return [...out, ...filesLines(where)].join('\n');
}

/** catalog --find: this game's hits, then the library's (not installed yet, so they carry the way to pull them); no hit in either says so */
function findText(rows, library, { find, full }) {
  const lib = Array.isArray(library) ? library : [], failed = library?.error ? `(the library could not be read: ${library.error})` : '';
  if (!rows.length && !lib.length) return [`Nothing found for "${find}" in this game's modules and ops or in the library. Other words: threedog how "${find}"`, failed].filter(Boolean).join('\n');
  return [rows.length ? summaryText(rows, full) : `Nothing for "${find}" in this game's modules and ops`,
    ...lib.map(e => `library: ${e.name} [${e.kind}] ${e.summary} (threedog lib pull ${e.name})`), failed].filter(Boolean).join('\n');
}

/** Bridge command: r is the page result { data, ids, ops } of engine.catalog(id) */
export function catalogCommand(r, id, opt, dir, library = null) {
  const max = opt.max || MAX_TEXT, cut = s => s.length > max ? s.slice(0, max) + '\n… (--max N for more, --json for the data)' : s;
  if (!id && opt.find) return { ok: true, text: cut(findText(r.data, library, opt)), data: { rows: r.data, library } };
  if (!id) return { ok: true, text: cut(summaryText(r.data, opt.full)), data: r.data };
  if (!r.data) return { ok: false, text: `✗ catalog: no module or op "${id}". Modules: ${r.ids.join(', ')}; ops: ${r.ops.slice(0, 20).join(', ')}` };
  const where = locate(id, r.data.kind, dir);
  const data = { ...r.data, files: where };
  if (data.params && data.kind !== 'op') {   // type and description come from the JSDoc-generated api page (drawing parts: their own desc)
    data.params = Object.fromEntries(Object.entries(data.params).map(([k, s]) => [k, { ...s }]));
    const missing = mergeDocs(data.params, data.kind === 'module' ? metadata.modules[id]?.params : null);
    if (missing.length) data.problems = [...(data.problems ?? []), `${missing.length} param(s) without a description (no doc): ${missing.join(', ')}`];
  }
  const known = r.data.kind === 'module' ? metadata.modules[id] : null, pub = known?.page ? new Set(known.names) : null;   // only what the api page lists: the page keeps internal fields (engine, uniforms...) out
  if (pub && data.queries) data.queries = { ...data.queries, api: data.queries.api.filter(n => pub.has(n)).slice(0, MAX_API) };
  return { ok: true, text: cut(data.kind === 'op' ? opText(data, where) : moduleText(data, where)), data };
}

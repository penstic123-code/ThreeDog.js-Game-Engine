// GAMEMAP sections for what a game declares in code rather than in one content file (used by packages/tools/gamemap.mjs):
// the content inventory line, object templates (content/templates.js + props { template } + engine.content.spawn), grids (grids.add / grids.define)
// and the game's own events (interface GameEvents in the game's *.d.ts, merged with the events its code emits and listens to).
import { walk as walkAll, read, uniq, balanced, balancedAll, splitTop } from '../lib/text.mjs';

const noComments = t => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const flat = s => s.replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const NOT_CONTENT = new Set(['rules', 'startItems']);

/** "Content: items 12 · npcs 5 · props 40 (templates 2) · kinds: crops 6": the inventory an AI sees before the details */
export function contentLine(c) {
  const n = v => Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0;
  const kinds = Object.keys(c.rules?.kinds || {});
  const parts = Object.entries(c).filter(([k]) => !NOT_CONTENT.has(k) && !kinds.includes(k)).map(([k, v]) =>
    k === 'props' && v.some?.(p => p.template) ? `props ${v.length} (from templates ${v.filter(p => p.template).length})` : `${k} ${n(v)}`);
  if (kinds.length) parts.push(`kinds: ${kinds.map(k => `${k} ${n(c[k])}`).join(', ')}`);
  return parts.length ? `Content: ${parts.join(' · ')}` : 'Content: none (no content/ folder)';
}

/** ops the game defines in code (ops.define('name', …)) */
export const opsDefined = code => new Set([...code.matchAll(/ops\.define\(\s*'([\w.:-]+)'/g)].map(m => m[1]));

/** Object templates: one table row per template, with placements (props { template }) and runtime spawns (content.spawn('name', …)) */
export function templateLines(c, files, g) {
  const t = c.templates || {};
  const names = Object.keys(t);
  if (!names.length) return [];
  const code = files.map(f => [f, noComments(read(f))]);
  const ops = opsDefined(code.map(x => x[1]).join('\n'));
  const spawned = {};
  for (const [f, text] of code) for (const m of text.matchAll(/content\.spawn\(\s*'([\w-]+)'/g)) (spawned[m[1]] ||= new Set()).add(g(f));
  const fn = v => typeof v === 'function' ? '(fn)' : v;
  const show = v => v === undefined ? '—' : typeof v === 'function' ? '(fn)' : typeof v === 'object' ? JSON.stringify(v, (k, x) => typeof x === 'function' ? '(fn)' : x) : String(v);
  const rows = names.map(name => {
    const d = t[name] || {}, it = d.interact;
    const placed = (c.props || []).filter(p => p.template === name);
    const where = uniq(placed.map(p => p.place ?? 'world'));
    const inst = [placed.length ? `${placed.length} placed (${cut(where.join(', '), 40)})` : '', spawned[name] ? `spawned in ${[...spawned[name]].join(', ')}` : ''].filter(Boolean).join(' + ') || 'none';
    const op = it?.op && typeof it.op === 'string' && !ops.has(it.op) ? ` ⚠ op "${it.op}" not defined` : '';
    const box = d.container ? `${d.container.capacity ?? '?'} slots${d.container.maxWeight ? `, ${d.container.maxWeight} kg` : ''}` : '—';
    const state = d.state && typeof d.state === 'object' ? Object.entries(d.state).map(([k, v]) => `${k}=${show(v)}`).join(', ') : '—';
    return `| ${name} | ${show(fn([d.model].flat()[0]))} | ${show(d.collide)} | ${it ? `${show(it.op)} / ${show(it.label)}${op}` : '—'} | ${box} | ${cut(state, 60)} | ${inst} |`;
  });
  const lost = Object.keys(spawned).filter(n => !names.includes(n)).map(n => `- ⚠ content.spawn('${n}') in ${[...spawned[n]].join(', ')}: no such template`);
  return ['| Template | Model | Collide | Interact (op / label) | Container | State (defaults) | Instances |', '|---|---|---|---|---|---|---|', ...rows, ...lost];
}

/** Grids: grids.add('farm', { cell, origin, size }) and grids.define('bed', { size, layer, ground }) in game code */
export function gridLines(files, g) {
  const out = [];
  for (const f of files) {
    const text = noComments(read(f));
    for (const [call, label] of [['grids.add(', 'Grid'], ['grids.define(', 'Grid item']]) for (const { body } of balancedAll(text, call)) {
      const [id, opts] = splitTop(body);
      out.push(`- ${label} **${(id || '?').replace(/^['"`]|['"`]$/g, '')}**${opts ? `: ${cut(flat(opts).replace(/^\{\s*|\s*\}$/g, ''), 80)}` : ''} — ${g(f)}`);
    }
  }
  return uniq(out);
}

/** interface GameEvents in the game's *.d.ts: Map name → { args, doc, file } */
export function declaredEvents(dir, g) {
  const out = new Map();
  for (const f of walkAll(dir, { exts: /\.d\.ts$/, skip: ['tests'] })) {
    const body = balanced(read(f), 'interface GameEvents {');
    if (body) for (const m of body.matchAll(/(?:\/\*\*\s*([\s\S]*?)\s*\*\/\s*)?'([\w:]+)'\s*:\s*(\[[^\]]*\])/g)) out.set(m[2], { args: flat(m[3]), doc: flat(m[1] || ''), file: g(f) });
  }
  return out;
}

/** Events table rows (game emits / listens), with the GameEvents declaration and drift warnings when the game declares any */
export function eventLines(ev, declared) {
  const names = uniq([...Object.keys(ev), ...declared.keys()]).sort();
  if (!names.length) return [];
  if (!declared.size) return ['| Event | Emitted by the game | Listened to by the game |', '|---|---|---|',
    ...names.map(n => `| ${n} | ${uniq(ev[n].emit).join(', ') || '—'} | ${uniq(ev[n].on).join(', ') || '—'} |`)];
  const file = [...declared.values()][0].file;
  const rows = names.map(n => {
    const v = ev[n] || { emit: [], on: [] }, d = declared.get(n);
    const flag = !d && v.emit.length ? ' ⚠ emitted but not declared (args unchecked)' : d && !v.emit.length ? ' ⚠ declared but never emitted' : '';
    return `| ${n} | ${uniq(v.emit).join(', ') || '—'} | ${uniq(v.on).join(', ') || '—'} | ${d ? `\`${cut(d.args, 70)}\`` : '—'}${flag} | ${d?.doc ? cut(d.doc, 50) : ''} |`;
  });
  return [`Declared in \`${file}\` (interface GameEvents).`, '', '| Event | Emitted by the game | Listened to by the game | Declared args | Note |', '|---|---|---|---|---|', ...rows];
}

/**
 * "Read for this game": one line per installed module, pointing at the recipe that uses it most and its api page.
 * apiPage maps install function → api page file name (grids.md); recipes is [[file name, text]]. A farming game gets grid / terrain / clock;
 * a game without net never sees the net recipe.
 */
export function readForLines(installed, apiPage, recipes, docRef, max = 10) {
  let rows = [];
  for (const fn of installed) {
    const page = apiPage.get(fn); if (!page) continue;
    const ns = page.replace(/\.md$/, '');
    const re = new RegExp(`engine\\.${ns}\\b|\\b${fn}\\(`, 'g');
    const best = recipes.map(([f, t]) => [f, (t.match(re) || []).length]).filter(x => x[1] >= 2).sort((a, b) => b[1] - a[1])[0];
    rows.push([!best, `- ${ns}: ${best ? `\`${docRef('docs/recipes/' + best[0])}\` · ` : ''}\`${docRef('docs/api/' + page)}\``]);
  }
  rows = rows.sort((a, b) => a[0] - b[0]).map(r => r[1]);   // modules with a recipe first
  return rows.length > max ? [...rows.slice(0, max), `- …${rows.length - max} more modules: their pages are in \`${docRef('docs/api/')}\``] : rows;
}

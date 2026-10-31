// Game content kinds (content/rules.js kinds, see the engine's modules/content/rules.js): validation for content-check.mjs and the GAMEMAP section.
import { kindProblems } from './load.mjs';

/** ctx: { c, err, warn, known }. Runs each kind's own check(data, ctx) on its file; a throwing check is reported, not fatal */
export function checkKinds({ c, err, warn, known }) {
  const kinds = c.rules?.kinds || {};
  for (const m of kindProblems(c.rules)) err('rules', m);
  for (const [name, k] of Object.entries(kinds)) {
    if (!k?.desc) warn('rules', `kind "${name}" should have a one-line desc (the game map and the file list use it)`);
    if (c[name] === undefined || typeof k?.check !== 'function') continue;
    try { k.check(c[name], { err: m => err(name, m), warn: m => warn(name, m), data: c, known }); }
    catch (e) { err('rules', `check() of kind "${name}" threw: ${e.message}`); }
  }
}

/** GAMEMAP lines for the game's own content kinds: desc, then map(data) or the entry count and ids */
export function kindMapLines(c, cut) {
  const out = [];
  for (const [name, k] of Object.entries(c.rules?.kinds || {})) {
    const data = c[name], ids = data && typeof data === 'object' ? (Array.isArray(data) ? data.map((x, i) => x?.id ?? `#${i + 1}`) : Object.keys(data)) : [];
    out.push(`- **${name}** (content/${name}.js) ${k?.desc ?? ''}`);
    let lines = null;
    try { lines = data !== undefined && typeof k?.map === 'function' ? k.map(data) : null; } catch (e) { lines = [`(map() threw: ${e.message})`]; }
    if (lines) out.push(...lines.map(l => `  - ${l}`));
    else out.push(`  - ${ids.length} entries${ids.length ? ': ' + cut(ids.join(', '), 160) : ''}`);
  }
  return out;
}

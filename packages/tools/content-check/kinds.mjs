// Game content kinds (content/rules.js kinds, see the engine's modules/content/rules.js): validation for content-check.mjs and the GAMEMAP section.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { kindProblems, contentFiles, unknownContent } from './load.mjs';

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

/**
 * The names `export default { ... }` of content/index.js hands over, or null when it is not an object written out; spread = it also spreads something in.
 * shortcut: reads the source, not the module: index.js may use import.meta.glob (recipe 30), which only runs under vite. A computed export is not read.
 */
function listedNames(src) {
  // comments are stripped from the object only: a glob string like './props/*.js' reads as the start of one
  const body = [...src.matchAll(/export\s+default\s*\{([^}]*)\}/g)].at(-1)?.[1];
  if (body === undefined) return null;
  const parts = body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ').split(',').map(s => s.trim()).filter(Boolean);
  return { names: new Set(parts.filter(p => !p.startsWith('...')).map(p => p.match(/^['"]?([\w$-]+)/)?.[1]).filter(Boolean)), spread: parts.some(p => p.startsWith('...')) };
}

/**
 * Check what the page will really load. Everything else here reads the files in content/, but the page loads what content/index.js exports, so a
 * kind registered in rules.js can pass here and stop the page when `rules` is not listed. Same rule as the loader: contentFiles() of the rules it is handed.
 * ctx: { dir, c, files, code (the game's source outside content/), err, warn }
 */
export function checkListed({ dir, c, files, code, err, warn }) {
  const path = join(dir, 'content', 'index.js');
  const listed = existsSync(path) ? listedNames(readFileSync(path, 'utf8')) : null;
  if (!listed) return;
  const { names, spread } = listed;
  const importsItself = name => new RegExp(`content/${name}(\\.js|/)?['"\`]`).test(code);   // main.js hands this one over on its own
  const rulesHanded = names.has('rules') || spread || importsItself('rules');
  const known = contentFiles(rulesHanded ? c.rules : undefined);
  for (const name of names) {
    if (name === 'name' || known[name]) continue;
    if (c.rules?.kinds?.[name]) err('index', `lists "${name}" but not \`rules\`, so the page stops with content.load: unknown content "${name}". The loader knows a kind only from the rules it is handed: add \`import rules from './rules.js'\` and list \`rules\` here`);
    else if (!files[name]) err('index', unknownContent(name, c.rules));   // with a file, the file itself was already reported
  }
  if (spread) return;
  for (const name of Object.keys(files)) {
    const kind = c.rules?.kinds?.[name];
    if (names.has(name) || importsItself(name) || (kind && !kind.load)) continue;   // a kind with no load is read by the game itself
    if (name === 'rules' && !c.rules?.conditions) continue;                        // kinds alone: the lines above decide
    if (name === 'startItems' && importsItself('items')) continue;
    warn(name, `is not listed in content/index.js, so engine.content.load never gets it: add it there, or ignore this if the game reads the file itself`);
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

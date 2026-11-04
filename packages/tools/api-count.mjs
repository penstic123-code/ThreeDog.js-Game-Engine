// threedog api-count [--json] [--unused]: count the public surface an AI meets, and list the items nothing uses (deletion candidates;
// the ones kept on purpose are reported apart, see keptWhy).
// Source of truth: the public type declarations (index.d.ts, types/tsl.d.ts, @threedog/post-effects index.d.ts) read with the TypeScript checker,
// because that is what an AI's editor and `npm run types` see, and the checker resolves generated re-exports, inheritance and ModuleDef<Api>.
// The CLI comes from the command tables in bin/threedog.mjs and the literal option lists of each tool; error codes from core/errorCodes.js.
// "Used" = found in engine sources, examples, the new-game templates or recipe code blocks (tests and prose docs are not users). Name matching is
// a heuristic: a name shared by several items must be written qualified (parent.name) to count. Record: docs/testing/api-count.md.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, ENGINE, TOOLS, MODE, addonDir, cli } from './paths.mjs';

const require = createRequire(import.meta.url);
const relp = p => relative(ROOT, p).split(sep).join('/');

/** All public items: { group, name, decl, kind } (decl: repo-relative file of the declaration) */
export function collect() {
  const ts = require('typescript');
  const entries = [join(ENGINE, 'index.d.ts'), join(ENGINE, 'types/tsl.d.ts'), join(addonDir('post-effects'), 'index.d.ts')].filter(existsSync);
  const program = ts.createProgram(entries, { noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext });
  const ch = program.getTypeChecker(), items = [];
  const declOf = s => { const d = s?.declarations?.[0]; return d ? relp(d.getSourceFile().fileName) : '?'; };
  const fromLib = s => s?.declarations?.some(d => /node_modules[\\/](@types[\\/]three|typescript[\\/]lib)[\\/]/.test(d.getSourceFile().fileName));
  // what: the first sentence of the declaration's doc comment (the list of candidates says what each one is)
  const what = s => (s ? ts.displayPartsToString(s.getDocumentationComment(ch)) : '').split(/\n|(?<=[.;:])\s/)[0].slice(0, 120);
  const add = (group, name, s, kind) => items.push({ group, name, decl: declOf(s), kind, what: what(s) });
  const propsOf = t => t ? ch.getPropertiesOfType(ch.getNonNullableType(t)).filter(p => !p.name.startsWith('_') && !p.name.startsWith('#') && !p.name.startsWith('__@')) : [];
  const typeOf = (s, at) => ch.getTypeOfSymbolAtLocation(s, at);
  const isCallable = t => ch.getNonNullableType(t).getCallSignatures().length > 0;
  const isObj = t => { const n = ch.getNonNullableType(t); return !!(n.flags & ts.TypeFlags.Object) && !isCallable(n) && propsOf(n).length > 0 && !ch.isArrayType(n); };
  const modOf = f => ch.getSymbolAtLocation(program.getSourceFile(f));
  const exportsOf = f => { const m = modOf(f); return m ? ch.getExportsOfModule(m).map(s => s.flags & ts.SymbolFlags.Alias ? ch.getAliasedSymbol(s) : s) : []; };
  const index = program.getSourceFile(entries[0]);

  // exported values ('threedog', 'threedog/tsl', '@threedog/post-effects'); module factories are counted again below as modules
  const exp = exportsOf(entries[0]).filter(s => s.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable | ts.SymbolFlags.Class) && s.name !== 'THREE');
  for (const s of exp) add('exports threedog', s.name, s, 'export');
  for (const s of exportsOf(entries[1]).filter(s => s.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable))) add('exports threedog/tsl', s.name, s, 'export');
  if (entries[2]) for (const s of exportsOf(entries[2]).filter(s => s.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable))) add('exports @threedog/post-effects', s.name, s, 'export');

  // createEngine options
  const ce = exp.find(s => s.name === 'createEngine');
  const ceSig = typeOf(ce, index).getCallSignatures()[0];
  for (const p of propsOf(typeOf(ceSig.parameters[0], index))) add('createEngine options', p.name, p, 'option');

  // module factories: functions returning ModuleDef<Api>; options = the first parameter's keys, API = Api's members named by the engine
  // property that holds it (engine.cameraRig for the four cameras: one API type is counted once)
  const engineSym = exportsOf(entries[0]).find(s => s.name === 'Engine' && s.flags & ts.SymbolFlags.Class);
  const engineProps = propsOf(ch.getDeclaredTypeOfSymbol(engineSym));
  const holder = new Map(engineProps.map(p => [ch.getNonNullableType(typeOf(p, index)).symbol, p.name]).filter(([s]) => s));
  const apiSyms = new Set();
  for (const s of exp) {
    const sig = typeOf(s, index).getCallSignatures()[0], ret = sig && sig.getReturnType();
    if (!ret || ret.aliasSymbol?.name !== 'ModuleDef' && ret.symbol?.name !== 'ModuleDef') continue;
    const api = ret.aliasTypeArguments?.[0] ?? ret.typeArguments?.[0] ?? ch.getTypeArguments?.(ret)?.[0];
    const opt = sig.parameters[0] && typeOf(sig.parameters[0], index);
    if (opt && !(ch.getNonNullableType(opt).flags & ts.TypeFlags.Any)) for (const p of propsOf(opt)) add('module options', `${s.name}.${p.name}`, p, 'option');
    if (!api || api.flags & ts.TypeFlags.Any || !api.symbol || apiSyms.has(api.symbol)) continue;
    apiSyms.add(api.symbol);
    const at = holder.get(api.symbol) ?? s.name;
    for (const p of propsOf(api)) add('module APIs', `${at}.${p.name}`, p, 'member');
  }

  // engine.*: members, and one level into core sub-objects (not three.js / DOM / built-in objects or module APIs)
  for (const p of engineProps) {
    add('engine members', p.name, p, 'member');
    const t = typeOf(p, index);
    const nt = ch.getNonNullableType(t);
    if (!isObj(t) || fromLib(nt.symbol) || apiSyms.has(nt.symbol) || nt.flags & ts.TypeFlags.Any) continue;
    for (const q of propsOf(t)) if (!fromLib(q)) add('engine sub-objects', `${p.name}.${q.name}`, q, 'member');
  }
  return items;
}

/** CLI commands (bin tables) and their options (the literal flags / values lists each tool passes to the shared parser) */
export async function cliItems() {
  const { SCRIPTS, BRIDGE, VITE } = await import('./bin/threedog.mjs');
  const items = [...VITE, 'map', ...Object.keys(SCRIPTS), ...BRIDGE].map(c => ({ group: 'CLI commands', name: c, decl: 'packages/tools/bin/threedog.mjs', kind: 'cli' }));
  const seen = new Set();
  const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return n === 'tests' || n === 'node_modules' || n === 'templates' ? [] : statSync(p).isDirectory() ? walk(p) : /\.mjs$/.test(n) ? [p] : []; });
  for (const f of walk(TOOLS)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\b(flags|values|lists):\s*\[([^\]]*)\]/g)) for (const q of m[2].matchAll(/'([a-z][\w-]*)'/g)) {
      const key = relp(f) + ' --' + q[1];
      if (!seen.has(key)) { seen.add(key); items.push({ group: 'CLI options', name: '--' + q[1], decl: relp(f), kind: 'flag' }); }
    }
  }
  return items;
}

export async function errorItems() {
  const { ERROR_CODES } = await import(new URL('file:///' + join(ENGINE, 'core/errorCodes.js').replace(/\\/g, '/')).href);
  return Object.keys(ERROR_CODES).map(c => ({ group: 'error codes', name: c, decl: relp(join(ENGINE, 'core/errorCodes.js')), kind: 'error' }));
}

// ── who uses it ──
const SKIP = new Set(['node_modules', 'tests', 'docs', 'public', 'types', 'dist', '.threedog']);
function files(d, re, out = []) {
  if (!existsSync(d)) return out;
  for (const n of readdirSync(d)) { if (SKIP.has(n)) continue; const p = join(d, n); if (statSync(p).isDirectory()) files(p, re, out); else if (re.test(n)) out.push(p); }
  return out;
}
/** The text of every user: [{ file, where, text }]; where = 'engine' | 'example' | 'template' | 'recipe' */
export function corpus() {
  const code = /\.(m?js|html|json)$/;
  const out = [];
  for (const d of ['core', 'modules', 'render', 'ui']) for (const f of files(join(ENGINE, d), /\.js$/)) out.push({ file: relp(f), where: 'engine', text: readFileSync(f, 'utf8') });
  out.push({ file: relp(join(ENGINE, 'index.js')), where: 'engine', text: readFileSync(join(ENGINE, 'index.js'), 'utf8') });
  // presets are option bundles a game picks: they count as a user of the options they set
  out.push({ file: relp(join(ENGINE, 'presets.js')), where: 'preset', text: readFileSync(join(ENGINE, 'presets.js'), 'utf8') });
  for (const a of ['post-effects', 'terrain-noise']) for (const f of files(addonDir(a), /\.js$/)) out.push({ file: relp(f), where: 'engine', text: readFileSync(f, 'utf8') });
  for (const f of files(join(ENGINE, 'examples'), code)) out.push({ file: relp(f), where: 'example', text: readFileSync(f, 'utf8') });
  for (const f of files(join(TOOLS, 'templates'), /\.(m?js|html|json|md)$/)) out.push({ file: relp(f), where: 'template', text: readFileSync(f, 'utf8') });
  const rdir = join(ENGINE, 'docs/recipes');
  for (const n of existsSync(rdir) ? readdirSync(rdir).filter(n => n.endsWith('.md')) : []) {
    const blocks = [...readFileSync(join(rdir, n), 'utf8').matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map(m => m[1]).join('\n');
    out.push({ file: relp(join(rdir, n)), where: 'recipe', text: blocks });
  }
  return out;
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Mark each item used / unused; returns the unused ones with the kinds of places that use them (none) */
export function usage(items, texts) {
  const leaf = i => i.name.split('.').pop();
  const count = new Map();
  for (const i of items) count.set(i.kind + ':' + leaf(i), (count.get(i.kind + ':' + leaf(i)) ?? 0) + 1);
  const hit = (re, skipDecl) => texts.some(t => (!skipDecl || t.file !== skipDecl) && re.test(t.text));
  const raised = new Set();
  // a code is raised when engine code names it as a string or a [code] tag (often through a variable: const code = slot ? 'a' : 'b')
  for (const t of texts) if (t.where === 'engine' && !t.file.endsWith('core/errorCodes.js')) for (const m of t.text.matchAll(/['"`[]([a-z0-9]+(?:-[a-z0-9]+)+)['"`\]]|\b(?:codedError|coded)\(\s*'([a-z0-9-]+)'/g)) raised.add(m[1] ?? m[2]);
  const users = t => texts.filter(x => x.where !== 'engine' || t);   // engine sources count for every kind
  for (const i of items) {
    const n = esc(leaf(i)), parent = i.name.includes('.') ? esc(i.name.split('.').slice(-2, -1)[0]) : null;
    const unique = count.get(i.kind + ':' + leaf(i)) === 1;
    let used;
    switch (i.kind) {
      case 'export': used = hit(new RegExp(`(^|[^\\w.$'"])${n}\\b(?!\\s*[:(]?\\s*function)`, 'm')) && texts.some(t => new RegExp(`\\b${n}\\s*\\(|import\\s*\\{[^}]*\\b${n}\\b|\\b${n}\\.|[,(\\[]\\s*${n}\\b`).test(t.text.replace(new RegExp(`(export\\s+)?(async\\s+)?function\\s+${n}\\b|export\\s+(const|let|class)\\s+${n}\\b`, 'g'), ''))); break;
      case 'option': used = users(false).some(t => new RegExp(`\\b${n}\\s*:`).test(t.text)) || (i.group === 'createEngine options' && texts.some(t => new RegExp(`createEngine\\([^)]*\\b${n}\\b`).test(t.text))); break;
      case 'cli': used = texts.some(t => t.where !== 'engine' && new RegExp(`(threedog|npm run)\\s+${n}\\b|"${n}"\\s*:`).test(t.text)); break;
      case 'flag': used = true; break;   // options are not traced per command (a flag name alone says too little); counted only
      case 'error': used = raised.has(i.name); break;
      default: {
        const q = parent ? new RegExp(`\\b${parent}\\??\\.${n}\\b`) : new RegExp(`\\bengine\\??\\.${n}\\b`);
        const bare = new RegExp(`\\.${n}\\b(?!\\s*=[^=>])|\\{[^}]*\\b${n}\\b[^}]*\\}\\s*=\\s*(engine|this)`);
        used = hit(q) || (unique && hit(bare));
      }
    }
    i.used = !!used;
  }
  return items.filter(i => !i.used);
}

// Kept (留 in docs/testing/api-count.md): unused items the owner decided to keep, reported apart so they stop being candidates. CLI commands
// live in the terminal, not in code; error codes are what a game reads when something fails; an option with a default is tuning a game reaches
// for when it needs it. Except the picture parameters below: they still sit on module options and wait for the owner's call on moving them
// elsewhere (the proposal on that page), so they stay candidates.
const PICTURE_MOVE = new Set(['sky.moonSize', 'sky.orbitTilt', 'sky.orbitSway', 'sky.starScale', 'sky.dim', 'sky.gradientCurve', 'sky.skybox',
  'water.waveScale', 'water.waveSpeed', 'water.normalScale', 'water.normalRepeat', 'water.normalSpeed']);
/** Why an unused item is kept anyway, or null when it is a candidate */
export function keptWhy(i) {
  if (i.group === 'CLI commands') return 'CLI command (used in the terminal)';
  if (i.group === 'error codes') return 'error code';
  if ((i.group === 'module options' || i.group === 'createEngine options') && !PICTURE_MOVE.has(i.name)) return 'tuning option with a default';
  return null;
}

/** Totals per group in a fixed order */
export const GROUPS = ['createEngine options', 'engine members', 'engine sub-objects', 'module options', 'module APIs',
  'exports threedog', 'exports threedog/tsl', 'exports @threedog/post-effects', 'CLI commands', 'CLI options', 'error codes'];
export async function apiCount() {
  const items = [...collect(), ...await cliItems(), ...await errorItems()];
  const all = usage(items, corpus()), kept = all.filter(keptWhy), unused = all.filter(i => !keptWhy(i));
  const n = (list, g) => list.filter(i => i.group === g).length;
  const groups = Object.fromEntries(GROUPS.map(g => [g, { total: n(items, g), unused: n(unused, g), kept: n(kept, g) }]));
  const row = ({ group, name, decl, what }) => ({ group, name, decl, what });
  return { total: items.length, unusedTotal: unused.length, keptTotal: kept.length, groups, unused: unused.map(row), kept: kept.map(i => ({ ...row(i), why: keptWhy(i) })) };
}

if (import.meta.url === new URL('file:///' + process.argv[1].replace(/\\/g, '/')).href || process.argv[1]?.endsWith('api-count.mjs')) {
  if (MODE !== 'monorepo') { console.error('api-count reads the engine sources: run it in the threedog repository'); process.exit(1); }
  const { opt } = cli(process.argv.slice(2), { workspace: false, flags: ['json', 'unused'] });
  const r = await apiCount();
  if (opt.json) console.log(JSON.stringify(opt.unused ? r : { ...r, unused: undefined, kept: undefined }));
  else {
    const w = Math.max(...GROUPS.map(g => g.length)), kept = k => k ? `   kept ${k}` : '';
    for (const g of GROUPS) console.log(`${g.padEnd(w)}  ${String(r.groups[g].total).padStart(4)}   unused ${r.groups[g].unused}${kept(r.groups[g].kept)}`);
    console.log(`${'total'.padEnd(w)}  ${String(r.total).padStart(4)}   unused ${r.unusedTotal}${kept(r.keptTotal)}`);
    if (opt.unused) for (const g of GROUPS) { const u = r.unused.filter(i => i.group === g); if (u.length) console.log(`\n${g}: ${u.map(i => i.name).join(', ')}`); }
    else console.log('(unused = candidates; kept = unused but kept on purpose: tuning options, CLI commands, error codes; --unused lists the candidates; --json for data)');
  }
}

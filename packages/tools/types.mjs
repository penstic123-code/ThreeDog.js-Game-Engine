// Type check: npm run types
// Uses TypeScript to check whether game code (games/*, engine examples packages/engine/examples/, style packs packages/engine/styles/; scope is the
//   include in the root tsconfig.json) misuses the engine API: misspelled property names, wrong option names, missing arguments, wrong argument
//   types, calling methods that do not exist.
// The engine API types are in packages/engine/index.d.ts and packages/engine/types/*.d.ts (hand-written), and packages/engine/types/generated/
//   (generated from the JSDoc in JS source, see gentypes.mjs),
// and are picked up automatically when game code does import 'threedog'.
//
// This script does two things:
//   1. runs tsc and turns the raw errors into short summaries (file:line + reason) with a fix hint
//   2. checks that packages/engine/index.d.ts declares every export of packages/engine/index.js (a missing one means the declarations are stale and
//   must be added)
//
// Web (DOM) errors (such as el.style.opacity = 0.5 given a number, or window.game not existing on Window) are only shown as "hints", not failures —
// they run fine in the browser and have nothing to do with the engine API. The --strict-dom flag turns them into errors too.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import * as P from './paths.mjs';

const { ROOT } = P;
const STRICT_DOM = process.argv.includes('--strict-dom');
// --project <tsconfig>: check another config instead of the root one (the types guard test points it at a probe file with known mistakes)
// A game in its own repo without a tsconfig.json gets a default one in .threedog/ (all game .js and .d.ts, engine types through 'threedog')
const PROJECT = process.argv.includes('--project') ? process.argv[process.argv.indexOf('--project') + 1] : existsSync(join(ROOT, 'tsconfig.json')) ? join(ROOT, 'tsconfig.json') : defaultConfig();
const rel = p => relative(ROOT, p).split(sep).join('/');
function defaultConfig() {
  const f = join(ROOT, '.threedog', 'tsconfig.types.json');
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'bundler',
    allowJs: true, checkJs: true, noEmit: true, strict: false, skipLibCheck: false, resolveJsonModule: true, types: [] },
    include: ['../**/*.js', '../**/*.d.ts'], exclude: ['../**/node_modules', '../**/dist', '../.threedog', '../**/vite.config.js', '../**/tests'] }, null, 2));
  return f;
}

// ---------------------------------------------------------------------
// 1. Run tsc
// ---------------------------------------------------------------------
let tscBin;
try { tscBin = createRequire(import.meta.url).resolve('typescript/bin/tsc'); } catch { console.error('✗ TypeScript not found, run npm install first'); process.exit(1); }
const run = spawnSync(process.execPath, [tscBin, '-p', PROJECT, '--pretty', 'false', '--listFiles'], { cwd: ROOT, encoding: 'utf8' });
if (run.error) { console.error('✗ failed to run tsc:', run.error.message); process.exit(1); }
const out = (run.stdout || '') + (run.stderr || '');

// Declarations generated from JSDoc (packages/engine/types/generated/) must be up to date, otherwise the types games see do not match the source (monorepo only)
if (P.MODE === 'monorepo') {
  const g = spawnSync(process.execPath, [join(P.TOOLS, 'gentypes.mjs'), '--check'], { encoding: 'utf8' });
  if (g.status) { process.stdout.write(g.stdout + g.stderr); process.exit(1); }
}

// Game files checked (the project .js files listed by --listFiles)
const checked = out.split('\n').map(s => s.trim()).filter(s => s && !s.includes('(') && s.endsWith('.js') && !s.includes('node_modules')).map(s => rel(s));

// Error: file(line,col): error TSxxxx: message; the indented lines after it are extra explanation
const diags = [];
for (const line of out.split(/\r?\n/)) {   // tsc writes \r\n on Windows; a leftover \r would make the error regex below miss every line
  const m = line.match(/^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/);
  if (m) diags.push({ file: m[1], line: +m[2], col: +m[3], code: +m[4], msg: m[5], more: [] });
  else if (/^\s+\S/.test(line) && diags.length) diags[diags.length - 1].more.push(line.trim());
  else if (/^error TS\d+/.test(line)) diags.push({ file: 'tsconfig.json', line: 0, col: 0, code: 0, msg: line, more: [] });
}

// ---------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------
const srcCache = new Map();
const srcLine = (file, n) => {
  if (!srcCache.has(file)) { try { srcCache.set(file, readFileSync(join(ROOT, file), 'utf8').split('\n')); } catch { srcCache.set(file, []); } }
  return srcCache.get(file)[n - 1] || '';
};

// type name → which declaration file holds it (so an error can point to where the valid options are)
const typeHome = new Map();
for (const f of [P.abs(P.INDEX_DTS_REL), ...readdirSync(P.abs(P.TYPES_REL)).map(f => join(P.abs(P.TYPES_REL), f))]) {
  if (!f.endsWith('.d.ts') || !existsSync(f)) continue;
  for (const m of readFileSync(f, 'utf8').matchAll(/export (?:declare )?(?:interface|type|class) (\w+)/g)) typeHome.set(m[1], rel(f));
}
const where = t => { const name = t.match(/^(\w+)/)?.[1]; return name && typeHome.has(name) ? ` (valid forms: see ${name} in ${typeHome.get(name)})` : ''; };

/** Turn TypeScript's type notation into plain English */
function typeText(t) {
  t = t.trim();
  const lits = t.split(' | ').map(s => s.trim());
  if (lits.length > 1 && lits.every(s => /^"[^"]*"$/.test(s))) return 'one of ' + lits.map(s => s.slice(1, -1)).join(' / ');
  const map = { string: 'string', number: 'number', boolean: 'true/false', undefined: 'undefined (no value)', null: 'null',
    any: 'any value', void: 'no return value', 'number[]': 'array of numbers', 'string[]': 'array of strings' };
  if (map[t]) return map[t];
  if (/^"[^"]*"$/.test(t)) return `string ${t}`;
  if (/^\d+(\.\d+)?$/.test(t)) return `number ${t}`;
  if (t.startsWith('{') || t.startsWith('(')) return t.length > 60 ? 'an object/function' : t;
  return t.length > 70 ? t.slice(0, 67) + '…' : t;
}

/** The "who." in front of the error position: the engine in engine.inventroy */
function receiver(d) {
  const before = srcLine(d.file, d.line).slice(0, d.col - 1);
  const m = before.match(/([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|\[[^\]]*\]|\(\))*)\??\.$/);
  return m ? m[1] : null;
}

function translate(d) {
  const msg = d.msg;
  let m;
  // property does not exist
  if ((m = msg.match(/^Property '(.+?)' does not exist on type '(.+?)'\.(?: Did you mean '(.+?)'\?)?$/))) {
    const who = receiver(d);
    if (/Window|globalThis/.test(m[2])) return `window has no ${m[1]} (to attach a debug object write /** @type {any} */ (window).${m[1]} = …)`;
    const full = who ? `${who}.${m[1]}` : `${typeText(m[2])}.${m[1]}`;
    return `property does not exist: ${full}` + (m[3] ? `; did you mean \`${m[3]}\`?` : ` (${typeText(m[2])} has no ${m[1]})${where(m[2])}`);
  }
  // the engine has no such export
  if ((m = msg.match(/^(?:Module )?'?"?(.+?)"?'? has no exported member (?:named )?'(.+?)'\.(?: Did you mean '(.+?)'\?)?$/)))
    return `the engine has no export ${m[2]}` + (m[3] ? `; did you mean \`${m[3]}\`?` : ' (module name misspelled? available modules are in ' + P.INDEX_DTS_REL + ')');
  // misspelled option name (an unknown item in an object)
  if ((m = msg.match(/^Object literal may only specify known properties, (?:but|and) '(.+?)' does not exist in type '(.+?)'\.(?: Did you mean to write '(.+?)'\?)?$/))) {
    const short = m[2].replace(/<.*?>/g, '').split(' | ')[0];
    const t = m[2].startsWith('{') || short.length > 60 ? 'this object' : short;
    return `misspelled option name: ${m[1]} is not a known option of ${t}` + (m[3] ? `; did you mean \`${m[3]}\`?` : where(m[2]));
  }
  // missing required item
  if ((m = msg.match(/^Property '(.+?)' is missing in type '(.+?)' but required in type '(.+?)'\.$/)))
    return `missing required property: ${m[1]} (${typeText(m[3])} must have it)${where(m[3])}`;
  if ((m = msg.match(/^Type '(.+?)' is missing the following properties from type '(.+?)': (.+)$/)))
    return `missing required properties: ${m[3]} (${typeText(m[2])} needs them)${where(m[2])}`;
  // argument count
  if ((m = msg.match(/^Expected (\d+)(?:-(\d+))? arguments?, but got (\d+)\.$/)))
    return `wrong number of arguments: expected ${m[2] ? `${m[1]}–${m[2]}` : m[1]}, got ${m[3]}`;
  if ((m = msg.match(/^Expected at least (\d+) arguments?, but got (\d+)\.$/)))
    return `wrong number of arguments: expected at least ${m[1]}, got ${m[2]}`;
  // wrong type
  if ((m = msg.match(/^Argument of type '(.+?)' is not assignable to parameter of type '(.+)'\.$/)))
    return `wrong argument type: expected ${typeText(m[2])} here, got ${typeText(m[1])}` + detail(d);
  if ((m = msg.match(/^Type '(.+?)' is not assignable to type '(.+)'\.$/)))
    return `wrong type: expected ${typeText(m[2])} here, got ${typeText(m[1])}` + detail(d);
  // name not defined
  if ((m = msg.match(/^Cannot find name '(.+?)'\.(?: Did you mean '(.+?)'\?)?/)))
    return `name not defined: ${m[1]}` + (m[2] ? `; did you mean \`${m[2]}\`?` : ' (forgot to import it, or misspelled?)');
  if ((m = msg.match(/^Cannot find module '(.+?)'/)))
    return `file not found: ${m[1]} (wrong path?)`;
  if (/^This expression is not callable/.test(msg)) return 'this is not a function, it cannot be called with parentheses' + detail(d);
  if ((m = msg.match(/^'(.+?)' is possibly '(null|undefined)'/))) return `${m[1]} may be empty (${m[2]})`;
  if (/^No overload matches this call/.test(msg)) return 'the arguments match none of the forms of this function' + detail(d);
  if ((m = msg.match(/^Cannot assign to '(.+?)' because it is a read-only property\.$/))) return `${m[1]} is read-only and cannot be changed directly`;
  return `${msg} (original TypeScript message TS${d.code})`;
}
/** The most specific line of the extra explanation (such as "Types of property 'speed' are incompatible") */
function detail(d) {
  for (const line of d.more) {
    let m;
    if ((m = line.match(/^Types of property '(.+?)' are incompatible\.?$/)) || (m = line.match(/^The types of '(.+?)' are incompatible/))) return ` (the problem is in ${m[1]})`;
    if ((m = line.match(/^Object literal may only specify known properties, (?:but|and) '(.+?)' does not exist/))) return ` (unknown option ${m[1]})`;
  }
  return '';
}

/** Web element (DOM) errors unrelated to the engine */
function isDom(d) {
  const all = d.msg + ' ' + d.more.join(' ');
  if (/HTML\w*Element|CSSStyleDeclaration|EventTarget|'ChildNode'|'Node'|'Element'|Window|globalThis|'Document'|'Navigator'|'Location'/.test(all)) return true;
  if (d.code === 2322 && /\.(style\.\w+|textContent|innerText|innerHTML|value|src|href|title|alt|className|id|hidden)\s*=[^=]/.test(srcLine(d.file,
    d.line))) return true;
  return false;
}

const errors = [], hints = [];
for (const d of diags) {
  const at = d.line ? `${d.file}:${d.line}` : d.file;
  const text = d.code ? translate(d) : d.msg;
  if (!STRICT_DOM && d.code && isDom(d)) hints.push(`${at}  ${text}`);
  else errors.push(`${at}  ${text}`);
}

// ---------------------------------------------------------------------
// 2. Do the declarations cover all exports of packages/engine/index.js
// ---------------------------------------------------------------------
function jsExports(file) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const names = new Set(), star = [];
  const exported = n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s)) {
      if (!s.exportClause) star.push(s.moduleSpecifier?.text);
      else if (ts.isNamedExports(s.exportClause)) for (const el of s.exportClause.elements) names.add(el.name.text);
    } else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && exported(s) && s.name) names.add(s.name.text);
    else if (ts.isVariableStatement(s) && exported(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
    else if (ts.isExportAssignment(s)) names.add('default');
  }
  return { names, star };
}
function dtsValueExports(file) {
  const program = ts.createProgram([file], { noEmit: true, skipLibCheck: true, moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, types: [] });
  const checker = program.getTypeChecker(), sf = program.getSourceFile(file);
  const mod = sf && checker.getSymbolAtLocation(sf);
  const names = new Set();
  if (mod) for (const sym of checker.getExportsOfModule(mod)) {
    // export type { X } from …: type-only export (such as class PostFX, not public in JS, games only need its type), not counted as a runtime export
    if (sym.declarations?.some(d => ts.isExportSpecifier(d) && (d.isTypeOnly || d.parent.parent.isTypeOnly))) continue;
    const real = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    if (real.flags & ts.SymbolFlags.Value) names.add(sym.name);
  }
  return names;
}
const coverage = [];
const jsFile = P.abs(P.INDEX_JS_REL), dtsFile = P.abs(P.INDEX_DTS_REL), J = P.INDEX_JS_REL, D = P.INDEX_DTS_REL;
if (P.MODE !== 'monorepo') { /* the installed engine's own declarations are checked before it is published */ }
else if (!existsSync(dtsFile)) coverage.push(`${D} does not exist`);
else {
  const js = jsExports(jsFile), dts = dtsValueExports(dtsFile);
  for (const s of js.star) coverage.push(`${J} has export * from '${s}', which the script cannot check one by one; declare them by hand in index.d.ts`);
  for (const n of js.names) if (!dts.has(n)) coverage.push(`${J} exports ${n}, but ${D} does not declare it (game code using it would be misreported, please add it)`);
  for (const n of dts) if (!js.names.has(n)) coverage.push(`${D} declares ${n}, but ${J} does not export it (this fails at runtime, delete or rename it)`);
}

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------
// Grouped by source: examples, style packs styles, each game games/<name>
const group = f => P.under(f, P.EXAMPLES_REL) ? 'examples' : P.under(f, P.STYLES_REL) ? 'styles' : P.MODE === 'game' ? (f.startsWith('games/') ? f.split('/').slice(0, 2).join('/') : 'game') : f.split('/').slice(0, 2).join('/');
console.log(`Type check: ${checked.length} game files (${[...new Set(checked.map(group))].join(', ') || 'none'})`);
for (const e of errors) console.log('  ✗ ' + e);
for (const c of coverage) console.log('  ✗ ' + c);
for (const h of hints) console.log('  ! ' + h + '  ← web (DOM) type hint, not a misuse of the engine API, does not affect running');
const n = errors.length + coverage.length;
if (n) {
  console.log(`\n${n} errors. ✗ means the engine API is misused (or the declarations are stale); fix the code, then run npm run types again.`);
  process.exit(1);
}
console.log(`\n✓ No misuse of the engine API found${hints.length ? ` (plus ${hints.length} web (DOM) hints, which can be ignored)` : ''}.`);

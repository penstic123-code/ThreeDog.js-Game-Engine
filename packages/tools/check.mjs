// Hard-rule check: npm run check
// Finds places in the engine that break the three hard rules (see packages/engine/docs/AI.md and .claude/rules/). Errors (✗) must be fixed; warnings
//   (!) need a human look.
//   ✗ core (packages/engine/core) imports a module
//   ✗ new material created directly in engine code (core, modules, render, ui; use makeMaterial('purpose', {...}) so the style decides the
//   engine's own look). Games, examples and styles are not checked: `new THREE.*Material` there is plain three.js and always fine
//   ✗ Chinese text hard-coded in engine code (developer-facing text is English; player-facing text goes in the locale tables via engine.t())
//   ! non-neutral colors in the engine (the fallback color should be gray; real colors belong in the style)
//   ! a module imports another module's internal file (go through the public engine.xxx API or events)
//   ✗ a module has no display name module.<name> in the I18n core table (used by the loading screen)
// It also runs the rules in packages/tools/rules/R*.mjs one by one (described at the top of each file), with output grouped by rule, then the
//   generator checks (types, content, generated docs up to date) in parallel.
// In a game installed from npm (paths.mjs MODE 'game') only the game-side checks run: materials in game code, the rules marked game: true (doc
//   references, doc sizes), GAMEMAP up to date, content validation and types. The engine's own checks run in the monorepo.
//   npm run check -- --rule R4,R8   run only these rules (skips the hard-rule checks above and the generator checks below)
//   npm run check                   errors in full, warnings as one count line per rule
//   npm run check -- --verbose      list the warnings (the first 15 per rule) and extra rule info (for example which checkOptions R6 skipped)
//   npm run check -- --all          list every warning
//   npm run check -- -w <game>      scoped to one game (also when run from inside a game folder): only its problems are printed and set the exit
//                                   code; other games and the engine are one count line each
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import * as P from './paths.mjs';
import { walk as walkAll } from './lib/text.mjs';
import { checkScope } from './lib/scope.mjs';

const { TOOLS } = P;
// Exceptions: the debug panel is a dev tool; the string-table files are where text lives
const DEV_ONLY = [/modules\/debug\//];
const STRING_TABLE_FILES = [/strings\.js$/, /core\/I18n\.js$/];
// Allowed cross-module imports: [importing module, target path prefix, why]. Only worker-safe files that the owning module itself states are
// shared with a worker: the module's public entry (Collision.js, nav/index.js) imports core/math.js and with it three.js, which a worker must not load
const ALLOWED_CROSS = [
  ['characters', 'collision/grid.js', 'the path worker (characters/pathJob.js) rebuilds the collider grid with the same code collision uses'],
  ['characters', 'nav/navPath.js', 'the path worker runs the one navmesh search on its imported copy of the mesh (navPath.js says so)'],
];
// Engine files allowed to create materials directly (path regex): the material factory itself, and styles (they are where the art lives,
// so a pack may hand makeMaterial any three.js material). Only engine code is scanned (files below); games and examples are free to `new` materials
const MATERIAL_OK = [new RegExp(`^${P.ENGINE_REL}/render/materials\\.js$`), new RegExp(`^${P.STYLES_REL}/`)];
const DIRECT_MATERIAL = /new THREE\.Mesh(Lambert|Phong|Standard|Physical|Toon|Basic)Material/;

const MONO = P.MODE === 'monorepo';
const walk = d => walkAll(d, { exts: /\.js$/ });
const files = MONO ? [P.abs(P.INDEX_JS_REL), ...P.ENGINE_CODE_DIRS_REL.flatMap(d => walk(P.abs(d)))] : [];

const errors = [], warnings = [];
const CJK = /[一-鿿]/;
const stripComments = line => line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
const isGrey = hex => { const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255; return Math.max(r, g, b) - Math.min(r, g, b) <= 0x30; };

for (const file of files) {
  const rel = P.rel(file), text = readFileSync(file, 'utf8'), lines = text.split('\n');
  const devOnly = DEV_ONLY.some(r => r.test(rel)), table = STRING_TABLE_FILES.some(r => r.test(rel));
  const mod = P.under(rel, P.MODULES_REL) ? rel.slice(P.MODULES_REL.length + 1).split('/')[0] : undefined;
  let inStrings = 0;   // inside a STRINGS = { ... } string table
  lines.forEach((raw, i) => {
    const at = `${rel}:${i + 1}`;
    if (/^\s*(\*|\/\*|\/\/)/.test(raw)) return;                                  // comment line
    const code = stripComments(raw);
    if (/STRINGS\s*=\s*\{.*\};?\s*$/.test(raw)) return;                            // a string table written on one line
    if (/STRINGS\s*=\s*\{|i18n\.add\(\{/.test(raw)) inStrings = 1;
    if (inStrings) { inStrings += (raw.match(/\{/g) || []).length - (raw.match(/\}/g) || []).length; if (inStrings <= 1 && /\};?\s*$/.test(raw)) inStrings = 0; }

    // 1. core must not depend on modules
    if (P.under(rel, P.CORE_REL) && /from\s+['"]\.\.\/modules\//.test(code)) errors.push(`${at}  core imports a module`);
    // 2. direct new material
    if (!devOnly && !MATERIAL_OK.some(r => r.test(rel)) && DIRECT_MATERIAL.test(code)) {
      if (/debug|Debug/.test(raw)) warnings.push(`${at}  creates a material directly (debug use, please confirm)`);
      else errors.push(`${at}  creates a material directly, use makeMaterial('purpose', {...})`);
    }
    // 3. hard-coded Chinese (a string contains Chinese, and it is not an error/log message nor inside a string table)
    if (!devOnly && !table && !inStrings && CJK.test(code) && /(['"`])[^'"`]*[一-鿿][^'"`]*\1/.test(code)
      && !/console\.(warn|error|log|info)|throw new Error|new Error\(/.test(code)) {
      // a module's display name label is only a fallback; the loading screen prefers module.<name> from the string table
      if (/label:\s*'|rigModule\('/.test(code)) return;
      errors.push(`${at}  hard-coded Chinese text: ${raw.trim().slice(0, 70)}`);
    }
    // 4. non-neutral colors
    if (!devOnly) for (const m of code.matchAll(/0x([0-9a-fA-F]{6})\b/g)) if (!isGrey(parseInt(m[1],
      16))) warnings.push(`${at}  non-gray fallback color 0x${m[1]} (real colors belong in the style)`);
    // 5. cross-module imports of internal files
    if (mod) for (const m of code.matchAll(/from\s+['"]\.\.\/(?!\.\.\/)([^'"]+)['"]/g)) {
      const target = m[1];
      if (!ALLOWED_CROSS.some(([a, b]) => a === mod && target.startsWith(b))) warnings.push(`${at}  module "${mod}" imports ${target} directly`);
    }
  });
}

// Games and examples are not checked for direct materials here: a game's art is its own. R40 (bypass hints) warns when a hand-set color
// keeps a model from following the style, and can be switched off.

// Every module needs a display name module.<name> (used by the loading screen; the module's label is only a fallback)
const i18nCore = MONO ? readFileSync(P.abs(P.I18N_CORE_REL), 'utf8') : '';
for (const file of files.filter(f => P.under(P.rel(f), P.MODULES_REL))) {
  const text = readFileSync(file, 'utf8');
  const names = [...text.matchAll(/name: '(\w+)',\s*label\b/g)].map(m => m[1]);
  if (/rigModule\(/.test(text) && /export function \w+Camera/.test(text)) names.push('cameraRig');
  for (const n of new Set(names)) if (i18nCore.split(`'module.${n}':`).length < 3)   // once in the zh-CN table, once in the en table
    errors.push(`${P.rel(file)}  module "${n}" has no display name module.${n} in ${P.I18N_CORE_REL} (both languages are required)`);
}

const argv = process.argv.slice(2);
// Scoped check (lib/scope.mjs): -w <game>, or run from inside a game folder. Every check still runs, but only that game's errors and warnings are
// printed and decide the exit code; other games and the engine are one count line each. Plain check at the repo root stays repo-wide.
const scope = checkScope(argv);
const ruleArg = argv.includes('--rule') ? argv[argv.indexOf('--rule') + 1] : undefined;
if (argv.includes('--rule') && !ruleArg) { console.log('Usage: npm run check -- --rule R4,R8'); process.exit(1); }
const onlyRules = ruleArg ? ruleArg.toUpperCase().split(',') : null;
// the file of an "<file>:<line>  message" / "<file>  message" entry
const fileOf = s => s.match(/^[^\s:]+/)[0];
const keep = (list, level) => scope ? list.filter(s => scope.mine(fileOf(s)) || void scope.other(fileOf(s), level)) : list;
const myErrors = onlyRules ? [] : keep(errors, 'error'), myWarnings = onlyRules ? [] : keep(warnings, 'warn');
if (!onlyRules) {
  for (const e of myErrors) console.log('✗ ' + e);
  // warnings: one count line unless --verbose / --all (the same rule as the rule warnings, rules/index.mjs)
  if (argv.includes('--verbose') || argv.includes('--all')) for (const w of myWarnings) console.log('! ' + w);
  else if (myWarnings.length) console.log(`hard rules: ${myWarnings.length} warning${myWarnings.length > 1 ? 's' : ''} (details: --verbose)`);
  console.log(`\n${myErrors.length} errors, ${myWarnings.length} warnings (${scope ? `hard rules, ${scope.rel}` : `${files.length} files checked`})`);
}

// Rules packages/tools/rules/R*.mjs (directory: RULES_REL in paths.mjs)
const { runRules } = await import('./rules/index.mjs');
const ruleErrors = await runRules({ only: onlyRules, all: argv.includes('--all'), verbose: argv.includes('--verbose'), game: !MONO, scope });

// Generated docs and game maps up to date; game content validation; types. Run in parallel, printed in a fixed order.
// Scoped: that game's GAMEMAP, content and types (types.mjs filters to the game and hands back its other counts); the engine generators only add to
// the engine count (types.mjs covers the generated declarations)
const w = scope ? ['-w', scope.rel] : [];
const SUB = onlyRules ? [] : MONO && !scope ? [['gentypes.mjs', '--check'], ['codemap.mjs', '--check'], ['gamemap.mjs', '--check'], ['content-check.mjs'], ['types.mjs'], ['apidoc.mjs', '--check']]
  : [['gamemap.mjs', '--check', ...w], ['content-check.mjs', ...w], ['types.mjs', ...w, ...(scope ? ['--tally-json'] : [])]];
const ENGINE_SUB = scope && MONO && !onlyRules ? [['codemap.mjs', '--check'], ['apidoc.mjs', '--check']] : [];
const runSub = ([file, ...args]) => new Promise(res => {
  const c = spawn(process.execPath, [join(TOOLS, file), ...args]);
  let out = '';
  c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
  c.on('close', code => res({ out, code }));
});
let bad = myErrors.length + ruleErrors;
const [mine, eng] = await Promise.all([Promise.all(SUB.map(runSub)), Promise.all(ENGINE_SUB.map(runSub))]);
for (const r of mine) { process.stdout.write(scope ? scope.absorb(r.out) : r.out); if (r.code) bad++; }
for (const r of eng) if (r.code) scope.engine(1);
if (scope) {
  console.log(`\ncheck ${scope.rel}: ${bad ? 'FAILED' : 'passed'} (only this workspace's problems count; run plain npm run check at the root before committing engine changes)`);
  for (const line of scope.summary()) console.log(line);
}
process.exit(bad ? 1 : 0);

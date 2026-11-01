// Hard-rule check: npm run check
// Finds places in the engine that break the three hard rules (see packages/engine/docs/AI.md and .claude/rules/). Errors (✗) must be fixed; warnings
//   (!) need a human look.
//   ✗ core (packages/engine/core) imports a module
//   ✗ new material created directly in the engine, examples and games (packages/engine/examples/, games/) or style packs (packages/engine/styles/)
//   (use makeMaterial('purpose', {...}) so the style pack decides the look)
//   ✗ Chinese text hard-coded in engine code (developer-facing text is English; player-facing text goes in the locale tables via engine.t())
//   ! non-neutral colors in the engine (the fallback color should be gray; real colors belong in the style pack)
//   ! a module imports another module's internal file (go through the public engine.xxx API or events)
//   ✗ a module has no display name module.<name> in the I18n core table (used by the loading screen)
// It also runs the rules in packages/tools/rules/R*.mjs one by one (described at the top of each file), with output grouped by rule, then the
//   generator checks (types, content, generated docs up to date) in parallel.
// In a game installed from npm (paths.mjs MODE 'game') only the game-side checks run: materials in game code, the rules marked game: true (doc
//   references, doc sizes), GAMEMAP up to date, content validation and types. The engine's own checks run in the monorepo.
//   npm run check -- --rule R4,R8   run only these rules (skips the hard-rule checks above and the generator checks below)
//   npm run check -- --all          list all warnings (by default only the first 15 per rule)
//   npm run check -- --verbose      extra rule info (for example which checkOptions R6 skipped)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import * as P from './paths.mjs';
import { walk as walkAll } from './lib/text.mjs';

const { TOOLS } = P;
// Exceptions: the debug panel is a dev tool; the string-table files are where text lives
const DEV_ONLY = [/modules\/debug\//];
const STRING_TABLE_FILES = [/strings\.js$/, /core\/I18n\.js$/];
// Allowed cross-module imports (small shared helpers)
const ALLOWED_CROSS = [];
// Files allowed to create materials directly (path regex): the material factory itself, and style packs (they are where the art lives,
// so a pack may hand makeMaterial any three.js material); games and examples still go through makeMaterial so a style swap restyles them
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
      16))) warnings.push(`${at}  non-gray fallback color 0x${m[1]} (real colors belong in the style pack)`);
    // 5. cross-module imports of internal files
    if (mod) for (const m of code.matchAll(/from\s+['"]\.\.\/(?!\.\.\/)([^'"]+)['"]/g)) {
      const target = m[1];
      if (!ALLOWED_CROSS.some(([a, b]) => a === mod && target.startsWith(b))) warnings.push(`${at}  module "${mod}" imports ${target} directly`);
    }
  });
}

// Examples and games: only check for direct new materials
for (const file of [...new Set(P.gameDirs().flatMap(walk))]) {
  const rel = P.rel(file);
  if (MATERIAL_OK.some(r => r.test(rel))) continue;
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    if (!/^\s*(\*|\/\*|\/\/)/.test(raw) && DIRECT_MATERIAL.test(stripComments(raw))) errors.push(`${rel}:${i + 1}  creates a material directly, use makeMaterial('purpose', {...})`);
  });
}

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
// check -w <game>: only that game's checks (content validation + GAMEMAP up to date); the engine's hard rules and the whole-repo checks are skipped
const wi = argv.findIndex(a => a === '-w' || a === '--workspace');
if (wi >= 0) {
  const wsDir = P.findWorkspace(argv[wi + 1]);
  if (!wsDir) { console.log(`workspace "${argv[wi + 1]}" not found. Available: ${P.workspaces().map(P.rel).join(', ')}`); process.exit(1); }
  const w = ['-w', argv[wi + 1]];
  let bad = 0;
  for (const r of await Promise.all([['gamemap.mjs', '--check', ...w], ['content-check.mjs', ...w]].map(([f, ...a]) => new Promise(res => {
    const c = spawn(process.execPath, [join(TOOLS, f), ...a]); let out = '';
    c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d); c.on('close', code => res({ out, code }));
  })))) { process.stdout.write(r.out); if (r.code) bad++; }
  console.log(`
check -w ${P.rel(wsDir)}: ${bad ? 'FAILED' : 'passed'} (content + GAMEMAP only; run plain npm run check before committing engine changes)`);
  process.exit(bad ? 1 : 0);
}
const ruleArg = argv.includes('--rule') ? argv[argv.indexOf('--rule') + 1] : undefined;
if (argv.includes('--rule') && !ruleArg) { console.log('Usage: npm run check -- --rule R4,R8'); process.exit(1); }
const onlyRules = ruleArg ? ruleArg.toUpperCase().split(',') : null;
if (!onlyRules) {
  for (const e of errors) console.log('✗ ' + e);
  for (const w of warnings) console.log('! ' + w);
  console.log(`\n${errors.length} errors, ${warnings.length} warnings (${files.length} files checked)`);
}

// Rules packages/tools/rules/R*.mjs (directory: RULES_REL in paths.mjs)
const { runRules } = await import('./rules/index.mjs');
const ruleErrors = await runRules({ only: onlyRules, all: argv.includes('--all'), verbose: argv.includes('--verbose'), game: !MONO });
if (onlyRules) process.exit(ruleErrors ? 1 : 0);

// Generated docs and game maps up to date; game content validation; types. Run in parallel, printed in a fixed order
const SUB = MONO ? [['gentypes.mjs', '--check'], ['codemap.mjs', '--check'], ['gamemap.mjs', '--check'], ['content-check.mjs'], ['types.mjs'], ['apidoc.mjs', '--check']]
  : [['gamemap.mjs', '--check'], ['content-check.mjs'], ['types.mjs']];
const runSub = ([file, ...args]) => new Promise(res => {
  const c = spawn(process.execPath, [join(TOOLS, file), ...args]);
  let out = '';
  c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
  c.on('close', code => res({ out, code }));
});
let bad = errors.length + ruleErrors;
for (const r of await Promise.all(SUB.map(runSub))) { process.stdout.write(r.out); if (r.code) bad++; }
process.exit(bad ? 1 : 0);

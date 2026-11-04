// Rule check: npm run check
// Runs the rules in packages/tools/rules/R*.mjs one by one (each described at the top of its file, with its criteria and allowlist), output
//   grouped by rule: errors (✗) must be fixed; warnings (!) need a picture and can always be cleared (fixed, or confirmed the way the rule says).
//   The engine's hard rules are rules like the rest: R27 core imports or names no module, R14 no material made directly in engine code,
//   R15 no hard-coded Chinese text, R39 neutral fallback colors, R46 no import of another module's internal file, R3 every module has a
//   display name. Then the generator checks (types, content, generated docs up to date) run in parallel.
// In a game installed from npm (paths.mjs MODE 'game') only the game-side checks run: the rules marked game: true (doc references, doc sizes,
//   file sizes), GAMEMAP up to date, content validation and types. The engine's own checks run in the monorepo.
//   npm run check -- --rule R4,R8   run only these rules (R04 / r4 work too, and so does --rule R4 --rule R8; the generator checks below are skipped; an id that names no rule
//                                   is an error that lists them all)
//   npm run check                   errors in full, warnings as one count line per rule
//   npm run check -- --verbose      list the warnings (the first 15 per rule) and extra rule info (for example which checkOptions R6 skipped)
//   npm run check -- --all          list every warning
//   npm run check -- -w <game>      scoped to one game (also when run from inside a game folder): only its problems are printed and set the exit
//                                   code; other games and the engine are one count line each
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import * as P from './paths.mjs';
import { nearest } from './lib/text.mjs';
import { checkScope } from './lib/scope.mjs';

const MONO = P.MODE === 'monorepo';
// Scoped check (lib/scope.mjs): -w <game>, or run from inside a game folder. Every check still runs, but only that game's errors and warnings are
// printed and decide the exit code; other games and the engine are one count line each. Plain check at the repo root stays repo-wide.
// --r10-anon: read by R10 itself (duplicates with renamed variables)
const { dir: scopeDir, opt } = P.cli(process.argv.slice(2), { workspace: 'scope', flags: ['verbose', 'all', 'r10-anon'], values: ['rule'], lists: ['rule'] });
const scope = checkScope(scopeDir);
const { runRules, loadRules, normRuleId } = await import('./rules/index.mjs');
// --rule ids: R04 / r4 / R4 name rule R4. An id that names nothing is an error listing every id, never a run of nothing that reports "0 errors"
let onlyRules = null;
if (opt.rule) {
  const ids = (await loadRules()).map(r => r.rule.id), wanted = opt.rule.split(',').map(s => s.trim()).filter(Boolean).map(normRuleId);
  const unknown = wanted.filter(s => !ids.includes(s));
  if (unknown.length) {
    const close = [...new Set(unknown.flatMap(s => nearest(s, ids, 2)))];
    console.log(`✗ unknown rule ${unknown.map(s => `"${s}"`).join(', ')}${close.length ? ` (close: ${close.join(', ')})` : ''}\n  Rules: ${ids.join(' ')}`);
    process.exit(1);
  }
  onlyRules = wanted;
}
// a line per stage as it happens: a check that prints nothing for two minutes reads as hung, and the part results below are only printed once all are done
const t0 = Date.now(), stage = s => console.log(`… ${s} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
// scoped: only the rules that apply to a game. The others read the engine and its docs (R18 alone takes 14 s) and their results were dropped anyway
const ruleErrors = await runRules({ only: onlyRules, all: !!opt.all, verbose: !!opt.verbose, game: !MONO || !!scope, scope });

// Generated docs and game maps up to date; game content validation; types. Run in parallel, printed in a fixed order.
// Scoped: that game's GAMEMAP, content and types (types.mjs filters to the game and hands back its other counts); the engine generators only add to
// the engine count (types.mjs covers the generated declarations). They run at the root: a repo-wide check stays repo-wide wherever it was started
const w = scope ? ['-w', scope.rel] : [];
const NAMES = { 'gentypes.mjs': 'generated declarations', 'codemap.mjs': 'code map', 'gamemap.mjs': 'GAMEMAP', 'content-check.mjs': 'content',
  'types.mjs': 'type check', 'apidoc.mjs': 'API docs' };
const SUB = onlyRules ? [] : MONO && !scope ? [['gentypes.mjs', '--check'], ['codemap.mjs', '--check'], ['gamemap.mjs', '--check'], ['content-check.mjs'], ['types.mjs'], ['apidoc.mjs', '--check']]
  : [['gamemap.mjs', '--check', ...w], ['content-check.mjs', ...w], ['types.mjs', ...w, ...(scope ? ['--tally-json'] : [])]];
const ENGINE_SUB = scope && MONO && !onlyRules ? [['codemap.mjs', '--check'], ['apidoc.mjs', '--check']] : [];
const runSub = ([file, ...args]) => new Promise(res => {
  const c = spawn(process.execPath, [join(P.TOOLS, file), ...args], { cwd: P.ROOT });
  let out = '';
  c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
  c.on('close', code => { stage(`${NAMES[file]} finished`); res({ out, code }); });
});
let bad = ruleErrors;
stage('rules finished');
if (SUB.length) stage(`running in parallel: ${[...SUB, ...ENGINE_SUB].map(([f]) => NAMES[f]).join(', ')}`);
const [mine, eng] = await Promise.all([Promise.all(SUB.map(runSub)), Promise.all(ENGINE_SUB.map(runSub))]);
// The last line names every part that failed: "Rule checks: 0 errors" above is only the rules, and a failed type check printed far up the
// output read as a pass
const failed = ruleErrors ? [`rules ${ruleErrors} error${ruleErrors > 1 ? 's' : ''}`] : [];
mine.forEach((r, i) => {
  process.stdout.write(scope ? scope.absorb(r.out) : r.out);
  if (!r.code) return;
  bad++;
  const n = [...r.out.matchAll(/^(\d+) errors?\b/gm)].at(-1)?.[1];
  failed.push(NAMES[SUB[i][0]] + (n ? ` ${n} error${n === '1' ? '' : 's'}` : ''));
});
for (const r of eng) if (r.code) scope.engine(1);
if (scope) {
  console.log(`\ncheck ${scope.rel}: ${bad ? 'FAILED' : 'passed'} (only this workspace's problems count; run plain npm run check at the root before committing engine changes)`);
  for (const line of scope.summary()) console.log(line);
} else console.log(bad ? `\n✗ check FAILED: ${failed.join(', ')}` : '\n✓ check passed');
process.exit(bad ? 1 : 0);

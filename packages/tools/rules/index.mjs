// Rule runner: packages/tools/check.mjs calls runRules(). Finds packages/tools/rules/R*.mjs (sorted by number), runs each and prints the results grouped by rule.
// Each rule file exports default { id, title, run(), game? } (game: true = also runs in a game installed from npm); run returns [{ level: 'error'|'warn', file, line, msg, fix }],
// and the array may carry note (a one-line summary) and verbose (an extra list shown with --verbose).
// Default output: errors in full, warnings as one count line per rule; --verbose lists the warnings (the first WARN_LIMIT per rule), --all every one.
// A crashing rule does not stop the check: it is recorded as one error for that rule.
// scope (lib/scope.mjs, check -w <game>): only results in that workspace's files are printed and counted; the rest go to scope.other().
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULES_REL } from '../paths.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const WARN_LIMIT = 15;

export async function runRules({ only = null, all = false, verbose = false, game = false, scope = null } = {}) {
  const files = readdirSync(DIR).filter(f => /^R\d+.*\.mjs$/.test(f)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  let errors = 0, warns = 0, hidden = 0;
  const summary = [];
  console.log(`\nRule checks (${RULES_REL}/, each rule's criteria and allowlist are at the top of its file)`);
  for (const f of files) {
    const rule = (await import(`./${f}`)).default;
    if ((only && !only.includes(rule.id)) || (game && !rule.game)) continue;
    let res;
    try { res = await rule.run(); } catch (err) { res = [{ level: 'error', file: `${RULES_REL}/${f}`, line: 0, msg: `the rule itself crashed: ${err.message}`, fix: 'fix the rule script' }]; }
    if (scope) {
      for (const r of res) if (!scope.mine(r.file)) scope.other(r.file, r.level);
      res = res.filter(r => scope.mine(r.file));   // the rule's note describes the whole repo, so it is dropped with the rest
    }
    const es = res.filter(r => r.level === 'error'), ws = res.filter(r => r.level !== 'error');
    errors += es.length; warns += ws.length;
    summary.push(`${rule.id} ${es.length}✗ ${ws.length}!`);
    if (!res.length && !res.note) continue;
    // Short by default, detail on demand: errors print in full; a rule with only warnings is one line ("R1 file size: 92 warnings"), and
    // --verbose (or --all) lists them as before. Why: 90+ warning lines buried the one error an AI had to fix
    if (!verbose && !all && !es.length) {
      if (ws.length) { console.log(`${rule.id} ${rule.title}: ${ws.length} warning${ws.length > 1 ? 's' : ''}`); hidden += ws.length; }
      continue;
    }
    console.log(`\n── ${rule.id} ${rule.title}: ${es.length} errors, ${ws.length} warnings (${f})`);
    let lastFix = null;
    const show = r => {
      const at = r.line ? `${r.file}:${r.line}` : r.file;
      console.log(`${r.level === 'error' ? '✗' : '!'} ${at}  ${r.msg}`);
      if (r.fix && r.fix !== lastFix) console.log(`    Fix: ${r.fix}`);
      lastFix = r.fix;
    };
    es.forEach(show);
    if (!verbose && !all) { if (ws.length) { console.log(`  and ${ws.length} warning${ws.length > 1 ? 's' : ''}`); hidden += ws.length; } continue; }
    (all ? ws : ws.slice(0, WARN_LIMIT)).forEach(show);
    if (!all && ws.length > WARN_LIMIT) console.log(`  …${ws.length - WARN_LIMIT} more warnings (npm run check -- --rule ${rule.id} --all shows all)`);
    if (res.note) console.log(`  (${res.note})`);
    if (verbose && res.verbose?.length) for (const v of res.verbose) console.log('    · ' + v);
  }
  console.log(`\nRule checks: ${errors} errors, ${warns} warnings  [${summary.join(' · ')}]`);
  if (hidden) console.log(`details: --verbose (the warnings, the first ${WARN_LIMIT} per rule; --all for every one)`);
  return errors;
}

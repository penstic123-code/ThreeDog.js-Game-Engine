// threedog verify <scenario>: run a scenario file (tests/scenarios/<name>.json, see scenario.mjs) on the running page and report not only pass / fail but
// what the run tested and what it never touched, so "passed" is not read as "the game works".
//   Tested      the ops it ran with the expected outcomes, the describe sections it compared, the time it advanced
//   Not tested  ops never run, describe sections never compared, steps that did not run after a failure, the real key path, the picture
//   Related     tests that mention an error code seen in the failure or in new page errors (grep over the test files), and the command to re-run this one
// A page error that appears during the run fails it too: a scenario that "passes" while the page logs an exception has not passed.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { runScenario, scenarioFiles, readScenario } from '../scenario.mjs';
import { allErrors, isError } from './errorlog.mjs';
import { ENGINE, TOOLS, rel } from '../paths.mjs';

const PAGE_FACTS = () => ({ ops: [...window.engine.ops.defs.keys()], sections: Object.keys(window.engine.describe()) });
const list = (xs, n = 5) => xs.slice(0, n).join(', ') + (xs.length > n ? ` … (+${xs.length - n})` : '');
const root = p => String(p).split(/\.|\[/)[0];

/** Test files that mention one of the codes: [{ name, at }] */
function relatedTests(dir, codes) {
  if (!codes.length) return [];
  const dirs = [join(dir, 'tests'), join(ENGINE, 'tests'), join(TOOLS, 'tests')], files = [];
  const walk = (d, depth) => {
    if (!existsSync(d) || depth > 2) return;
    for (const e of readdirSync(d)) {
      const f = join(d, e), s = statSync(f);
      if (s.isDirectory()) { if (!/^(node_modules|fixtures|snapshots)$/.test(e)) walk(f, depth + 1); } else if (/\.mjs$/.test(e)) files.push(f);
    }
  };
  dirs.forEach(d => walk(d, 0));
  const out = [];
  for (const f of new Set(files)) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (!codes.some(c => l.includes(`[${c}]`) || l.includes(`'${c}'`) || l.includes(`"${c}"`))) return;
      let name = null;
      for (let j = i; j >= Math.max(0, i - 80) && !name; j--) name = /(?:name:|check\()\s*['"`]([^'"`]{6,80})/.exec(lines[j])?.[1] ?? null;
      out.push({ name, at: `${rel(f)}:${i + 1}` });
    });
  }
  return out.slice(0, 3);
}

export async function verify(driver, dir, name) {
  const files = scenarioFiles(dir), stem = x => basename(x, '.json'), f = files.find(x => stem(x) === name);
  if (!f) throw new Error(`Usage: threedog verify name (a file in tests/scenarios/). Have: ${files.map(stem).join(', ') || 'none'}`);
  const sc = readScenario(f), before = allErrors(dir).length, res = [];
  await runScenario(driver, sc, { check: (label, ok, detail) => res.push({ label, ok, detail }), file: name, snapDir: join(dir, 'tests', 'snapshots') });
  const facts = await driver.evaluate(PAGE_FACTS.toString()), bad = res.filter(r => !r.ok);
  const pageErrors = allErrors(dir).slice(before).filter(isError), steps = sc.steps, kinds = k => steps.filter(s => k in s);
  const failedAt = bad.length ? Number(/^(\d+)\./.exec(bad[0].label)?.[1] ?? steps.length) : steps.length;

  // What ran: only the steps up to the failing one
  const ran = steps.slice(0, failedAt), ops = ran.filter(s => 'op' in s), seconds = ran.filter(s => 'step' in s).reduce((t, s) => t + s.step, 0);
  const checked = new Set(ran.flatMap(s => 'expect' in s && !('op' in s) ? Object.keys(s.expect).map(root)
    : 'snapshot' in s ? (s.only ?? facts.sections.filter(x => !(s.ignore ?? []).includes(x))).map(root) : []));
  const byOp = new Map();
  for (const s of ops) byOp.set(s.op, [...(byOp.get(s.op) ?? []), s.expect ?? 'ok']);
  const presses = ran.filter(s => 'press' in s).map(s => s.press);
  const tested = [ops.length && `ops ${[...byOp].map(([o, e]) => `${o}${e.length > 1 ? ' ×' + e.length : ''} (${[...new Set(e)].join(', ')})`).join(', ')}`,
    checked.size && `describe sections ${[...checked].join(', ')}`, (seconds || presses.length) && `time: ${[seconds && `${+seconds.toFixed(2)} s of step`,
      presses.length && `${presses.length} key press${presses.length > 1 ? 'es' : ''} (${[...new Set(presses)].join(', ')})`].filter(Boolean).join(' + ')}`,
    kinds('state').length && 'state changes'].filter(Boolean);
  const idle = facts.ops.filter(o => !byOp.has(o)), unseen = facts.sections.filter(s => !checked.has(s));
  const notTested = [bad.length && failedAt < steps.length && `steps ${failedAt + 1}-${steps.length} never ran (stopped at step ${failedAt})`,
    idle.length && `ops never run (${idle.length}): ${list(idle)}`, unseen.length && `describe sections never compared (${unseen.length}): ${list(unseen)}`,
    ops.length && !presses.length && 'the real key path (input binding to op): ops were called directly', 'the picture (use threedog snap)'].filter(Boolean);

  const ok = !bad.length && !pageErrors.length;
  const codes = [...new Set([...bad.map(r => r.detail), ...pageErrors.map(r => r.message)].flatMap(t => [...String(t).matchAll(/\[([a-z][\w-]*)\]/g)].map(m => m[1])))];
  const related = relatedTests(dir, codes), rerun = `threedog test "scenario: ${sc.name ?? name}"`;
  const why = bad.length ? `FAIL at step ${failedAt}: ${bad[0].label} → ${bad[0].detail}`.slice(0, 260)
    : pageErrors.length ? `FAIL: the checks passed but the page logged ${pageErrors.length} error${pageErrors.length > 1 ? 's' : ''} during the run (E${pageErrors[0].id}: ${pageErrors[0].message.split('\n')[0].slice(0, 100)})`
      : `PASS (${res.length} checks, all ${steps.length} steps ran)`;
  const text = [`${ok ? '✓' : '✗'} verify ${name}: ${why}`, `Tested: ${tested.join(' · ') || 'nothing but the scenario setup'}`, `Not tested: ${notTested.join(' · ')}`,
    related.length && `Related tests: ${related.map(t => `${t.name ? '"' + t.name + '" ' : ''}${t.at}`).join(' · ')}`, !ok && `Re-run: ${rerun}`].filter(Boolean).join('\n');
  return { ok, text, data: { scenario: name, passed: ok, checks: res, failedStep: bad.length ? failedAt : null, tested, notTested, pageErrors, related, rerun } };
}

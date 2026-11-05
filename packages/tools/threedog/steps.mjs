// js --file steps.js with checks: what to run it as, and the short report. The script itself runs in the page (PAGE.steps in pageFns.mjs).
//   a script that calls assert( or expect( is a "steps script": output is only failures + one summary line, exit code 1 on any failure
//   any other js / eval script behaves as before (returns the value)

/** Does this source use the check helpers? (a plain eval of an expression never does) */
export const isStepsScript = src => /(^|[^\w$.])(assert|expect)\s*\(/.test(src);

/**
 * The page's { res, logs, threw, value } → { ok, text }.
 * Short by default (tokens): "✓ 7 checks passed", or the failures then "✗ 2 of 7 checks failed", with the script's own log lines either way (it asked for them).
 * --verbose adds the passes and the return value.
 */
export function stepsReport(r, verbose) {
  const bad = r.res.filter(x => !x.ok), n = r.res.length, out = [];
  const line = (x, i) => `${x.ok ? '✓' : '✗'} #${i + 1} ${x.msg}${x.detail ? ' → ' + x.detail : ''}`;
  if (verbose) out.push(...r.res.map(line), ...r.logs.map(l => '· ' + l));
  else out.push(...r.res.map((x, i) => [x, i]).filter(([x]) => !x.ok).slice(0, 10).map(([x, i]) => line(x, i)), ...(bad.length > 10 ? [`… and ${bad.length - 10} more failures`] : []), ...r.logs.map(l => '· ' + l));
  if (r.threw) out.push(`✗ script stopped by an error after ${n} checks: ${r.threw}`);
  if (verbose && r.value !== undefined) out.push('= ' + r.value);
  const ok = !bad.length && !r.threw;
  out.push(ok ? `✓ ${n} check${n === 1 ? '' : 's'} passed` : `✗ ${bad.length} of ${n} checks failed${r.threw ? ' (script error)' : ''}`);
  // the summary leads (first line becomes the result summary); the details follow
  return { ok, text: [out.pop(), ...out].join('\n'), data: { checks: n, failed: bad.length, failures: bad.map(x => ({ msg: x.msg, detail: x.detail })), error: r.threw } };
}

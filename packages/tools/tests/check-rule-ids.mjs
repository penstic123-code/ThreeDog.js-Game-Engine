// check --rule <ids>: every id names a rule that runs, an unknown id is an error, and every check is a numbered rule (no second rule system).
// Why: `--rule R04` (the file-name spelling) or a typo ran nothing, printed "0 errors" and exited 0, and the MCP check tool answered "check passed",
// so an assistant believed a rule had passed that never ran. And check.mjs once carried six unnumbered hard rules of its own: no id, no Fix line,
// skipped by every --rule run. They are rules/R*.mjs files now (R3, R14, R15, R39, R46, and R27 for core imports).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, TOOLS } from '../paths.mjs';

export const name = 'check --rule: R04 / r4 run rule R4, unknown ids fail and list the ids, the former hard rules are numbered rules; MCP check reports the failure';

const check_ = (...args) => {
  const r = spawnSync(process.execPath, [join(TOOLS, 'check.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};

export async function run({ check }) {
  const padded = check_('--rule', 'R04');
  check('--rule R04 runs rule R4 (its summary entry is printed)', /\[R4 \d+✗ \d+!\]/.test(padded.out), padded.out.slice(-300));
  const lower = check_('--rule', 'r4');
  check('--rule r4 runs rule R4 too', /\[R4 \d+✗ \d+!\]/.test(lower.out), lower.out.slice(-300));

  const bad = check_('--rule', 'R999');
  check('an unknown id exits non-zero', bad.code !== 0, `exit ${bad.code}`);
  check('an unknown id names itself and lists the available rules', /R999/.test(bad.out) && /R4\b/.test(bad.out) && /R14\b/.test(bad.out), bad.out.slice(0, 400));
  check('an unknown id runs no rule at all', !/Rule checks:/.test(bad.out), bad.out.slice(-200));

  // the former hard rules run by id like any rule
  const hard = check_('--rule', 'R3,R14,R15,R39,R46');
  check('--rule R3,R14,R15,R39,R46 runs the former hard rules', ['R3', 'R14', 'R15', 'R39', 'R46'].every(id => new RegExp(`\\b${id} \\d+✗`).test(hard.out)), hard.out.slice(-400));
  const twice = check_('--rule', 'R10', '--rule', 'R2');
  check('[guard] --rule R10 --rule R2 runs both (the second used to replace the first)', /\[R2 \d+✗ \d+! · R10 \d+✗ \d+!\]/.test(twice.out), twice.out.slice(-300));
  // [guard] one rule system: check.mjs only runs rules/ and the generators; a check written into it again would have no id, no Fix line and no --rule
  const src = readFileSync(join(TOOLS, 'check.mjs'), 'utf8');
  check('[guard] check.mjs holds no checks of its own (no file walk, no source reading): a new check is a rules/R*.mjs file', !/readFileSync|walk\(|errors\.push|warnings\.push/.test(src));

  // MCP check tool: the same failure, never "check passed"
  const { STATIC_TOOLS } = await import('../threedog/mcp-extra.mjs');
  const m = await STATIC_TOOLS.check.run(ROOT, { rule: 'R999' });
  check('MCP check with an unknown rule: ok false and the reason in the text', m.ok === false && /R999/.test(m.text) && !/check passed/.test(m.text), m.text.slice(0, 300));
}

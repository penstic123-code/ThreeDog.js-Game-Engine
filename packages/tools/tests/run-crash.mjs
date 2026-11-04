// The test runner survives a spec whose page or browser fails before the test body runs: that item fails, the rest still run, the summary prints.
// Why: browserFor / newGamePage / addInitScript ran outside the try in runSpec, and runSpecs handled only the fulfilled promise, so one rejection
// (a browser that crashed) went up to the top level: no summary, and the later items and workspaces were never tested.
// A throwing getter on spec.software, read only inside browserFor, stands in for the crash. Runs the real runner on a throwaway game.
// Also the ways a check passed while testing nothing: check(label, promise) without await (a Promise is truthy), a run() that never calls check, and
// check(condition, 'name') with the arguments reversed (the name is always truthy).
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, TOOLS } from '../paths.mjs';

export const name = 'test runner: a spec rejected outside its body (browser crash) fails alone, later items run, the summary prints; a check given a Promise, an item with no checks and a check with reversed arguments fail';

export async function run({ check }) {
  const games = join(ROOT, 'games'), hadGames = existsSync(games), dir = join(games, 'zz-crash');
  try {
    mkdirSync(join(dir, 'tests', 'specs'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'zz-crash', private: true, type: 'module' }));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><script type="module" src="./main.js"></script>\n');
    // a stand-in engine that is ready at once, so B, C and D reach their run() (an empty page would time every one out)
    writeFileSync(join(dir, 'main.js'), 'window.engine = { ready: true, stateApplied: true, modules: new Map([["x", {}]]) };\n');
    writeFileSync(join(dir, 'tests', 'specs', 'crash.mjs'), `export const specs = [
  { name: 'zz crash A', url: '/', get software() { if (new Error().stack.includes('browserFor')) throw new Error('simulated browser crash'); return false; }, async run() {} },
  { name: 'zz crash B', url: '/', timeout: 3000, async run({ check }) { check('plain', true); } },
  { name: 'zz crash C', url: '/', timeout: 3000, async run({ check }) { check('not awaited', Promise.resolve(true)); } },
  { name: 'zz crash D', url: '/', timeout: 3000, async run() {} },
  { name: 'zz crash E', url: '/', timeout: 3000, async run({ check }) { check(false, 'reversed'); } },
];\n`);
    // --verbose: the passing item B is printed by name too (the default prints failures only)
    const r = spawnSync(process.execPath, [join(TOOLS, 'run.mjs'), '-w', 'zz-crash', '--jobs', '1', '--verbose', 'zz crash'], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
    const out = r.stdout + r.stderr;
    check('the crashed item is reported as failed with the reason', /✗ zz crash A/.test(out) && /simulated browser crash/.test(out), out.slice(-600));
    check('the next item still runs', /✓ zz crash B/.test(out), out.slice(-600));
    check('a check given a Promise fails and says add await', /✗ zz crash C/.test(out) && /check got a Promise: add await/.test(out), out.slice(-600));
    check('an item that recorded no check fails', /✗ zz crash D/.test(out) && /no checks recorded/.test(out), out.slice(-600));
    check('a check with the condition first fails and says the name comes first', /✗ zz crash E/.test(out) && /first argument must be the name/.test(out), out.slice(-600));
    check('the summary line prints and the exit code is non-zero', /\nTotal: \d+ checks in 5 items/.test(out) && r.status === 1, `exit ${r.status} ${out.slice(-300)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (!hadGames && existsSync(games) && !readdirSync(games).length) rmSync(games, { recursive: true, force: true });
  }
}

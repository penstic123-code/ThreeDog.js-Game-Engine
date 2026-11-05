// Answers that need no page: `errors` reads a file, and a game with no models passes `assets check`. A scenario's timeout reaches the test runner. Offline.
// Why: `errors latest` hung behind a stuck page, which is when it is wanted; a sprite game could pass `assets check --strict` only by adding a model it did not need.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execute } from '../threedog/dispatch.mjs';
import { runCheck } from '../assets-check/cli.mjs';
import { scenarioSpecs } from '../scenario.mjs';

export const name = 'no page needed: errors reads its file, assets check passes a game with no models, a scenario sets its own timeout';

export async function run({ check }) {
  const dir = mkdtempSync(join(tmpdir(), 'td-nopage-'));
  try {
    const r = await execute(dir, 'errors', ['latest']);
    check('errors latest answers with no dev server', r.ok && r.text === '✓ No errors recorded', r.text);

    check('assets check --strict passes a game without art/models/', await runCheck(dir, { strict: true }) === 0);
    check('a folder the caller named must exist', await runCheck(dir, {}, join(dir, 'nope')) === 1);

    mkdirSync(join(dir, 'tests/scenarios'), { recursive: true });
    writeFileSync(join(dir, 'tests/scenarios/long.json'), '{ "name": "long", "timeout": 300000, "steps": [] }');
    writeFileSync(join(dir, 'tests/scenarios/short.json'), '{ "name": "short", "steps": [] }');
    const [long, short] = scenarioSpecs(dir);
    check('a scenario\'s timeout goes on its test item; without one the runner\'s default stands', long.timeout === 300000 && short.timeout === undefined, JSON.stringify([long.timeout, short.timeout]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

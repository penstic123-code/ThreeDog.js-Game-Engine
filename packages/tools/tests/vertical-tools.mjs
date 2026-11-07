// [vertical] Chain K of the 1.0 audit: what the tools tell an AI must be what happened. The report is docs/testing/review/2026-11-07-1.0-audit/vertical-output.md;
// both cases were first seen live in a packed install (pack-external --keep).
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runScenario } from '../scenario.mjs';
import { checkGame } from '../content-check.mjs';

export const name = '[guard] tools: verify fails time that never passed, and check names an asset file that does not exist';

export async function run({ check }) {
  // a page frozen by its title: engine.step() obeys the freeze, as the bridge's `step` says ("Stepped 0 of 1 s", exit 1). The stub is that page: same answers, no browser
  let stepped = 0;
  const page = { ready: true, stateApplied: true, haltLoop() {}, step() { stepped++; }, frozen: true, error: null, time: { tick: 0 }, runState: { owners: ['ui-title'], blockedBy: ['ui-title'] }, applyState: async () => ({ refused: [] }), describe: () => ({ runState: { state: 'title-frozen' } }), ops: { defs: new Map() } };
  const driver = { evaluate: async (src, arg) => { const was = globalThis.window; globalThis.window = { engine: page }; try { return await (0, eval)(`(${src})`)(arg); } finally { globalThis.window = was; } } };
  const failed = [];
  await runScenario(driver, { steps: [{ step: 5 }] }, { check: (label, ok, detail) => { if (!ok) failed.push(`${label}: ${detail}`); }, file: 'frozen' }).catch(err => failed.push(String(err.message)));
  check('the scenario reached its step (setup)', stepped >= 2, JSON.stringify(failed));
  check('a step on a frozen page fails the scenario, as threedog step does', stepped >= 2 && failed.some(f => /frozen|0 of/i.test(f)), JSON.stringify(failed));

  // an asset pack naming a file the project does not have: the game shows "load failed", and check said passed
  const dir = mkdtempSync(join(tmpdir(), 'threedog-vertical-'));
  try {
    mkdirSync(join(dir, 'public'));
    writeFileSync(join(dir, 'package.json'), '{ "type": "module" }');
    writeFileSync(join(dir, 'main.js'), '');
    mkdirSync(join(dir, 'public/packs'), { recursive: true });
    writeFileSync(join(dir, 'public/here.glb'), '');
    writeFileSync(join(dir, 'public/packs/oak.glb'), '');
    writeFileSync(join(dir, 'assets.js'), `export default [{ name: 'starter', models: { ghost: '/models/none.glb', fern: { url: 'gone.glb' }, door: '/models/door.glb', here: '/here.glb?v=2', tree: () => null },
      sounds: { far: 'https://example.com/a.ogg', inline: 'data:audio/wav;base64,AAAA' }, textures: { skin: '/skin.png' } }, { name: 'forest', base: '/packs/', models: { oak: 'oak.glb', elm: 'elm.glb' } }, { name: 'optimized', models: { door: '/here.glb' } }];\n`);
    const r = await checkGame(dir), said = JSON.stringify(r ?? null);
    for (const f of ['none.glb', 'gone.glb', 'skin.png', 'elm.glb']) check(`check names the missing file ${f}`, said.includes(f), said.slice(0, 300));
    check('an original the later pack replaced needs no file', !said.includes('door.glb'), said.slice(0, 400));
    check('a file that is there, a generator, a remote url and inline data say nothing', !/here\.glb|oak\.glb|example\.com|data:audio/.test(said), said.slice(0, 400));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

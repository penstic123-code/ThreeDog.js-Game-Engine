// threedog report: what leaves the machine is scrubbed, the scenario holds only what can run again. The real page round trip (report, then verify) is in tests/bridge.mjs.
import { scrubber, scenarioFrom, buildReport } from '../threedog/report.mjs';

export const name = 'report: no secrets or user paths in the file, a scenario only from ops that can run again';

export async function run({ check }) {
  // the paths are joined here so this file holds none written out (rule R23)
  const home = ['C:', 'Users', 'someone'].join('\\'), other = ['C:', 'Users', 'other'].join('\\'), slashed = home.replaceAll('\\', '/');
  const scrub = scrubber({ game: `${home}\\work\\my-game`, home });
  const out = scrub({ token: 'abc123', nested: { apiKey: 'k', 'x-threedog-token': 't' }, keep: 7,
    a: `at ${slashed}/work/my-game/main.js:3`, b: `${home.toLowerCase()}\\work\\my-game\\main.js`, c: `${other}\\x.js`, d: ['', 'home', 'other', 'x.js'].join('/'), e: 'http://localhost:1/?token=abc&a=1', f: 'Bearer abc.def' });
  const text = JSON.stringify(out);
  check('[guard] secret keys are emptied', out.token === '<removed>' && out.nested.apiKey === '<removed>' && out.nested['x-threedog-token'] === '<removed>' && out.keep === 7, text);
  check('[guard] project paths read <game>, with either slash and any case', out.a === 'at <game>/main.js:3' && out.b === '<game>\\main.js', text);
  check('[guard] any other user folder is gone', !/someone|other/.test(text), text);
  check('[guard] a secret in a url or a header is gone', !/abc/.test(out.e) && out.e.endsWith('&a=1') && out.f === 'Bearer <removed>', text);

  const op = (name, tick, more = {}) => ({ name, tick, args: {}, source: 'bridge', actor: 'player', ok: true, code: null, depth: 0, ...more });
  const sc = scenarioFrom([op('a.go', 60), op('own.tick', 70, { source: 'game' }), op('a.inner', 70, { depth: 1 }), op('b.buy', 120, { ok: false, code: 'noMoney', args: { n: 2 } })], '/');
  check('the scenario keeps the ops with the time between them, a refused op expects its code', JSON.stringify(sc.steps) === JSON.stringify([{ op: 'a.go' }, { step: 1 }, { op: 'b.buy', args: { n: 2 }, expect: 'noMoney' }]), JSON.stringify(sc));
  check('no op to run again, no scenario', scenarioFrom([op('own', 1, { source: 'game' })], '/') === null);

  const none = buildReport({ version: '1.0.0', facts: null, errors: [], installed: ['world'] }, x => x);
  check('with no page it says what is missing and keeps the installed list', none.page === null && none.state === null && /no page was attached/.test(none.steps[0]) && none.modules[0].id === 'world');
  const facts = { url: '/', seed: 7, tick: 90, run: 'halted', error: null, describe: { player: {} }, ops: [op('a.go', 60)], cut: false, refused: [], catalog: [{ id: 'world', kind: 'module' }, { id: 'shadows', kind: 'capability' }], slots: [] };
  const full = buildReport({ version: '1.0.0', facts, errors: [{ id: 1, kind: 'error', tick: 5, code: 'x', message: 'm', source: 's', count: 1, hint: 'h', page: 'p' }], installed: [] }, x => x);
  check('with a page it has seed, tick, ops, errors with hints, modules, capabilities, steps and a scenario',
    full.page.seed === 7 && full.page.tick === 90 && full.ops.length === 1 && full.errors[0].hint === 'h' && full.errors[0].id === 'E1' && full.modules.length === 1 && full.capabilities[0].id === 'shadows' && /seed: 7/.test(full.steps[0]) && full.scenario.steps.length === 1, JSON.stringify(full).slice(0, 400));
}

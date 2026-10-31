// Stage 2 item 4 (AI tools): describe snapshots instead of screenshots (tools/describe-snapshot.mjs) and errors that carry the likely cause + the doc page to read (core/errorHints.js).
// Baselines live in packages/engine/tests/snapshots/*.describe.json; after an intended change update them with `threedog test "describe snapshot" --update-snapshots`.
import { expectDescribe } from '@threedog/tools/describe-snapshot';

export const specs = [
  {
    name: 'describe snapshot: small town after loading, fields player / camera / ui / modules (small town)',
    url: '/city.html',
    async run({ check, ev }) {
      await ev(() => { engine.pause(); engine.step(0.5); });
      await expectDescribe({ check, ev }, 'city-start', { only: ['player.ground', 'player.state', 'player.inWater', 'camera.type', 'ui', 'modules'], tolerance: 1 });
    },
  },
  {
    name: 'describe snapshot: open world with the opening cutscene skipped, noon (open world)',
    url: '/?cutscene=skip&time=12:00&weather=clear',
    async run({ check, ev }) {
      await ev(() => { engine.pause(); engine.step(0.5); });
      await expectDescribe({ check, ev }, 'world-noon', { only: ['player.ground', 'player.state', 'player.inWater', 'weather.name', 'ui', 'cutscene'], tolerance: 1 });
    },
  },
  {
    name: 'describe snapshot: state registered with describe.add is part of the baseline (small town)',
    url: '/city.html',
    async run({ check, ev }) {
      await ev(() => { engine.pause(); engine.describe.add('snapDemo', () => ({ score: 3, targets: [{ name: 'crate', hp: 10 }, { name: 'barrel', hp: 5 }] })); engine.step(0.1); });
      await expectDescribe({ check, ev }, 'city-custom-state', { only: ['snapDemo'] });
    },
  },
  {
    name: 'errors carry a cause and a doc page: engine.error, describeText and warnOnce (small town)',
    url: '/city.html',
    expectErrors: /plain values/,   // a gameplay error provoked on purpose
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        const { warns } = await __t.warns(() => { engine.input.pressed('jupm'); engine.input.pressed('jupm'); });
        engine.events.on('hint:test', () => { throw new Error('world data must be plain values (number, string, boolean, array, plain object): x is a function'); });
        engine.events.emit('hint:test');
        return { warns, error: engine.error, text: engine.describeText().split('\n')[0] };
      });
      check('warnOnce: the warning ends with "Possible cause" and a Read line, and repeats are not printed again', r.warns.length === 1 && /Possible cause: .*\n\s+Read: .*api\//.test(r.warns[0]), JSON.stringify(r.warns));
      check('engine.error has a code, the fix and docs (recipes/18-world.md)', r.error?.code === 'world-plain' && /JSON-like/.test(r.error?.fix ?? '') && r.error.docs.includes('recipes/18-world.md'), JSON.stringify(r.error));
      check('describeText: the error line shows the code, the fix and the pages to read', /Code: world-plain \| Fix: .*Read: recipes\/18-world\.md/.test(r.text), r.text);
    },
  },
];

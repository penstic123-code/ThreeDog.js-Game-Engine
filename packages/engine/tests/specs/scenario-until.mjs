// [guard] A scenario says "reach this state within a deadline" and is told what stopped it: a planned freeze after the state passes, an error, a freeze before it,
// a load that never ends and a state that never comes each fail with their own reason. `step` stays strict.
import { runScenario, pageDriver } from '@threedog/tools/scenario';

export const specs = [
  {
    name: '[guard] Scenario until: a win that freezes early passes, an error, a freeze, a stuck load and a missed state each say so',
    url: '/?threedog-headless',
    async run({ check, page }) {
      const go = async (steps, prep, onPrepared) => {
        const res = [];
        if (prep) await page.evaluate(prep);
        await runScenario(pageDriver(page), { name: 'until', steps }, { check: (label, ok, detail) => res.push({ label, ok, detail }), onPrepared });
        return res;
      };
      const failed = r => r.filter(x => !x.ok).map(x => `${x.label} ${x.detail ?? ''}`).join(' | ');
      // a win at 0.5 s freezes the game; the deadline of 2 s must not read as "too little time"
      const arm = `(() => { const E = window.engine, t0 = E.time.tick, D = E.modules.get('scWin') ?? null;
        if (!D) E.use({ name: 'scWin', type: 'rules', describe: () => ({ won: !!window.__won }) });
        window.__won = false;
        window.__off?.remove();
        window.__off = E.onFixed(() => { if (E.time.tick - t0 >= 30 && !window.__won) { window.__won = true; window.__hold = E.freeze('sc-win'); } });
      })()`;
      const end = `(() => { window.__hold?.remove(); window.__hold = null; window.__off?.remove(); })()`;

      const win = await go([{ until: { 'scWin.won': true }, within: 2 }, { expect: { 'scWin.won': true } }], arm);
      check('the win arrives before the deadline and freezes: it passes, and the end state is checked', !failed(win), failed(win));
      const strict = await go([{ step: 1 }]);
      check('a strict step on the same frozen game still fails', /stepped 0 of 1/.test(failed(strict)), failed(strict));
      await page.evaluate(end);

      const missed = await go([{ until: { 'scWin.won': 'never' }, within: 0.3 }]);
      check('a state that never comes names what it read', /not reached within 0.3 s/.test(failed(missed)) && /scWin.won/.test(failed(missed)), failed(missed));

      const held = await go([{ until: { 'scWin.won': 'never' }, within: 0.3 }], `(() => { window.__hold = window.engine.freeze('sc-pause'); })()`);
      check('a freeze before the state says who holds it', /frozen by .*sc-pause/.test(failed(held)) && /before the state/.test(failed(held)), failed(held));
      await page.evaluate(end);

      const stuck = await go([{ until: { 'scWin.won': 'never' }, within: 0.3 }], null, () => page.evaluate(`(() => { const E = window.engine; window.__ready = Object.getOwnPropertyDescriptor(E, 'ready'); window.__hold = E.freeze('sc-load'); Object.defineProperty(E, 'ready', { configurable: true, get: () => false }); })()`));
      check('a load that does not end says it is still loading', /still loading after 0.3 s/.test(failed(stuck)), failed(stuck));
      await page.evaluate(`(() => { const E = window.engine; delete E.ready; if (window.__ready) Object.defineProperty(E, 'ready', window.__ready); window.__hold?.remove(); })()`);

      const broke = await go([{ until: { 'scWin.won': 'never' }, within: 2 }], `(() => { const off = window.engine.onFixed(() => { off.remove(); throw new Error('boom in the game'); }); })()`);
      check('an error stops the wait at once and names itself', /stopped on an error/.test(failed(broke)) && /boom in the game/.test(failed(broke)), failed(broke));
      check('a step needs a positive deadline', await runScenario(pageDriver(page), { name: 'x', steps: [{ until: { a: 1 } }] }, { check() {} }).then(() => false, e => /within/.test(e.message)));
    },
    expectErrors: /boom in the game/,   // the error this test provokes
  },
];

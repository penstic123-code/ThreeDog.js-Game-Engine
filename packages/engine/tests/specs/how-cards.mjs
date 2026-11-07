// What `threedog how --card` prints is checked against a live engine: a card is the first thing an AI copies from, and a card built from a guessed name reads as true
// (engine.vegetation-draw, "npcs: nothing to install"). Every card goes through here, so a new module or group is covered without a list to keep.
import { fileURLToPath } from 'node:url';
import { capabilityCards } from '@threedog/tools/how-browse';

const DOCS = fileURLToPath(new URL('../../docs/', import.meta.url));

export const specs = [
  {
    name: '[guard] how cards: every Use line names a real member and every Install line is true',
    url: '/tests/review3-docs/index.html',
    timeout: 120000,
    async run({ check, page }) {
      const cards = capabilityCards(DOCS).filter(c => c.kind !== 'recipe').map(({ id, kind, use, install, requires, create, slots }) => ({ id, kind, use, install, requires, create, slots }));
      check('there are module, factory and group cards', ['module', 'factory', 'group'].every(k => cards.some(c => c.kind === k)), String(cards.length));
      const bad = await page.evaluate(async cards => {
        const TD = window.TD, out = [];
        const canvas = document.body.appendChild(document.createElement('canvas'));
        let n = 0;
        const fresh = () => TD.createEngine({ canvas, ui: { loading: false }, urlState: false, pixelRatio: 1, adaptiveResolution: false, saveKey: `how-card-${++n}` });
        const callsIn = text => [...text.matchAll(/\b(\w+)\(\)/g)].map(m => m[1]);
        // `a.b()` is a function on engine.a, `a.b` or `engine.a` is a member; a dash or an unknown name is what this test exists to catch
        const real = (e, word) => {
          const path = word.replace(/^engine\./, '').replace(/\(\)$/, '').split('.');
          if (path.some(k => !/^\w+$/.test(k))) return false;
          const owner = path.slice(0, -1).reduce((o, k) => o?.[k], e), last = path.at(-1), v = path.length > 1 ? owner?.[last] : e[last];
          // a member that is still null (engine.player, engine.error) has no methods to read yet, so only its own name can be checked here
          if (path.length > 1 && owner == null && e[path[0]] === null) return true;
          return word.endsWith('()') ? typeof v === 'function' : path.length > 1 ? v !== undefined : last in e;
        };
        for (const c of cards) {
          const e = fresh(), say = msg => out.push(`${c.id}: ${msg}`), freeCard = /nothing to install/.test(c.install);
          try {
            if (!freeCard) {
              const [, call, wanted] = /engine\.use\((\w+)\((?:\{ ([\w, ]+) \})?\)\)/.exec(c.install) ?? [];
              // what the line says the game must pass: values only this test needs, and an option nobody filled in here fails the install below
              const fill = { pick: 'nearest', role: 'host', transport: TD.fakeNetwork().connect() }, given = Object.fromEntries((wanted?.split(', ') ?? []).map(k => [k, fill[k]]));
              const named = /import \{ ([^}]*) \}/.exec(c.install)?.[1].split(', ') ?? [];
              for (const k of named) if (typeof TD[k] !== 'function') say(`Install imports ${k}, which threedog does not export`);
              if (/^\w+$/.test(c.id) && c.kind === 'group' && e[c.id] != null) say(`Install says to install something, but a bare engine has engine.${c.id}`);
              const need = c.requires === 'none' ? [] : callsIn(c.requires);
              e.use(...need.flatMap(k => TD[k]()), ...[TD[call](wanted ? given : undefined)].flat());
            } else if (!(c.id in e)) say('says "in every engine", a bare engine has no such member');
            for (const word of (c.use ?? '').split(', ').filter(Boolean)) if (!real(e, word)) say(`Use names ${word}, which is not there`);
            if (c.create) {
              if (e[c.id] != null) say(`Create says engine.${c.id} waits, it is there after install`);
              const fn = /(engine\.\S+)\(\) runs/.exec(c.create)?.[1];
              if (!fn || !real(e, fn + '()')) say(`Create names ${fn}, which is not there`);
            }
          } catch (err) { say(`the install line threw: ${String(err?.message ?? err).split('\n')[0].slice(0, 160)}`); }
          try { e.dispose({ keepContext: true }); } catch { /* the next card gets a new engine either way */ }
        }
        return out;
      }, cards);
      check('every card holds on a live engine', !bad.length, bad.join(' | '));
    },
  },
];

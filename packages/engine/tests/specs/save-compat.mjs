// Save compatibility guard: fixed sample saves from released versions (tests/save-compat/samples/*.json, committed, never edited) must load on the
// current code with every part whole, and a save from a newer engine must be refused with a clear message and no change.
// Each sample file is { versions, save, settings }: save = engine.saves.collect() of that version after the same fixed play-through, settings = the
// stored settings text. A release adds a sample (docs/plans/release-checklist.md); old samples are never regenerated.
// Same format as the other files here.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'save-compat', 'samples');
const samples = readdirSync(DIR).filter(f => f.endsWith('.json')).sort().map(f => ({ name: f.replace(/\.json$/, ''), data: JSON.parse(readFileSync(join(DIR, f), 'utf8')) }));

export const specs = [
  ...samples.map(({ name, data }) => ({
    name: `save compat: sample save from ${name} loads whole on current code, every part present (open world) [guard]`,
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async (sample) => {
        const W = fn => engine.ops.allow(fn);
        // the quest the sample was made with: a part for a quest nobody defined is kept aside, so define it first (same steps as when the sample was made)
        engine.quests.define('visit', { title: 'Visit', steps: [{ text: 'one', done: e => !!e.vars.flag('met') }, { text: 'two', done: e => e.vars.counter('coins') >= 99 }] });
        W(() => engine.vars.replace({ stale: true }, {}));   // something the load must replace, not merge into
        const ok = await engine.saves.apply(sample.save, 'compat');
        const S = engine.saves, V = engine.vars, w = engine.world;
        const out = { ok };
        out.flags = { ...V.flags }; out.counters = { ...V.counters };
        out.bag = Object.fromEntries(engine.inventory.list().map(x => [x.id, x.count]));
        out.chest = engine.inventory.container('chest').list().map(x => `${x.id}x${x.count}`);
        out.spent = [...engine.interactions._spent]; out.counted = Object.fromEntries(engine.interactions._counted);
        out.crate = w.records.get('crate-1')?.position ?? null;
        out.player = w.records.get('player')?.position ?? null;
        out.quest = engine.quests.state('visit');
        // settings: the stored text is read back by the current settings code
        localStorage.setItem(engine.settings.storageKey, sample.settings);
        const st = engine.settings._read();
        out.settings = { v: st.v, master: st.values?.masterVolume, locale: st.locale };
        // the parts the current build saves are all parts of the sample too (nothing the sample had is dropped by a save-after-load)
        const again = S.collect();
        out.missing = Object.keys(sample.save.parts).filter(k => !(k in again.parts));
        return out;
      }, data);
      check('apply resolves true', r.ok === true, JSON.stringify(r));
      check('flags and counters (vars) arrive, the stale one is gone', r.flags.met === true && r.flags.mood === 'happy' && !r.flags.stale && r.counters.coins === 7 && r.counters.steps === 3, JSON.stringify([r.flags, r.counters]));
      check('inventory arrives', r.bag.apple === 3 && r.bag.sword === 1, JSON.stringify(r.bag));
      check('containers arrive', JSON.stringify(r.chest) === '["gemx2"]', JSON.stringify(r.chest));
      check('interactions arrive (used once-items and counters)', r.spent.includes('shell-1') && r.counted.shells === 1, JSON.stringify([r.spent, r.counted]));
      check('world records arrive (placed record and the player)', r.crate && r.crate.x === 3 && r.crate.z === 4 && r.player && r.player.x === 1 && r.player.z === 2, JSON.stringify([r.crate, r.player]));
      check('quest progress arrives', r.quest && r.quest.steps === 2, JSON.stringify(r.quest));
      check('settings text is read by the current settings code', r.settings.v === 1 && r.settings.master === 0.4 && r.settings.locale === 'zh-CN', JSON.stringify(r.settings));
      check('every part of the sample is still saved afterwards', r.missing.length === 0, JSON.stringify(r.missing));
    },
  })),
  {
    name: 'save compat: a save from a newer engine (newer envelope or newer part) is refused with a clear message and changes nothing (open world) [guard]',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async (sample) => {
        const S = engine.saves, out = {};
        engine.ops.allow(() => engine.vars.replace({ keep: true }, { n: 5 }));
        const before = JSON.stringify([engine.vars.flags, engine.vars.counters, engine.world.records.size]);
        const newerFormat = structuredClone(sample.save); newerFormat.format = 99;
        const newerPart = structuredClone(sample.save); newerPart.versions.world = 99; newerPart.parts.world.futureField = { x: 1 };
        for (const [k, save] of [['format', newerFormat], ['part', newerPart]]) {
          await S.save('compat-slot');   // a real stored slot to prove it is kept
          const text = JSON.stringify(save);
          await S._put('compat-new', text, Date.now());
          const reason = S.check('compat-new');
          const ok = await S.load('compat-new');
          out[k] = { reason, ok, same: JSON.stringify([engine.vars.flags, engine.vars.counters, engine.world.records.size]) === before, kept: S._json.get('compat-new') === text,
            toast: /newer version|更新版本/.test(document.body.textContent) };
          document.querySelectorAll('.threedog-toast').forEach(n => n.remove());
        }
        return out;
      }, samples[samples.length - 1].data);
      for (const k of ['format', 'part']) {
        check(`newer ${k}: check says tooNew`, r[k].reason === 'tooNew', JSON.stringify(r[k]));
        check(`newer ${k}: load is refused and the game is unchanged`, r[k].ok === false && r[k].same, JSON.stringify(r[k]));
        check(`newer ${k}: the stored save is kept as it was`, r[k].kept, JSON.stringify(r[k]));
        check(`newer ${k}: the player sees a "newer version" message`, r[k].toast, JSON.stringify(r[k]));
      }
    },
  },
];

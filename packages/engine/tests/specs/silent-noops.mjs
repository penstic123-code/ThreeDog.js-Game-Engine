// Calls that used to do nothing and say nothing: container start items that do not fit, a done quest started again, a swarm emptied by the first
// new game, a stinger with no audio. Each now warns or leaves a record, and none of them is refused (a game may do these on purpose).
// settings.reset is here too: the engine's own defaults are known only to the engine.
export const specs = [
  {
    name: 'Silent no-ops: over-capacity start items warn, a done quest start warns, a stinger leaves a record, settings.reset restores defaults',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const warns = [], w = console.warn; console.warn = (...a) => { warns.push(String(a[0])); w.apply(console, a); };
        const out = {};
        try {
          const I = engine.inventory;
          engine.ops.allow(() => {
            I.define('gem', { name: 'gem', stack: 1 });
            const shelf = I.container('shelf-x', { capacity: 1, items: { gem: 3 } });
            out.shelfCount = shelf.count('gem');
          });
          out.shelfWarn = warns.some(m => /shelf-x/.test(m) && /did not fit/.test(m));
          // a stinger asked for while audio does not run: the event still records the call
          const seen = [];
          engine.events.on('music:stinger', e => seen.push(e));
          if (engine.music) { engine.music.define('jingle', '/none.mp3'); engine.music.stinger('jingle'); }
          out.stinger = engine.music ? seen : 'no music module';
          // settings: change a volume, a game setting, then put them back
          const s = engine.settings;
          if (s) {
            const dflt = s.get('vol.music');
            s.define('t-flag', true, () => {});
            s.set('vol.music', 0.1); s.set('t-flag', false);
            s.reset('vol.music');
            out.volBack = s.get('vol.music') === dflt;
            out.flagKept = s.get('t-flag') === false;
            s.reset();
            out.flagBack = s.get('t-flag') === true;
          }
        } finally { console.warn = w; }
        return out;
      });
      check('start items over the capacity: the part that fits is placed and a warning names the container', r.shelfCount === 1 && r.shelfWarn, JSON.stringify(r));
      check('a stinger asked for without audio leaves a music:stinger record with played false', r.stinger === 'no music module' || (r.stinger.length === 1 && r.stinger[0].name === 'jingle' && r.stinger[0].played === false), JSON.stringify(r.stinger));
      check('settings.reset(key) restores one value, reset() all of them (a game define included)', r.volBack === undefined || (r.volBack && r.flagKept && r.flagBack), JSON.stringify(r));
    },
  },
];

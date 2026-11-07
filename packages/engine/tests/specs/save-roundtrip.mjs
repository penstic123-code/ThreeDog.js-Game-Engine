// What the engine writes it must read. A load check and the code that writes the number live apart, so a range that is too narrow only shows on the player's own
// save (a mark below zero was refused as damage). One real playthrough with the parts that hold numbers: the save goes through JSON and back, nothing is refused,
// nothing is "fixed", and the next save says the same. Run: threedog test "Save round trip"
export const specs = [
  {
    name: '[guard] Save round trip: a save taken in the middle of play loads with nothing refused or fixed, and saves the same numbers again',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, createEngine, all: T } = window.threedogThreads, warns = [], was = console.warn;
        console.warn = (...a) => warns.push(a.join(' '));
        const E = mk(createEngine, 'save-roundtrip-' + Math.random());
        E.use(T.world(), T.content(), T.inventory(), T.quests(), T.triggers(), T.grids(), T.calendar(), T.weather({ types: { calm: { rain: 0 }, wet: { rain: 1 } } }));
        await E.start();
        const W = E.world;
        E.time.channel('rtFast');
        // numbers at the edges of what play reaches: a record faster than its channel, one stopped, a far debt, a timed mod, a blend under way
        W.simulate('rt-far', { far: () => {}, farEvery: 10, channel: 'rtFast' });
        for (const [id, set] of [['rt-fast', 3], ['rt-stopped', 0], ['rt-plain', 1]]) {
          W.add({ id, kind: 'rt-far', position: { x: -9999999, y: -1, z: 9999999 } });
          E.mod('time.local', { owner: 'rt', id, set });
        }
        E.mod('time.rtFast', { owner: 'rt', mul: 4, for: 100 });
        E.weather.set('wet', { seconds: 0 });
        for (let i = 0; i < 37; i++) E.step(1 / 60);
        const first = JSON.parse(JSON.stringify(E.saves.collect()));
        const ok = await E.saves.apply(first);
        const second = JSON.parse(JSON.stringify(E.saves.collect()));
        const nums = (v, path, out) => {
          if (typeof v === 'number') out[path] = v;
          else if (v && typeof v === 'object') for (const k in v) nums(v[k], `${path}.${k}`, out);
          return out;
        };
        const a = nums(first.parts, '', {}), b = nums(second.parts, '', {});
        const moved = Object.keys({ ...a, ...b }).filter(k => a[k] !== b[k]);
        console.warn = was;
        const seen = warns.filter(w => /save-value|save-bad-record|bad value/.test(w));
        const error = E.error?.message ?? null;
        E.dispose();
        return { ok, count: Object.keys(a).length, marks: first.parts.world.marks, moved: moved.map(k => `${k}: ${a[k]} -> ${b[k]}`), seen, error };
      });
      check(`the part holds a mark below zero, so the edge is really reached (${JSON.stringify(r.marks)})`, r.marks?.['rt-fast'] < 0);
      check(`the save loads (${r.error})`, r.ok === true);
      check(`nothing was fixed on the way in: ${r.seen.join(' | ')}`, r.seen.length === 0);
      check(`the next save says the same across ${r.count} numbers: ${r.moved.slice(0, 6).join('; ')}`, r.count > 20 && r.moved.length === 0);
    },
  },
];

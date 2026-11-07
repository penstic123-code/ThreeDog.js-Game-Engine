// Every performance feature together on one real scene (tests/perf-all). Each feature has its own guards; these two read what only shows when they meet.
const url = '/tests/perf-all/index.html';
const page = async (p, ev, fn) => { await p.waitForFunction(() => window.ready, null, { timeout: 60000 }); return ev(fn); };

export const specs = [
  {
    // the probe before this one built on a shader material and never reached a batch: every read below first proves the batches exist
    name: '[guard] batching against streaming: real batches survive leaving, teleport, return, content reload and save load, nothing lost or drawn twice, collision the same',
    url,
    timeout: 240000,
    async run({ page: p, check, ev }) {
      const r = await page(p, ev, () => window.batchRun());
      console.log('  batching numbers:', JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && v.crates !== undefined ? [v.crates, v.pillars, v.plain, v.batched, v.batches, v.lost, v.doubled, v.wrongSlot, v.orphans, v.crate, v.crate2, v.lane] : v]))));
      const J = k => JSON.stringify(r[k]);
      check('the scene really batches: most repeated meshes are instances', r.home.batches >= 2 && r.home.batched >= 80, J('home'));
      for (const k of ['home', 'far', 'back', 'reload', 'removed', 'loaded', 'loadedFromFar']) {
        check(`${k}: every mesh drawn exactly once, slots match, no orphan batch`, !r[k].lost && !r[k].doubled && !r[k].wrongSlot && !r[k].orphans, J(k));
      }
      check('far away the batches of the old place are gone', r.far.crates === 0 && r.far.instances === 0, J('far'));
      check('coming back rebuilds what was there', r.back.crates === r.home.crates && r.back.pillars === r.home.pillars && r.back.batched === r.home.batched, J('back'));
      check('a content reload changes no count', r.reload.crates === r.home.crates && r.reload.batched === r.home.batched, J('reload'));
      check('removed records leave the batch', r.removed.crates === r.home.crates - 2 && r.removed.batched === r.home.batched - 2, J('removed'));
      check('load brings back what was saved, the late crate is gone', r.loaded.crates === r.removed.crates && r.loadedFromFar.crates === r.removed.crates, J('loaded') + J('loadedFromFar'));
      for (const k of ['back', 'reload', 'loaded', 'loadedFromFar']) check(`${k}: collision answers as at home`, r[k].crate === r.home.crate && r[k].crate2 === r.home.crate2 && r[k].lane === r.home.lane && r[k].ground === r.home.ground, J(k) + J('home'));
      check('crates block, batched or plain, a free lane does not', r.home.crate === false && r.home.crate2 === false && r.home.lane === true, J('home'));
      check('no error', !r.error, r.error);
    },
  },
  {
    name: '[guard] all performance features at once: same picture, same state, same collision as with them off, through level change, save load and camera switch',
    url: `${url}?r=gpu`,
    software: true,
    timeout: 420000,
    async run({ page: p, check, ev }) {
      const r = await page(p, ev, () => window.compareRun());
      console.log('  features on against off:', JSON.stringify({ on: r.on, off: r.off, marks: r.marks.map(m => [m.name, m.pixels, m.hidden, Object.keys(m.state), m.census.batches, m.census.lost, m.census.doubled]) }));
      check('no error with the features on or off', !r.on.error && !r.off.error, `${r.on.error} / ${r.off.error}`);
      check('batches are really on', r.on.stats.batches >= 2, JSON.stringify(r.on.stats));
      for (const m of r.marks) {
        check(`${m.name}: the picture matches (under 1% of pixels)`, m.pixels.bad < 1, JSON.stringify(m.pixels));
        check(`${m.name}: the saved state is equal`, !Object.keys(m.state).length, JSON.stringify(m.state).slice(0, 600));
        check(`${m.name}: collision and ground answer the same`, JSON.stringify(m.lines[0]) === JSON.stringify(m.lines[1]), JSON.stringify(m.lines));
        check(`${m.name}: nothing lost or drawn twice`, !m.census.lost && !m.census.doubled && !m.census.wrongSlot && !m.census.orphans, JSON.stringify(m.census));
      }
    },
  },
];

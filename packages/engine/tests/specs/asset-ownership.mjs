// Who owns an asset's data (core/assets/assetEntry.js, "Who owns what"): a copy counts on the load that owns its data, and a load that was ended, by a release,
// a replacement or dispose, is freed when it arrives and never written back. Headless engines on the loading test page; each load is held open by a gate.
import { readFileSync } from 'node:fs';

const core = f => readFileSync(new URL(`../../core/assets/${f}`, import.meta.url), 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Runs in the page: gates that hold a load open, and things that report being freed */
function install(png) {
  const gate = () => { let open, fail; const p = new Promise((res, rej) => { open = res; fail = rej; }); return { p, open, fail }; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async fn => { for (let i = 0; i < 300 && !fn(); i++) await wait(10); return !!fn(); };
  const rejections = [];
  window.addEventListener('unhandledrejection', ev => { rejections.push(String(ev.reason?.message ?? ev.reason)); ev.preventDefault(); });
  const eng = async key => { const E = threedogLoad.make('own-' + key, { ui: { loading: false } }); await E.start(); return E; };
  /** A generator whose n-th build waits on gates[n]; made[n] = { mesh, freed } */
  const generator = (E, gates = []) => {
    const made = [];
    const build = async () => {
      const m = { mesh: new __threedogThree.Mesh(new __threedogThree.BoxGeometry(1, 1, 1), new __threedogThree.MeshBasicMaterial()), freed: 0 };
      m.mesh.geometry.addEventListener('dispose', () => m.freed++);
      made.push(m);
      await gates[made.length - 1]?.p;
      return m.mesh;
    };
    return { made, build };
  };
  const geo = root => { let g = null; root.traverse(o => { if (!g && o.isMesh) g = o.geometry; }); return g; };
  /** freed() counts dispose events on the first geometry of a copy */
  const watch = root => { let n = 0; geo(root).addEventListener('dispose', () => n++); return () => n; };
  const state = async p => { let s = 'pending'; p.then(() => { s = 'resolved'; }, () => { s = 'rejected'; }); await wait(40); return s; };
  // fetch of a gated url waits like the network and honours abort like the real one
  const realFetch = window.fetch.bind(window), routes = new Map(), body = () => atob(threedogLoad.gltfUrl().split(',')[1]);
  window.fetch = (u, o) => {
    const r = routes.get(String(u));
    if (!r) return realFetch(u, o);
    r.hits++;
    const g = r.gates[r.hits - 1];
    return new Promise((res, rej) => {
      o?.signal?.addEventListener('abort', () => { r.aborted++; rej(new DOMException('aborted', 'AbortError')); });
      (g?.p ?? Promise.resolve()).then(() => res(new Response(body(), { headers: { 'content-type': 'model/gltf+json' } })), rej);
    });
  };
  const route = (url, gates = []) => { const r = { hits: 0, aborted: 0, gates }; routes.set(new URL(url, location.href).href, r); routes.set(url, r); return r; };
  /** The next textures loaded by engine E wait on gates; loaded[n] reports being freed */
  const gatedTextures = (E, gates) => {
    const real = E.assets.tex.loadAsync.bind(E.assets.tex), loaded = [];
    E.assets.tex.loadAsync = async url => {
      const i = loaded.length, rec = { t: null, freed: 0 };
      loaded.push(rec);
      rec.t = await real(url);
      rec.t.addEventListener('dispose', () => rec.freed++);
      await gates[i]?.p;
      return rec.t;
    };
    return loaded;
  };
  /** FontFace held open by gates; the face itself is real, so document.fonts takes it */
  const gatedFonts = gates => {
    const faces = [];
    window.FontFace = class extends window.__RealFontFace {
      constructor(...a) { super(...a); this.gate = gates[faces.length]; faces.push(this); }
      load() { return this.gate?.p ?? Promise.resolve(this); }
    };
    return faces;
  };
  window.__RealFontFace ||= window.FontFace;
  window.own = { gate, wait, until, rejections, eng, generator, geo, watch, state, route, gatedTextures, gatedFonts, png };
}

/** Every item opens its own page and engines, so one that fails says nothing about the next */
const item = (name, run) => ({
  name: `asset ownership: ${name}`, url: '/tests/loading/index.html', expectErrors: /404|Not Found|Failed to load resource/,
  async run(t) { await t.ev(install, PNG); await run(t); },
});

export const specs = [
  // 不许绕开: every path that hands out asset data goes through Assets._with / _copy and every write of an entry's data through assetEntry.js; a second
  // writer is how a result for a freed entry gets back in
  {
    name: '[guard] asset ownership: only assetEntry.js writes an entry\'s data',
    url: '/tests/loading/index.html',
    async run({ check }) {
      const writers = ['Assets.js', 'assetHot.js', 'assetManifest.js', 'assetLoad.js'].filter(f => /\b(e|ent|old|entry)\.(value|promise|load)\s*=[^=]/.test(core(f)));
      check('only assetEntry.js writes an entry\'s value, promise or load', !writers.length, writers.join(', '));
    },
  },
  item("fallback: the copies of a name that fell back keep the other entry's data alive", async ({ check, ev }) => {
    const fb = await ev(async () => {
      const { eng, watch, geo } = own, E = await eng('fb'), A = E.assets, out = {};
      A.manifest({ models: { rock: threedogLoad.gltfUrl(), shrub: { url: '/models/own-missing.glb', fallback: 'rock' } } });
      const place = o => { if (o) E.scene.add(o); return o; };
      const m = place(await A.model('shrub')), freed = watch(m), g0 = geo(m);
      out.users = [A._users('shrub'), A._users('rock')];
      out.trim = A.trim();
      out.freedByTrim = freed();
      const now = place(A.modelNow('shrub'));
      out.now = !!now && geo(now) === g0;
      out.usersNow = [A._users('shrub'), A._users('rock')];
      A.release('rock');
      out.freedByRelease = freed();
      if (now) E.remove(now);
      out.freedOneLeft = freed();
      A.release('shrub');   // a name that only borrows: the copy in the scene still holds rock
      out.freedByBorrowerRelease = freed();
      E.remove(m);
      out.freedLast = freed();
      out.usersEnd = [A._users('shrub'), A._users('rock')];
      const m2 = place(await A.model('shrub'));   // rock's data is gone: this must be a fresh load, not the old promise
      out.fresh = geo(m2) !== g0;
      const freed2 = watch(m2);
      E.remove(m2);
      out.trimEnd = A.trim();
      out.freed2 = freed2();
      const m3 = place(await A.model('shrub')), freed3 = watch(m3);
      out.fresh3 = geo(m3) !== geo(m2) && A.trim().length === 0 && freed3() === 0;
      E.remove(m3);
      await A.geometry('shrub');   // geometry handed out by the name that fell back pins the owner
      out.pinned = A.trim();
      E.dispose();
      return out;
    });
    check('users: the name asked for and the name that owns the data both count the copy', fb.users.join() === '1,1' && fb.usersNow.join() === '2,2', JSON.stringify(fb));
    check('trim does not free the data a fallback copy uses', fb.trim.length === 0 && fb.freedByTrim === 0, JSON.stringify(fb));
    check('modelNow gives a copy for a name that fell back', fb.now, JSON.stringify(fb));
    check('release of the owner waits for the fallback copies, and the last one frees it once', fb.freedByRelease === 0 && fb.freedOneLeft === 0 && fb.freedByBorrowerRelease === 0 && fb.freedLast === 1 && fb.usersEnd.join() === '0,0', JSON.stringify(fb));
    check('after the owner is freed the fallback name loads again instead of resolving to the freed data', fb.fresh && fb.trimEnd.includes('rock') && fb.freed2 === 1 && fb.fresh3, JSON.stringify(fb));
    check('geometry() through a fallback pins the owner', fb.pinned.length === 0, JSON.stringify(fb));

  }),
  item('fallback loop: two missing files naming each other fail once with a coded error', async ({ check, ev }) => {
    const r = await ev(async () => {
      const E = await own.eng('fb-loop'), A = E.assets;
      A.manifest({ models: { a: { url: '/models/own-missing-a.glb', fallback: 'b' }, b: { url: '/models/own-missing-b.glb', fallback: 'a' } } });
      const msg = await Promise.race([A.model('a').then(() => 'resolved', e => e.message), new Promise(r => setTimeout(() => r('hung'), 5000))]);
      E.dispose();
      return msg;
    });
    check('rejects once, code asset-fallback-cycle, chain named', /asset-fallback-cycle/.test(r) && /a -> b -> a/.test(r), r);
  }),
  item('a generator released while it runs', async ({ check, ev }) => {
    // generator running when released: nothing can stop it, so its result arrives for an ended load
    const r = await ev(async () => {
      const { eng, gate, until, generator, geo } = own, E = await eng('rel-gen'), A = E.assets, out = {};
      const gg = [gate(), gate()], gen = generator(E, gg);
      A.manifest({ models: { gen: { build: gen.build, cache: false } } });
      const p = A.model('gen');
      await until(() => gen.made.length === 1);
      A.release('gen');
      out.taskGone = !E.loading.get('gen', 'model');
      gg[0].open();
      await until(() => gen.made[0].freed === 1);
      out.firstFreed = gen.made[0].freed; out.value = !!A.entries.get('gen').value;
      await until(() => gen.made.length === 2);
      gg[1]?.open();
      const m = await p;
      out.live = geo(m) === gen.made[1]?.mesh.geometry && gen.made[1].freed === 0 && A._users('gen') === 1 && E.loading.get('gen', 'model').phase === 'done';
      E.dispose();
      return out;
    });
    check('the result for a released entry is freed and not written back, and its task is gone', r.taskGone && r.firstFreed === 1 && !r.value, JSON.stringify(r));
    check('the waiter gets a fresh live model, counted', r.live, JSON.stringify(r));
  }),
  item('a file model released during its download', async ({ check, ev }) => {
    const r = await ev(async () => {
      const { eng, gate, until, geo, route } = own, E = await eng('rel-file'), A = E.assets;
      const fg = [gate(), gate()], w = route('/own/slow.glb', fg);
      A.manifest({ models: { slow: '/own/slow.glb' } });
      const p = A.model('slow');
      await until(() => w.hits === 1);
      A.release('slow');
      await until(() => w.hits === 2);
      fg[0].open(); fg[1].open();
      const m = await p, out = { aborted: w.aborted, hits: w.hits, users: A._users('slow'), mesh: !!geo(m) };
      E.dispose();
      return out;
    });
    check('release aborts the download and the waiter gets a second load', r.aborted === 1 && r.hits === 2 && r.users === 1 && r.mesh, JSON.stringify(r));
  }),
  item('a texture released during its load, with a variant waiting too', async ({ check, ev }) => {
    const r = await ev(async () => {
      const { eng, gate, until, gatedTextures, png } = own, E = await eng('rel-tex'), A = E.assets, out = {};
      const tg = [gate(), gate(), gate(), gate()], loaded = gatedTextures(E, tg);
      A.manifest({ textures: { tx: png } });
      const pt = A.texture('tx'), pv = A.texture('tx', { color: false });
      await until(() => loaded.length === 2 && loaded[1].t);
      A.release('tx');
      tg[0].open(); tg[1].open();
      await until(() => loaded.length === 4 && loaded[3].t);
      out.freed = [loaded[0].freed, loaded[1].freed]; out.value = !!A.entries.get('tx').value;
      tg[2].open(); tg[3].open();
      const [t, tv] = await Promise.all([pt, pv]);
      out.live = !!loaded[3] && [t, tv].every(x => x === loaded[2].t || x === loaded[3].t) && loaded[2].freed + loaded[3].freed === 0;
      A.release('tx');
      out.variantGone = ![...A.entries.values()].some(e => e.variantOf === 'tx') && loaded[2]?.freed + loaded[3]?.freed === 2;   // a fresh load nothing can reach would stay
      E.dispose();
      return out;
    });
    check('both results for the released name are freed', r.freed.join() === '1,1', JSON.stringify(r));
    check('the waiters get live textures, and the variant stays reachable by the next release', r.live && r.variantGone, JSON.stringify(r));
  }),
  item('a font released during its load', async ({ check, ev }) => {
    const r = await ev(async () => {
      const { eng, gate, until, route, gatedFonts } = own, E = await eng('rel-font'), A = E.assets, out = {};
      const ng = [gate(), gate()], faces = gatedFonts(ng);
      route('/own/slow.woff2');
      A.manifest({ fonts: { ownFont: '/own/slow.woff2' } });
      const pn = A.font('ownFont');
      await until(() => faces.length === 1);
      A.release('ownFont');
      ng[0].open();
      await until(() => faces.length === 2);
      out.firstIn = document.fonts.has(faces[0]);
      ng[1].open();
      const face = await pn;
      out.got = !!faces[1] && face === faces[1] && document.fonts.has(faces[1]);
      A.release('ownFont');
      out.released = !faces[1] || !document.fonts.has(faces[1]);
      for (const f of faces) document.fonts.delete(f);
      E.dispose();
      return out;
    });
    check('the ended face never reaches document.fonts', !r.firstIn, JSON.stringify(r));
    check('the waiter gets the live face, and release takes it out again', r.got && r.released, JSON.stringify(r));
  }),
  item('dispose while loads run: nothing left behind, nothing rejects, waiters stay pending', async ({ check, ev }) => {
    const dis = await ev(async () => {
      const { eng, gate, until, wait, generator, state, route, gatedTextures, gatedFonts, png, rejections } = own, E = await eng('dis'), A = E.assets;
      const gg = gate(), gen = generator(E, [gg]), tg = gate(), loaded = gatedTextures(E, [tg]), ng = gate(), faces = gatedFonts([ng]), fg = gate(), bad = gate(), r = route('/own/dispose.glb', [fg]);
      route('/own/dispose.woff2');
      const madeT = { t: null, freed: 0, gate: gate() };
      const texGen = async () => { await madeT.gate.p; madeT.t = new __threedogThree.Texture(); madeT.t.addEventListener('dispose', () => madeT.freed++); return madeT.t; };
      const failing = async () => { await bad.p; return new __threedogThree.Mesh(); };
      A.manifest({
        models: { dGen: { build: gen.build, cache: false }, dFile: '/own/dispose.glb', dBad: { build: failing, cache: false } },
        textures: { dTex: png, dTexGen: texGen }, fonts: { dFont: '/own/dispose.woff2' },
      });
      let parsed = 0; const parse = A.gltf.parseAsync.bind(A.gltf); A.gltf.parseAsync = (...x) => { parsed++; return parse(...x); };
      const waits = { gen: A.model('dGen'), file: A.model('dFile'), bad: A.model('dBad'), tex: A.texture('dTex'), texGen: A.texture('dTexGen'), font: A.font('dFont') };
      for (const k in waits) waits[k].then(() => {});   // no catch, as careless game code writes it: a rejection here would be unhandled
      await until(() => gen.made.length === 1 && loaded[0]?.t && faces.length === 1 && r.hits === 1);
      E.dispose();
      gg.open(); tg.open(); ng.open(); fg.open(); madeT.gate.open(); bad.fail(new Error('network gone'));
      await until(() => madeT.freed === 1);
      await wait(40);
      const states = {}; for (const k in waits) states[k] = await state(waits[k]);
      const later = A.model('dGen'), laterState = await state(later);
      return {
        states, laterState, parsed, builds: gen.made.length, aborted: r.aborted,
        freed: { gen: gen.made[0].freed, tex: loaded[0].freed, texGen: madeT.freed },
        fontIn: document.fonts.has(faces[0]), values: [...A.entries.values()].filter(e => e.value || e.promise || e.load).map(e => e.url),
        rejections: rejections.slice(),
      };
    });
    check('dispose: a pending generator and textures are freed when they arrive', dis.freed.gen === 1 && dis.freed.tex === 1 && dis.freed.texGen === 1, JSON.stringify(dis));
    check('dispose: a pending font never reaches document.fonts, a pending download is aborted and never parsed', !dis.fontIn && dis.aborted === 1 && dis.parsed === 0, JSON.stringify(dis));
    check('dispose: no entry holds anything afterwards', dis.values.length === 0, JSON.stringify(dis.values));
    check('dispose: every waiter stays pending and a later call starts nothing', Object.values(dis.states).every(s => s === 'pending') && dis.laterState === 'pending' && dis.builds === 1, JSON.stringify(dis.states));
    check('dispose: no unhandled rejection, even from a load that fails afterwards', dis.rejections.length === 0, JSON.stringify(dis.rejections));

  }),
  item('a texture variant follows its name to a new file; a released model frees points and lines too', async ({ check, ev }) => {
    const r = await ev(async () => {
      const { eng, png } = own, E = await eng('var'), A = E.assets, T = __threedogThree, url = () => [...A.entries.values()].find(x => x.variantOf === 'vT')?.url;
      A.manifest({ name: 'vA', textures: { vT: png } });
      const first = await A.texture('vT', { color: false }), urlA = url();
      A.manifest({ name: 'vB', textures: { vT: png + '#b' } });
      const second = await A.texture('vT', { color: false }), urlB = url();
      let freed = 0;
      const dots = new T.Points(new T.BufferGeometry(), new T.PointsMaterial());
      dots.geometry.addEventListener('dispose', () => freed++);
      const g = new T.Group(); g.add(dots);
      A.manifest({ models: { vDots: { build: () => g, cache: false } } });
      const copy = await A.model('vDots');
      A.forget(copy); A.release('vDots');
      E.dispose();
      return { same: first === second, urlA, urlB, freed };
    });
    check('the variant asked for after the name moved loads the new file', !r.same && r.urlB === r.urlA + '#b', JSON.stringify(r));
    check('release frees the geometry of a model made of points', r.freed === 1, JSON.stringify(r));
  }),
  item('palette: an old build goes with its last copy', async ({ check, ev }) => {
    const pal = await ev(async () => {
      const { eng, gate, until, generator, geo } = own, E = await eng('pal'), A = E.assets, out = {};
      const a = generator(E), b = generator(E), c = generator(E), d = generator(E), gw = [gate(), gate()], w = generator(E, gw);
      A.manifest({ models: { pA: { build: a.build, cache: false }, pB: { build: b.build, cache: false }, pC: { build: c.build, cache: false }, pD: { build: d.build, cache: false }, pW: { build: w.build, cache: false } } });
      const place = o => { if (o) E.scene.add(o); return o; };
      const m1 = place(await A.model('pA'));
      const mb = await A.model('pB'); E.scene.add(mb); E.remove(mb);
      await A.geometry('pC');
      await A.model('pD');   // a copy outside the scene: only the old build's own free can dispose it
      A.palette = { leaf: 1 };
      const m2 = place(await A.model('pA'));
      out.copies = { builds: a.made.length, oldKept: a.made[0].freed === 0, users: A._users('pA') };
      E.remove(m1);
      out.copies.oldFreed = a.made[0].freed; out.copies.newLive = a.made[1]?.freed === 0 && A._users('pA') === 1;
      await A.model('pB');
      out.noCopies = b.made[0].freed;
      await A.geometry('pC');
      out.pinned = c.made[0].freed;
      const p1 = A.model('pW');
      await until(() => w.made.length === 1);
      A.palette = { leaf: 2 };
      const p2 = A.model('pW');
      await until(() => w.made.length === 2);
      gw[0].open();
      await until(() => w.made[0].freed === 1);
      gw[1].open();
      const [w1, w2] = await Promise.all([p1, p2]);
      out.pending = { firstFreed: w.made[0].freed, same: geo(w1) === w.made[1]?.mesh.geometry && geo(w2) === geo(w1), live: w.made[1]?.freed === 0 };
      await A.model('pD');
      E.dispose();
      out.disposed = [d.made[0].freed, c.made[0].freed];
      return out;
    });
    check('palette: a build with copies stays, and its last copy frees it; the new build is not touched', pal.copies.builds === 2 && pal.copies.oldKept && pal.copies.users === 2 && pal.copies.oldFreed === 1 && pal.copies.newLive, JSON.stringify(pal.copies));
    check('palette: a build with no copies is freed when the next one is asked for', pal.noCopies === 1, JSON.stringify(pal));
    check('palette: geometry handed out is not freed by a palette write', pal.pinned === 0, JSON.stringify(pal));
    check('palette: a build in flight is dropped, and both waiters get the new colors', pal.pending.firstFreed === 1 && pal.pending.same && pal.pending.live, JSON.stringify(pal.pending));
    check('palette: dispose frees old builds that were still held', pal.disposed.join() === '1,1', JSON.stringify(pal.disposed));

  }),
  item('a release in the gap before a waiter resumes, and a name registered again', async ({ check, ev }) => {
    const gap = await ev(async () => {
      const { eng, gate, until, generator, geo } = own, E = await eng('gap'), A = E.assets, out = {};
      const g = generator(E);
      A.manifest({ models: { gapM: { build: g.build, cache: false, preload: true } } });
      const pre = A.preload();
      const e = A.entries.get('gapM');
      e.promise.then(() => A.release('gapM'));   // runs after the load finished, before the waiter below resumes
      const m = await A.model('gapM');
      await pre;
      out.gap = { builds: g.made.length, firstFreed: g.made[0].freed, live: geo(m) === g.made[1]?.mesh.geometry };
      const gr = [gate()], old = generator(E, gr), neu = generator(E), kept = generator(E), neu2 = generator(E);
      A.manifest({ name: 'x', models: { reg: { build: old.build, cache: false }, held: { build: kept.build, cache: false } } });
      const p = A.model('reg');
      await until(() => old.made.length === 1);
      const held = await A.model('held');
      E.scene.add(held);
      A.manifest({ name: 'x', models: { reg: { build: neu.build, cache: false }, held: { build: neu2.build, cache: false } } });
      gr[0].open();
      const mr = await p;
      out.reg = { oldFreed: old.made[0].freed, got: geo(mr) === neu.made[0]?.mesh.geometry };
      out.held = { keptWhileCopy: kept.made[0].freed, users: A._users('held') };
      E.remove(held);
      out.held.freed = kept.made[0].freed; out.held.usersEnd = A._users('held');
      E.dispose();
      return out;
    });
    check('a release between the load finishing and the waiter resuming: the waiter loads again, it never copies freed data', gap.gap.builds === 2 && gap.gap.firstFreed === 1 && gap.gap.live, JSON.stringify(gap.gap));
    check('a name registered again during a load: the old result is freed and the waiter gets the new registration', gap.reg.oldFreed === 1 && gap.reg.got, JSON.stringify(gap.reg));
    check('a name registered again after a load: the old data stays for its copies and goes with the last one', gap.held.keptWhileCopy === 0 && gap.held.users === 1 && gap.held.freed === 1 && gap.held.usersEnd === 0, JSON.stringify(gap.held));
  }),
];

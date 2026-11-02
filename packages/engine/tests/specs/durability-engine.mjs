// Durability guards (docs/plans/2026-11-02-durability-fixes.md items 4, 5, 8, 9; item 3 is in threads.mjs). Same format as specs.mjs, appended at the end of it.
// Each item is a "do not bypass" check: dispose gives the WebGL context back, adaptive resolution judges frame cost (startup, compiles and a 30 Hz
// display never lower it), a silent net link closes through the heartbeat, a missing sound names its path with asset-load, an uncaught rejection is seen.

export const specs = [
  {
    name: 'durability-engine: adaptive resolution -- startup hitch, compile frames and a locked 30 Hz display keep the scale; real overload lowers it and it recovers (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const w0 = console.warn; console.warn = () => {};
        try {
          engine.pause(); engine.ready = true;
          const a = engine.adaptive, pr = () => engine.renderer.getPixelRatio();
          const fresh = () => { Object.assign(a, { on: true, paused: false, target: 60, t: 0, good: 0, cooldown: 0, lowered: false, from: null, age: 0, costs: [], gaps: [], refresh: Infinity }); engine.setPixelRatio(a.max); };
          // feed(seconds, frame interval s, cost ms or i => ms, compiled i => bool, gpu time known)
          const feed = (secs, gap, cost, compiled = () => false, gpu = false) => { for (let t = 0, i = 0; t < secs; t += gap, i++) engine._adapt(gap, typeof cost === 'function' ? cost(i) : cost, compiled(i), gpu); };
          const out = { max: a.max };
          fresh(); feed(2, 0.15, 140); feed(4, 1 / 60, 4); out.hitch = pr();                                   // 2 s of 150 ms frames right after ready
          fresh(); a.age = 10; feed(5, 1 / 60, i => i % 10 ? 4 : 300, i => i % 10 === 0); out.compiles = pr();   // every 10th frame compiles shaders
          fresh(); feed(12, 1 / 30, 6); out.locked = pr();                                                       // display never faster than 30 Hz, cheap frames
          fresh(); feed(4, 1 / 60, 3); feed(12, 1 / 30, 6, () => false, true); out.gpuCheap = pr();              // 30 fps but GPU timer says frames are cheap
          fresh(); feed(4, 1 / 60, 4); feed(3, 0.034, 30); out.low = pr(); out.lowered = a.lowered;              // 30 ms frames on a 60 Hz display
          feed(90, 1 / 60, 4); out.back = pr();                                                                  // cheap again: raises back to max
          fresh(); feed(4, 1 / 60, 4); feed(3, 1 / 30, 5); out.gpuBound = pr();                                  // no GPU timer, 60 Hz seen, now 30 fps: fps fallback
          a.on = false; engine.setPixelRatio(a.max);
          return out;
        } finally { console.warn = w0; }
      });
      check('startup hitch in the grace period does not lower the scale', r.hitch === r.max, JSON.stringify(r));
      check('shader compile frames are not judged', r.compiles === r.max, JSON.stringify(r));
      check('a display locked at 30 Hz with cheap frames is not overload (no GPU timer)', r.locked === r.max, JSON.stringify(r));
      check('with GPU time known, a slow interval with cheap frames is not overload', r.gpuCheap === r.max, JSON.stringify(r));
      check('frames costing more than the budget lower the scale', r.low < r.max && r.lowered, JSON.stringify(r));
      check('it recovers to max once frames are cheap again', r.back === r.max, JSON.stringify(r));
      check('without a GPU timer, 30 fps on a display that did 60 still lowers (GPU-bound fallback)', r.gpuBound < r.max, JSON.stringify(r));
    },
  },
  {
    name: 'durability-engine: dispose releases the WebGL context -- 20 create / dispose cycles leave no live context, keepContext and a game renderer keep theirs (threads test page)',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { createEngine, THREE } = threedogThreads;
        const mk = (canvas, more = {}) => createEngine({ canvas, headless: true, ui: { loading: false }, urlState: false, threads: false, ...more });
        const gls = [];
        for (let i = 0; i < 20; i++) { const E = mk(document.createElement('canvas')); gls.push(E.renderer.getContext()); E.dispose(); }
        const c = document.createElement('canvas'), K = mk(c);
        K.dispose({ keepContext: true });
        const kept = !K.renderer.getContext().isContextLost();
        const K2 = mk(c); K2.dispose();
        let reuse = null; try { mk(c); } catch (e) { reuse = e.code; }
        let badOpt = null; try { mk(document.createElement('canvas')).dispose({ keep: true }); } catch (e) { badOpt = e.code; }
        const R = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') }), G = createEngine({ renderer: R, headless: true, ui: { loading: false }, urlState: false, threads: false });
        G.dispose();
        const gameKept = !R.getContext().isContextLost(); R.forceContextLoss();
        return { live: gls.filter(g => !g.isContextLost()).length, kept, reuse, badOpt, gameKept };
      });
      check('20 create / dispose cycles: at most 1 context still alive', r.live <= 1, JSON.stringify(r));
      check('dispose({ keepContext: true }) keeps it, and a new engine works on that canvas', r.kept, JSON.stringify(r));
      check('a released canvas refuses a new engine with canvas-released', r.reuse === 'canvas-released', JSON.stringify(r));
      check('unknown dispose option fails with dispose-options', r.badOpt === 'dispose-options', JSON.stringify(r));
      check('a renderer the game passed in keeps its context', r.gameKept, JSON.stringify(r));
    },
  },
  {
    name: 'durability-engine: net heartbeat -- a silently dead link emits close on the client and leave on the host; a healthy quiet link stays up (net test page)',
    url: '/tests/net/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { fakeNetwork, makeCoop } = threedogCoop;
        const wire = fakeNetwork({ manual: true, latency: 40 });
        const H = await makeCoop('host', wire.host());
        const t = wire.connect({ heartbeat: 500 });
        const A = await makeCoop('client', t);
        const go = ms => { for (let s = 0; s < ms; s += 1000 / 60) { wire.advance(1000 / 60); for (const e of [H, A]) e.step(1 / 60, { render: false }); } };
        const closes = []; A.events.on('net:close', () => closes.push(wire.now));
        go(1000);
        const up = A.net.connected && H.net.peers.length === 1;
        go(5000);
        const stillUp = A.net.connected && closes.length === 0;
        t.cut(); const cutAt = wire.now;
        go(3000);
        const out = { up, stillUp, closes: closes.length, after: closes[0] - cutAt, peers: H.net.peers.length, connected: A.net.connected };
        A.net.reconnect(wire.connect({ key: t.key, heartbeat: 500 })); go(1500);
        out.again = A.net.connected && H.net.peers.length === 1;
        H.dispose(); A.dispose();
        return out;
      });
      check('connected, and still connected after 5 s with pings only', r.up && r.stillUp, JSON.stringify(r));
      check('silent link: exactly one close on the client, 1-2.1 s after the cut (3 heartbeats after the last pong)', r.closes === 1 && r.after >= 1000 && r.after <= 2100 && !r.connected, JSON.stringify(r));
      check('the host drops the peer too', r.peers === 0, JSON.stringify(r));
      check('engine.net.reconnect with the old key brings it back', r.again, JSON.stringify(r));
    },
  },
  {
    name: 'durability-engine: a missing sound fails with asset-load naming the path; an uncaught rejection shows once in describe().unhandled (audio test page)',
    url: '/tests/audio/',
    expectErrors: /404|Not Found|nothing caught it|Sound failed/,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const err = async p => { try { await p; return null; } catch (e) { return { code: e.code, message: e.message }; } };
        const ext = await err(engine.audio.load('/nope/missing-sound.ogg'));
        const bare = await err(engine.audio.load('nope-missing-sound'));
        const before = engine.describe().unhandled ?? null;
        engine.audio.play('/nope/uncaught-a.ogg'); engine.audio.play('/nope/uncaught-b.ogg');   // the game forgot to catch: two rejections (either 404 may come back first)
        await __t.until(() => (engine._unhandled?.count ?? 0) >= 2, 5000).catch(() => {});
        return { ext, bare, before, after: engine.describe().unhandled ?? null, frozen: engine.frozen };
      });
      check('404 file: asset-load with the path', r.ext?.code === 'asset-load' && /missing-sound\.ogg/.test(r.ext.message), JSON.stringify(r.ext));
      check('dev server HTML answer: asset-load says not found, not "Unable to decode"', r.bare?.code === 'asset-load' && /nope-missing-sound/.test(r.bare.message) && /not found|404/.test(r.bare.message), JSON.stringify(r.bare));
      check('uncaught rejection: describe().unhandled has the first error and counts the rest, gameplay not frozen', !r.before && r.after?.code === 'asset-load' && /uncaught-[ab]/.test(r.after.message) && r.after.count === 2 && !r.frozen, JSON.stringify(r));
    },
  },
];

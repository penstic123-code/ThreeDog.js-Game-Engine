// Guards for consistency sweep part 2: handles end with remove(), timing options are objects (a positional number throws in dev).
// Each test builds fresh headless engines on the threads test page. Run: npm test -- "Sweep2"

const PAGE = '/tests/threads/';

export const specs = [
  {
    // the schema is the one options table: every createEngine key has a real type there (no 'any'), so a wrong shape fails at the call
    name: '[guard] Sweep2: createEngine options are typed in the schema; a wrong shape throws [module-params], union shapes pass',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all;
        const code = f => { try { const E = f(); E.dispose(); return 'ok'; } catch (e) { return e.code || e.message; } };
        const E = mk(T.createEngine, 'sw2-types');
        const types = Object.entries(E.catalog('core').params ?? {}).map(([k, v]) => [k, v.type ?? v]);
        E.dispose();
        return {
          anyKeys: types.filter(([, t]) => t === 'any').map(([k]) => k), count: types.length,
          badBatching: code(() => mk(T.createEngine, 'sw2-b', { batching: 'yes' })), badFov: code(() => mk(T.createEngine, 'sw2-f', { fov: 'wide' })),
          okUnion: code(() => mk(T.createEngine, 'sw2-u', { batching: false, joystick: true, threads: 0 })),
          badFallback: code(() => mk(T.createEngine, 'sw2-fb', { fallback: 'canvas2d' })),
        };
      });
      check('no createEngine key is typed any in the schema', r.count > 20 && r.anyKeys.length === 0, JSON.stringify(r));
      check("batching: 'yes' / fov: 'wide' / fallback: 'canvas2d' throw module-params", r.badBatching === 'module-params' && r.badFov === 'module-params' && r.badFallback === 'module-params', JSON.stringify(r));
      check('the shapes a key allows all pass (batching: false, joystick: true, threads: 0)', r.okUnion === 'ok', JSON.stringify(r));
    },
  },
  {
    // one call shape: a number where the options object goes is the old positional style and must fail loudly, not be read as something else
    name: '[guard] Sweep2: tween / fadeScreen / animator / fixed-camera blend take options; positional numbers throw [module-params]',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, out = {};
        const code = f => { try { f(); return 'ok'; } catch (e) { return e.code || e.message; } };
        const E = mk(T.createEngine, 'sw2-opts');
        E.use(T.timeline());
        await E.start();
        const o = { x: 0 };
        out.tweenOld = code(() => E.timeline.tween(o, { x: 1 }, 1));
        out.tweenNew = code(() => E.timeline.tween(o, { x: 1 }, { duration: 0.1, ease: 'linear' }));
        out.fadeOld = code(() => T.fadeScreen(E, 1, 0.5));
        out.fadeNew = code(() => T.fadeScreen(E, 0, { seconds: 0 }));
        // the option parse runs before the animator touches its state, so a bare object stands in for a model's animator
        out.goOld = code(() => T.Animator.prototype.go.call({}, 'run', 0.1));
        out.actionOld = code(() => T.Animator.prototype.action.call({ states: { wave: {} }, go: T.Animator.prototype.go }, 'wave', 0.2));
        E.dispose();
        return out;
      });
      check('tween(target, to, 1) throws, tween(target, to, { duration, ease }) works', r.tweenOld === 'module-params' && r.tweenNew === 'ok', JSON.stringify(r));
      check('fadeScreen(engine, 1, 0.5) throws, fadeScreen(engine, 0, { seconds }) works', r.fadeOld === 'module-params' && r.fadeNew === 'ok', JSON.stringify(r));
      check("animator go('run', 0.1) / action('wave', 0.2) throw", r.goOld === 'module-params' && r.actionOld === 'module-params', JSON.stringify(r));
    },
  },
  {
    // the cancel convention: whatever a game gets back to end something has remove(); stop / cancel / dispose are not a second way
    name: '[guard] Sweep2: tween and say() handles end with remove() (no cancel / stop); a look part unregisters with remove()',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all;
        const E = mk(T.createEngine, 'sw2-handles');
        E.use(T.timeline(), T.dialogue());
        await E.start();
        const tw = E.timeline.tween({ x: 0 }, { x: 1 }, { duration: 5 });
        const said = E.dialogue.say('hi', { channel: 'bubble' });
        const part = Object.values(E.look)[0];
        const out = { tw: [typeof tw.remove, 'cancel' in tw], say: [typeof said.remove, 'stop' in said], part: [typeof part?.author?.remove, typeof part?.dispose] };
        let tweenDone = null; tw.then(v => { tweenDone = v; }); tw.remove(); said.remove();
        await Promise.resolve(); await Promise.resolve();
        out.tweenDone = tweenDone;
        E.dispose();
        return out;
      });
      check('tween promise: remove() and no cancel()', r.tw[0] === 'function' && r.tw[1] === false, JSON.stringify(r));
      check('say() promise: remove() and no stop()', r.say[0] === 'function' && r.say[1] === false, JSON.stringify(r));
      check('look part: author.remove(), no dispose() (it owns no GPU resource)', r.part[0] === 'function' && r.part[1] === 'undefined', JSON.stringify(r));
    },
  },
];

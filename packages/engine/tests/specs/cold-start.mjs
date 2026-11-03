// 冷启动守卫（2026-11-02 实测审计：一个实验游戏冷启动 2.9 s、加载画面最长冻住 1.09 s）。每条守住一处修法，回退就红：
//   1. ready 之前主循环不画场景（只剩加载画面；start() 自己画一帧藏在加载画面后面的预热帧）
//   2. 后期开着时 compileAsync 编的是 composer 目标那一套着色器变体，不是画布那一套（程序键不同，编了白编）
//   3. 基线房间环境图（PMREM，冷启动约 0.6 s）只在场景里有会读 scene.environment 的材质时才生成
//   4. rigid 的 Rapier WASM 从 install 就开始加载，不等 start() 排到它的 init
//   5. 每次巡检都在动的未合批根节点不再反复拆组 / 入组；开放提示只数游戏自己的根、主键掉下去会换成别的够数的键
// 每条都在 /tests/threads/ 页上建自己的引擎。运行：node packages/tools/bin/threedog.mjs test -w engine "Cold start"

const PAGE = '/tests/threads/';

export const specs = [
  {
    name: 'Cold start: before ready the loop never renders the scene; start() draws exactly one hidden warm-up frame',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine } = threedogThreads;
        // 不是 headless：要真的主循环（rAF）在加载期间跑帧，才看得出加载时有没有画场景
        const E = createEngine({ canvas: document.createElement('canvas'), urlState: false, saveKey: 'cs-render', ui: { loading: false } });
        let before = 0, frames = 0;
        const orig = E._render;
        E._render = function (dt) { if (!this.ready) before++; return orig.call(this, dt); };
        const t0 = performance.now();
        // 一个要等 400 ms 才就绪的模块：加载期间主循环肯定跑过好几帧
        E.use({ name: 'csSlow', type: 'rules', frame() { frames++; }, isReady: () => performance.now() - t0 > 400 });
        await E.start();
        const out = { before, frames };
        E.dispose();
        return out;
      });
      check('loading frames ran (frame hooks keep going while loading)', r.frames > 2, JSON.stringify(r));
      check('the only scene render before ready is the warm-up frame start() draws behind the loading screen', r.before === 1, JSON.stringify(r));
    },
  },
  {
    name: 'Cold start: with post on, compileAsync runs with the composer target bound; with post off, with the canvas (null)',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine } = threedogThreads;
        const one = async (post) => {
          const E = createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cs-compile-' + post, ui: { loading: false } });
          // a pass-through effect turns the composer on; nothing on = straight to the canvas (PostFX direct; MSAA there is the canvas's own)
          if (post) E.look.post.add({ name: 'through', slot: 'ldr', fuse: { glsl: '' } });
          let target;
          const ca = E.renderer.compileAsync.bind(E.renderer);
          E.renderer.compileAsync = (s, c, t) => { target = E.renderer.getRenderTarget(); return ca(s, c, t); };
          await E.start();
          const rt1 = E.post.object()?.renderTarget1 ?? null;
          const out = { active: E.post.active, sameAsComposer: target === rt1 && rt1 !== null, isNull: target === null, after: E.renderer.getRenderTarget() === null };
          E.dispose();
          return out;
        };
        return { on: await one(true), off: await one(false) };
      });
      check('post on: compiled for composer.renderTarget1 (the half-float target the scene really draws into)', r.on.active && r.on.sameAsComposer, JSON.stringify(r));
      check('post off: compiled for the canvas', !r.off.active && r.off.isNull, JSON.stringify(r));
      check('the render target is back to the canvas after compiling', r.on.after && r.off.after, JSON.stringify(r));
    },
  },
  {
    name: 'Cold start: the baseline room environment (PMREM) is built only once a material that reads scene.environment is in the scene',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, THREE } = threedogThreads;
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cs-env', ui: { loading: false } });
        const box = new THREE.BoxGeometry();
        E.scene.add(new THREE.Mesh(box, new THREE.MeshToonMaterial()), new THREE.Mesh(box, new THREE.MeshBasicMaterial()));
        const atCreate = !!E._roomEnv;
        await E.start();
        E.step(1 / 30);
        const toonOnly = { built: !!E._roomEnv, env: E.scene.environment };
        // three 0.187 hands scene.environment to Standard / Physical, Lambert and Phong (WebGLPrograms.getParameters): any one of them turns it on
        const m = new THREE.Mesh(box, new THREE.MeshToonMaterial());
        E.scene.add(m);
        E.step(1 / 30);
        const stillToon = !!E._roomEnv;
        m.material = new THREE.MeshStandardMaterial();   // a material swap on a mesh the walk saw is seen too (core/sceneDelta.js watchMaterial)
        E.step(1 / 30);
        const out = { atCreate, toonOnly: toonOnly.built || toonOnly.env !== null, stillToon, built: !!E._roomEnv, isOurs: E.scene.environment === E._roomEnv?.texture,
          intensity: E.scene.environmentIntensity, want: E.look.lights.value('env.intensity') };
        // the game's own map still wins: env.intensity changes never overwrite it
        const mine = new THREE.Texture(); E.scene.environment = mine; E.look.lights.set({ env: { intensity: 0.7 } }); E.step(1 / 30);
        out.gameKeeps = E.scene.environment === mine;
        E.dispose();
        return out;
      });
      check('createEngine builds no PMREM', !r.atCreate, JSON.stringify(r));
      check('a Toon / Basic-only scene never gets the room map', !r.toonOnly && !r.stillToon, JSON.stringify(r));
      check('swapping in a MeshStandardMaterial builds it and sets it as scene.environment at look.lights env.intensity', r.built && r.isOurs && r.intensity === r.want && r.want > 0, JSON.stringify(r));
      check('a scene.environment the game set is never overwritten', r.gameKeeps, JSON.stringify(r));
    },
  },
  {
    name: 'Cold start: a Lambert scene has the room map at ready, so compileAsync compiled the environment variant',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, THREE } = threedogThreads;
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cs-env2', ui: { loading: false } });
        E.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial()));
        let envAtCompile = null;
        const ca = E.renderer.compileAsync.bind(E.renderer);
        E.renderer.compileAsync = (s, c, t) => { envAtCompile = !!s.environment; return ca(s, c, t); };
        await E.start();
        const out = { envAtCompile, ready: E.scene.environment === E._roomEnv?.texture };
        E.dispose();
        return out;
      });
      check('scene.environment was set before compileAsync (it is part of the program key)', r.envAtCompile && r.ready, JSON.stringify(r));
    },
  },
  {
    name: 'Cold start: rigid starts loading Rapier at install, before start() reaches its init; rigid.addBox before start() throws with the fix',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, all, THREE } = threedogThreads;
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cs-rigid', ui: { loading: false } });
        E.use(all.collision(), all.rigid());
        const early = E.rigid._rapier instanceof Promise;   // begun by install, nothing awaited yet
        const p = E.rigid._rapier;
        // a body added before start() has no physics world: it threw a TypeError (or returned null) far from the cause; now the call throws
        const tooEarly = (f) => { try { f(); return 'no error'; } catch (e) { return e.message; } };
        const box = tooEarly(() => E.rigid.addBox(new THREE.Mesh(new THREE.BoxGeometry())));
        const ball = tooEarly(() => E.rigid.addBall(new THREE.Mesh(new THREE.BoxGeometry()), { radius: 0.5 }));
        await E.start();
        const after = E.rigid.addBox(new THREE.Mesh(new THREE.BoxGeometry()));
        const out = { early, same: E.rigid._rapier === p, ready: E.rigid.ready, box, ball, after: !!after?.body };
        E.dispose();
        return out;
      });
      check('the Rapier import is under way right after engine.use', r.early, JSON.stringify(r));
      check('init awaited that same load (no second import) and physics is ready', r.same && r.ready, JSON.stringify(r));
      check('[guard] rigid.addBox / addBall before start() throw [module-needs] naming the call and the fix (after start / engine:ready)',
        /module-needs/.test(r.box) && /rigid\.addBox\(\) ran before physics was ready/.test(r.box) && /engine:ready/.test(r.box) && /rigid\.addBall\(\)/.test(r.ball), `${r.box} | ${r.ball}`);
      check('the same addBox after start() gives a body', r.after, JSON.stringify(r));
    },
  },
  {
    name: 'Cold start: batching stops regrouping an unbatched root that moves on every check, and takes it back once it rests',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, THREE } = threedogThreads;
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cs-batch', ui: { loading: false } });
        await E.start();
        const B = E.batching, geo = new THREE.BoxGeometry(), mat = new THREE.MeshLambertMaterial();
        const root = new THREE.Group(); root.userData.batch = true; root.add(new THREE.Mesh(geo, mat));
        E.scene.add(root);
        B.update();
        const info = B.roots.get(root);
        let attaches = 0; const at = B._attach.bind(B); B._attach = i => { if (i === info) attaches++; return at(i); };
        for (let i = 0; i < 20; i++) { root.position.x += 0.01; root.position.y = Math.sin(i); B.update(); }   // a floating pickup: moves every frame
        const moving = { attaches, moving: info?.moving, inGroup: info?.entries.some(e => e.group) };
        B.update(); B.update();   // it rests
        const out = { tracked: !!info, moving, rested: { moving: info?.moving, inGroup: info?.entries.some(e => e.group) } };
        E.dispose();
        return out;
      });
      check('the root was tracked as a batch candidate', r.tracked, JSON.stringify(r));
      check('after a few moving checks it stops being regrouped (fewer than 3 attaches over 20 moving frames) and leaves its group', r.moving.attaches < 3 && r.moving.moving === true && !r.moving.inGroup, JSON.stringify(r));
      check('resting again puts it back in its group', r.rested.moving === false && r.rested.inGroup, JSON.stringify(r));
    },
  },
  {
    name: 'Cold start: the batching opt-in hint ignores engine-module roots and falls back to another key still at minCount',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, THREE } = threedogThreads;
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cs-hint', ui: { loading: false } });
        await E.start();
        const B = E.batching, box = new THREE.BoxGeometry(), mat = new THREE.MeshLambertMaterial();
        const mk = (g, n) => Array.from({ length: n }, () => new THREE.Mesh(g, mat));
        // engine-module helpers (owner 'engine:grid'): never counted toward the game's hint
        const tiles = mk(new THREE.PlaneGeometry(), 12);
        for (const t of tiles) E._things.byObj.set(t, { owner: 'engine:grid' });
        E.scene.add(...tiles); B.update();
        const engineOnly = B.stats.hint ?? null;
        const a = mk(box, 10), b = mk(new THREE.SphereGeometry(), 9);
        E.scene.add(...a, ...b); B.update();
        const top = B.stats.hint;
        for (const m of a) m.removeFromParent();   // the named key drops out entirely
        B.update();
        const out = { engineOnly, top, after: B.stats.hint ?? null };
        E.dispose();
        return out;
      });
      check('12 engine:grid tiles give no hint', r.engineOnly === null, JSON.stringify(r));
      check('the hint names the most repeated game mesh (10 copies)', /^10 copies/.test(r.top ?? ''), JSON.stringify(r));
      check('when those leave, the hint moves to the 9 spheres instead of vanishing', /^9 copies/.test(r.after ?? ''), JSON.stringify(r));
    },
  },
];

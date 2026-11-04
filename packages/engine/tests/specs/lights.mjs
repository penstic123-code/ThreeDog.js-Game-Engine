// Light pool (modules/lights) and the dev light-recompile warning (core/lightWatch.js). Page: tests/lights (40 torches, 4 pool lights, headless).
// The point of the pool is that the light setup never changes, so three.js never compiles a shader mid-play: this spec walks the camera
// down the corridor past every torch and checks the program count and the scene's light count stay exactly what they were at ready.

export const specs = [
  {
    // [guard] `shot --view` showed the lamps of the old spot: the pool only reassigns every 0.1 s and fades over 0.3 s, and a shot draws 1/30 s after the cut.
    // A dark picture from a good scene sent a game into a wrong round of brightness tuning
    name: '[guard] lightPool: a camera view lights the lamps at the new spot in the very next frame, at full strength',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all;
        const E = mk(T.createEngine, 'pool-view');
        E.use(T.lightPool({ point: 1 }));
        E.lightPool.add({ x: 0, y: 3, z: 0 }, { intensity: 10, distance: 20 });
        E.lightPool.add({ x: 200, y: 3, z: 0 }, { intensity: 10, distance: 20 });
        E.views.define('far', { position: [200, 5, 8], target: [200, 0, 0] });
        await E.start();
        E.camera.position.set(0, 5, 8); E.step(0.5);
        const before = E.lightPool.lights[0].position.x;
        E.views.show('far'); E.step(1 / 30);
        const L = E.lightPool.lights[0], after = { x: L.position.x, intensity: L.intensity };
        E.dispose();
        return { before, after };
      });
      check('the one pool light starts at the near lamp', r.before === 0, JSON.stringify(r));
      check('one frame after the view it sits on the lamp at the view, at full strength', r.after.x === 200 && r.after.intensity === 10, JSON.stringify(r));
    },
  },
  {
    name: 'lightPool: walking past 40 torches keeps the program count and light count constant; nearest torches get the lights; stand-ins fade; usage / remove',
    url: '/tests/lights/index.html',
    async run({ check, ev }) {
      const r = await ev(() => { try {
        const { torches, halos, lightSetup } = threedogTest, P = engine.lightPool, info = engine.renderer.info;
        engine.step(0.5);   // a first rendered frame at the start position, lights faded in
        const start = { programs: info.programs.length, lights: lightSetup(engine.scene), real: P.lights.length };
        const programs = new Set(), lights = new Set(), near = [];
        for (let z = 5; z >= -200; z -= 2.5) {
          engine.camera.position.set(0, 1.7, z);
          engine.step(0.25);   // renders one frame at the end
          programs.add(info.programs.length); lights.add(lightSetup(engine.scene));
        }
        engine.camera.position.set(0, 1.7, -100); engine.step(0.6);   // settle: choose (every 0.1 s) + fade out the old (0.2 s) + fade in (0.2 s)
        const nearest = torches.map((t, i) => ({ i, d: Math.abs(-i * 5 - -100) })).sort((a, b) => a.d - b.d).slice(0, 4).map(o => o.i);
        for (const i of nearest) near.push({ i, weight: torches[i].weight, light: !!torches[i].light, glow: halos[i].material.emissiveIntensity });
        const far = { weight: torches[0].weight, glow: halos[0].material.emissiveIntensity };
        const usage = P.usage(), d = engine.describe().lightPool;
        // put the nearest torch out: its light moves to another torch, still 4 lights in the scene
        torches[nearest[0]].set({ intensity: 0 }); engine.step(0.6);
        const out = { weight: torches[nearest[0]].weight, lit: P.usage().lit };
        torches[nearest[1]].remove(); torches[nearest[1]].remove(); engine.step(0.6);
        const removed = { sources: P.usage().sources, glow: halos[nearest[1]].material.emissiveIntensity };
        const end = { programs: info.programs.length, lights: lightSetup(engine.scene) };
        return { start, programs: [...programs], lights: [...lights], near, far, usage, d, out, removed, end };
      } catch (err) { return { err: String(err.stack) }; } });
      if (r.err) { check('runs without error', false, r.err); return; }
      check('4 real point lights exist from the start (plus the default sun + hemisphere)', r.start.real === 4 && /point 4,/.test(r.start.lights), JSON.stringify(r.start));
      check('walking past every torch: shader program count never changes', r.programs.length === 1 && r.programs[0] === r.start.programs && r.end.programs === r.start.programs, JSON.stringify({ start: r.start, seen: r.programs, end: r.end }));
      check('walking past every torch: the scene light setup never changes', r.lights.length === 1 && r.lights[0] === r.start.lights && r.end.lights === r.start.lights, JSON.stringify(r.lights));
      check('the 4 torches nearest the camera hold the 4 lights at full strength, their stand-in glow faded to 0', r.near.every(n => n.light && n.weight === 1 && n.glow === 0), JSON.stringify(r.near));
      check('a far torch has no light and its stand-in glows at its own value (2)', r.far.weight === 0 && r.far.glow === 2, JSON.stringify(r.far));
      check('usage() and describe().lightPool report 40 sources, 4 lit', r.usage.sources === 40 && r.usage.lit === 4 && r.usage.slots.length === 4 && r.d.lights === 4 && r.d.lit === 4 && r.d.sources === 40, JSON.stringify({ u: r.usage, d: r.d }));
      check('a torch set to intensity 0 gives its light away; all 4 lights still lit by others', r.out.weight === 0 && r.out.lit === 4, JSON.stringify(r.out));
      check('remove() (twice is safe) unregisters and puts the stand-in back', r.removed.sources === 39 && r.removed.glow === 2, JSON.stringify(r.removed));
    },
  },
  {
    name: 'lightPool: a game that adds a light after ready gets the light-recompile warning in dev',
    url: '/tests/lights/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE } = threedogTest, warn = console.warn; let w = '';
        console.warn = (...a) => { w += a.join(' ') + '\n'; };
        try {
          engine.step(0.2);
          const quiet = w;
          const extra = new THREE.PointLight(0xffffff, 1, 5); extra.position.set(0, 2, 0);
          engine.scene.add(extra);   // what the dungeon game did: a torch turning its own light on mid-play
          engine.step(0.2);
          return { quiet, w, programs: engine.renderer.info.programs.length };
        } finally { console.warn = warn; }
      });
      check('no warning while the pool keeps the lights fixed', !/light-recompile/.test(r.quiet), r.quiet);
      check('adding a light after ready: warning with code light-recompile pointing to lightPool and recipe 09', /\[light-recompile\]/.test(r.w) && /lightPool/.test(r.w) && /09-materials-lights-models/.test(r.w), r.w);
    },
  },
  {
    name: 'dev hint: more than 8 loose real-time lights warn once with code many-lights',
    url: '/tests/lights/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE } = threedogTest, warn = console.warn; let w = '';
        console.warn = (...a) => { w += a.join(' ') + '\n'; };
        try {
          for (let i = 0; i < 9; i++) engine.scene.add(new THREE.PointLight(0xffffff, 1, 5));
          engine.step(0.2); engine.step(0.2);
          return w;
        } finally { console.warn = warn; }
      });
      check('many-lights warning names lightPool', /\[many-lights\]/.test(r) && /lightPool/.test(r), r);
      check('the warning appears once', (r.match(/\[many-lights\]/g) || []).length === 1, r);
    },
  },
];

// Review guards ("do not bypass"): the engine picks no gameplay key, no day cycle, no dialogue duck and no sea for a game; plus the bugs the
// review found (autopilot speed, afterLoad on newGame, idle shadow slots, level nodes without world, canvas with one auto axis, audio before unlock...).
// Same format as the other files here. Run: npm test -- "review guard"
const PAGE = '/tests/threads/';

export const specs = [
  {
    name: 'review guard: no module binds a gameplay key or takes a keys option; presets.bindings holds them; module actions leave with the module',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, { createEngine, presets } = T, out = {};
        const err = f => { try { f(); return null; } catch (e) { return String(e.code || e.message); } };
        const E = mk(createEngine, 'rg-keys');
        // every module that used to take keys: installs without them, declares its action, binds nothing
        out.use = err(() => E.use(T.world(), T.collision(), T.characters({ npcs: false }), T.interactions({ ...presets.interactions.nearest }), T.inventory(), T.quests(), T.photo(), T.grids(), T.rtsCamera()));
        const acts = ['interact', 'inventory', 'quests', 'photo', 'jump', 'run', 'brake', 'rotateLeft', 'rotateRight'];
        out.declared = acts.filter(a => E.input.actions.has(a));
        out.bound = acts.filter(a => E.input.keysOf(a).length);
        // a keys option is an unknown option now (the old way fails loudly instead of being ignored)
        out.keysOpt = ['inventory', 'quests', 'photo', 'interactions'].map(n => err(() => T[n]({ keys: ['KeyX'], pick: 'nearest' })));
        out.brakeOpt = err(() => T.characters({ brakeKeys: ['KeyB'] }));
        out.presetKeys = 'keys' in presets;
        // modules leave with their actions (ctx-tracked, also the rts camera's and the grid preview's)
        for (const n of ['inventory', 'quests', 'photo', 'interactions', 'cameraRig', 'characters']) E._unuse(n);
        out.left = acts.filter(a => E.input.actions.has(a));
        const F = mk(createEngine, 'rg-keys2', { bindings: { ...presets.bindings.walk, ...presets.bindings.inventory, ...presets.bindings.brake } });
        F.use(T.world(), T.inventory());
        out.invKeys = F.input.keysOf('inventory'); out.jump = F.input.keysOf('jump'); out.brake = F.input.keysOf('brake');
        // core pad keys are only in the basics: a game binding jump to Space gets no gamepad A behind its back
        const G = mk(createEngine, 'rg-keys3', { bindings: { jump: ['Space'], interact: ['KeyF'], run: ['ShiftLeft'] } });
        out.gJump = G.input.keysOf('jump'); out.gInteract = G.input.keysOf('interact'); out.gRun = G.input.keysOf('run');
        out.confirmPad = G.input.keysOf('confirm').includes('PadA');
        E.dispose(); F.dispose(); G.dispose();
        return out;
      });
      check('modules install without keys and declare their actions', r.use === null && r.declared.length === 9, JSON.stringify(r));
      check('[guard] no module binds a key by itself', r.bound.length === 0, JSON.stringify(r.bound));
      check('[guard] keys / brakeKeys options are unknown options; presets.keys is gone', r.keysOpt.every(x => x === 'module-params') && r.brakeOpt === 'module-params' && !r.presetKeys, JSON.stringify(r));
      check('[guard] module actions leave with the module (rts camera and characters too)', r.left.length === 0, JSON.stringify(r.left));
      check('presets.bindings: inventory I + Y, walk Space + A, brake B + LT', r.invKeys.includes('KeyI') && r.invKeys.includes('PadY') && r.jump.includes('PadA') && r.brake.includes('PadLT'), JSON.stringify(r));
      check('[guard] core adds no gamepad key to jump / interact / run; confirm keeps PadA', !r.gJump.some(k => k.startsWith('Pad')) && !r.gInteract.some(k => k.startsWith('Pad')) && !r.gRun.some(k => k.startsWith('Pad')) && r.confirmPad, JSON.stringify(r));
    },
  },
  {
    name: 'review guard: calendar() keeps a fixed time of day, presets.calendar.cycle moves it; music() does not duck for dialogue unless asked; time condition warns on unknown forms',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, { createEngine, presets } = T, out = {};
        const E = mk(createEngine, 'rg-sky');
        E.use(T.calendar({ time: 0.3 }), T.sky(), T.music()); await E.start();
        const t0 = E.calendar.timeOfDay; E.step(30, { render: false }); out.fixed = E.calendar.timeOfDay === t0; out.len = E.calendar.dayLength;
        E.audio._init();
        E.events.emit('dialogue:start', {}); E.step(0.5, { render: false });
        out.duck = E.audio.info.ducks.music ?? 1;
        const warns = [], w0 = console.warn; console.warn = (...a) => warns.push(a.join(' '));
        out.evening = E.audio.matches({ time: 'evening' }, {}); console.warn = w0;
        out.warned = warns.some(m => /never matches/.test(m) && /'day', 'night'/.test(m));
        const F = mk(createEngine, 'rg-sky2');
        F.use(T.calendar({ ...presets.calendar.cycle, time: 0.3 }), T.sky(), T.music({ duckDialogue: 0.35 })); await F.start();
        F.step(30, { render: false }); out.moves = F.calendar.timeOfDay > 0.3;
        F.audio._init(); F.events.emit('dialogue:start', {}); F.step(1, { render: false });
        out.duckOn = F.audio._ducks.size;
        out.seasonsCycle = presets.calendar.fourSeasons.dayLength;
        E.dispose(); F.dispose();
        return out;
      });
      check('[guard] calendar() alone: dayLength Infinity, the time of day does not move', r.fixed && r.len === Infinity, JSON.stringify(r));
      check('presets.calendar.cycle (and fourSeasons) bring the 360 s day', r.moves && r.seasonsCycle === 360, JSON.stringify(r));
      check('[guard] music() alone does not duck for dialogue; duckDialogue opts in', r.duck === 1 && r.duckOn === 1, JSON.stringify(r));
      check('time: \'evening\' warns with the accepted forms and does not match', r.evening === false && r.warned, JSON.stringify(r));
    },
  },
  {
    name: 'review guard: terrain has no sea and leaves the fog unless asked; idle shadow slots skip their shadow pass; shadows >= point still lights plain sources',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, { lightPool } = T, { createEngine } = T, out = {};
        out.water = T.createTerrain({}).waterLevel;
        const E = mk(createEngine, 'rg-terrain');
        E.use(T.terrain({ viewChunks: 2 })); await E.start();
        out.fogFar = E.terrain.viewFogFar; out.engineWater = E.waterLevel;
        const F = mk(createEngine, 'rg-terrain2');
        F.use(T.terrain({ viewChunks: 2, viewFog: true })); await F.start(); out.viewFog = F.terrain.viewFogFar;
        // viewFog goes out as a signal: a sky writes no fog from it
        F.step(0.1); out.viewSignal = F.uniforms.uViewDistance.value; out.noSignal = E.uniforms.uViewDistance.value;
        const G = mk(createEngine, 'rg-terrain3');
        G.use(T.sky(), T.terrain({ viewChunks: 2, viewFog: true })); await G.start(); G.step(0.1);
        out.fogAfter = G.scene.fog;
        E.dispose(); F.dispose(); G.dispose();
        // light pool: 2 points, both cast; a source without castShadow still gets one, and a dark slot has autoUpdate off
        const warns = [], w0 = console.warn; console.warn = (...a) => warns.push(a.join(' '));
        const L = mk(createEngine, 'rg-lights');
        L.use(lightPool({ point: 2, shadows: 2, fade: 0 })); console.warn = w0;
        out.allShadowWarn = warns.some(m => /every point light casts shadows/.test(m));
        await L.start();
        out.idleAuto = L.lightPool.lights.map(l => l.shadow.autoUpdate);
        const h = L.lightPool.add({ x: 0, y: 1, z: 0 }, { intensity: 3, distance: 8 });
        L.step(0.3);
        out.lit = L.lightPool.stats.lit; out.autoAfter = L.lightPool.lights.filter(l => l.shadow.autoUpdate).length;
        h.remove(); L.step(0.5);
        out.autoGone = L.lightPool.lights.filter(l => l.shadow.autoUpdate).length;
        L.dispose();
        return out;
      });
      check('[guard] terrain without waterLevel has no sea (-Infinity)', r.water === -Infinity && r.engineWater === -Infinity, JSON.stringify(r));
      check('[guard] terrain leaves the fog alone; viewFog: true puts the view distance on the signal uViewDistance', r.fogFar === null && r.viewFog > 0 && r.viewSignal === r.viewFog && r.noSignal === 600, JSON.stringify(r));
      check('[guard] viewFog under a sky writes no scene.fog', r.fogAfter === null, JSON.stringify(r.fogAfter));
      check('[guard] idle shadow slots render no shadow map (autoUpdate false), a lit one does, released again after', r.idleAuto.every(a => a === false) && r.autoAfter === 1 && r.autoGone === 0, JSON.stringify(r));
      check('shadows >= point: a non-casting source still lights (and the pool warns once)', r.lit === 1 && r.allShadowWarn, JSON.stringify(r));
    },
  },
  {
    name: 'review guard: afterLoad runs on saves.apply and session.newGame; level nodes with id stay without world(); audio.play before unlock does not throw',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, { level } = threedogThreads, { createEngine, THREE } = T, out = { hooks: 0 };
        const E = mk(createEngine, 'rg-load');
        E.use(T.world(), { name: 'rgHook', type: 'rules', afterLoad: async () => { out.hooks++; } });
        await E.start();
        const data = E.saves.collect();
        out.applied = await E.saves.apply(data); out.afterApply = out.hooks;
        await E.session.newGame(); out.afterNew = out.hooks;
        E.dispose();
        // a level whose node carries a custom property id, no world(): the node stays in the scene, one warning names the fix
        const warns = [], w0 = console.warn; console.warn = (...a) => warns.push(a.join(' '));
        const root = new THREE.Group(); root.name = 'lvl';
        const ground = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 10)); ground.name = 'ground'; root.add(ground);
        const chest = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); chest.name = 'chest'; chest.userData.id = 'chest'; chest.position.set(2, 0.6, 0); root.add(chest);
        const L = mk(createEngine, 'rg-level');
        L.use(level({ scene: root })); await L.start(); console.warn = w0;
        out.kept = chest.parent === root; out.levelWarn = warns.some(m => /install world\(\)/.test(m));
        L.dispose();
        // audio.play of a named asset before any click: no throw (the context is created suspended)
        const A = mk(createEngine, 'rg-audio');
        A.assets.manifest({ name: 'rg', sounds: { beep: '/tests/settings/audio/sting.wav' } });
        try { const h = await A.audio.play('beep'); out.play = h ? 'handle' : 'null'; } catch (e) { out.play = 'threw: ' + e.message; }
        A.dispose();
        return out;
      });
      check('[guard] saves.apply runs the modules\' afterLoad', r.applied === true && r.afterApply === 1, JSON.stringify(r));
      check('[guard] session.newGame runs afterLoad too', r.afterNew === 2, JSON.stringify(r));
      check('[guard] a node with id stays in the level without world() and the warning names world()', r.kept && r.levelWarn, JSON.stringify(r));
      check('audio.play(\'assetName\') before the first click resolves instead of throwing', r.play === 'handle', String(r.play));
    },
  },
  {
    name: 'review guard: a canvas with one auto axis (width 100%, height auto) keeps its own box; assets warn when a later manifest replaces a name; pack startItems add up',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, { createEngine } = T, out = {};
        const host = document.createElement('div'); host.style.cssText = 'position:absolute;left:0;top:0;width:500px';
        const cv = document.createElement('canvas'); cv.width = 400; cv.height = 200; cv.style.cssText = 'width:100%;height:auto;display:block';
        host.append(cv); document.body.append(host);
        const E = createEngine({ canvas: cv, headless: true, urlState: false, saveKey: 'rg-canvas', ui: { loading: false } });
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        out.auto = E._autoSize; out.w = cv.clientWidth; out.h = cv.clientHeight;
        E.dispose(); host.remove();
        const warns = [], w0 = console.warn; console.warn = (...a) => warns.push(a.join(' '));
        const A = mk(createEngine, 'rg-assets');
        A.assets.manifest({ name: 'packA', models: { tree: '/a/tree.glb' } }); A.assets.manifest({ name: 'packB', models: { tree: '/b/tree.glb' } });
        console.warn = w0; out.replaced = warns.some(m => m.includes('packA') && m.includes('packB') && m.includes('tree'));
        A.use(T.world(), T.inventory(), T.content()); await A.start();
        A.content.load([{ name: 'base', items: { gold: { name: 'Gold' } }, startItems: { gold: 5 } }, { name: 'dlc', startItems: { gold: 3 } }]);
        out.gold = A.inventory.count('gold');
        A.dispose();
        return out;
      });
      check('[guard] width: 100%; height: auto is not treated as unsized (no window size forced)', r.auto === false && r.w === 500 && Math.abs(r.h - 250) <= 1, JSON.stringify(r));
      check('a later manifest replacing a same-named asset warns naming both manifests', r.replaced, JSON.stringify(r));
      check('startItems from two packs add up instead of clashing', r.gold === 8, JSON.stringify(r));
    },
  },
  {
    name: 'review guard: autopilot speed reaches the player (one move.speed entry, not a second speed road)',
    url: '/tests/a/',
    async run({ check, ev }) {
      // since acb3fd2a autopilot { speed } is a move.speed entry (owner 'autopilot', id 'player'); moveInput() returns only the direction.
      // The guard is that the speed still reaches the player and is released again, so a recording or benchmark walks at the asked speed
      const r = await ev(() => {
        engine.haltLoop();
        const s = engine.stacks.get('move.speed');
        engine.input.autopilot = { x: 0, y: 1, speed: 3.5 }; engine.step(0.05);
        const a = [s.value('player'), s.names('player').includes('autopilot'), engine.characters.moveInput().speed];
        engine.input.autopilot = null; engine.step(0.05);
        const b = s.names('player').includes('autopilot');
        return { a, b, player: !!engine.player };
      });
      check('[guard] input.autopilot.speed sets the player move.speed (owner autopilot) and is released when autopilot ends', r.player && r.a[0] === 3.5 && r.a[1] && r.a[2] === undefined && r.b === false, JSON.stringify(r));
    },
  },
];

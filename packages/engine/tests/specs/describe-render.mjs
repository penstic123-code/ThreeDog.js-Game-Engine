// describe().render: current renderer / post / light values, each tagged engine | style | game (core/describeRender.js).
export const specs = [
  {
    name: 'describe render: values listed, a change made by the game is tagged game (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const before = engine.describe().render;
        // tone mapping is plain three.js (written once at creation, never again): the game's direct write shows as game and stays after frames
        const m0 = engine.renderer.toneMapping;
        engine.renderer.toneMapping = engine.THREE.NeutralToneMapping; engine.step(0.05); engine.step(0.05);
        const after = engine.describe().render, kept = engine.renderer.toneMapping === engine.THREE.NeutralToneMapping;
        let old = ''; try { engine.look.tone.set({ mapping: 'aces' }); } catch (e) { old = e.message; }
        const text = engine.describeText({ full: true });
        engine.renderer.toneMapping = m0;
        return { before, after, kept, old, text };
      });
      check(r.before.toneMapping.writer !== 'game', 'tone mapping untouched is not tagged game');
      check(r.after.toneMapping.value === 'neutral' && r.after.toneMapping.writer === 'game' && r.kept, 'renderer.toneMapping written by the game: tagged game, never overwritten by the engine', JSON.stringify(r.after.toneMapping));
      check(/renderer\.toneMapping = THREE\./.test(r.old), 'look.tone.set({ mapping }) is gone: the error gives the plain three.js line', r.old);
      check(Array.isArray(r.before.post) && Array.isArray(r.before.lights) && r.before.lights.length > 0, 'post and lights lists present');
      check(r.before.lights.every(l => l.source === 'engine-default'), 'default lights are marked engine-default');
      check(/^renderer: /m.test(r.text), 'full text has the renderer line');
    },
  },
  {
    name: 'describe holds: pause / freeze / camera / debug view owners come in one shape (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const none = engine.describe().holds;
        const p = engine.pause('t-pause'), f = engine.freeze('t-freeze'), c = engine.takeCamera('t-cam'), v = engine.debug.view('normals', { owner: 't-view' });
        const held = engine.describe().holds;
        p.remove(); f.remove(); c.remove(); engine.debug.clear('t-view');
        return { none, held, after: engine.describe().holds };
      });
      const shape = o => Array.isArray(o) && o.every(x => typeof x.owner === 'string' && typeof x.at === 'number');
      check(['pause', 'freeze', 'camera', 'debugView'].every(k => r.held[k]?.[0]?.owner === 't-' + (k === 'debugView' ? 'view' : k === 'camera' ? 'cam' : k)), 'each kind lists its owner', JSON.stringify(r.held));
      check(Object.values(r.held).every(shape), 'every kind has the same [{ owner, at }] shape');
      check(!r.after.pause && !r.after.freeze && !r.after.camera && !r.after.debugView, 'released claims leave the list', JSON.stringify(r.after));
    },
  },
  {
    name: 'render scale: describe().render.scale says upscaled / auto-lowered / floor, and the first auto-lowering warns once (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const warns = [], w0 = console.warn; console.warn = (...a) => { warns.push(String(a[0])); };
        try {
          engine.pause();
          const dpr = devicePixelRatio || 1, base = engine.describe().render.scale;
          const a = engine.adaptive; a.on = true; a.paused = false; a.target = 60; a.lowered = false; a.from = null; a.age = 10;   // past the startup grace
          const max = a.max; engine.setPixelRatio(max);
          const slow = () => { for (let i = 0; i < 10; i++) engine._adapt(0.1, 60, false, true); };   // 60 ms frames with GPU time known: overload
          slow(); slow();
          const low = engine.describe().render.scale;
          const text = engine.describeText({ full: true });
          engine.setPixelRatio(max); a.on = false;
          return { dpr, base, low, max, warns: warns.filter(x => /render scale/.test(x)), text };
        } finally { console.warn = w0; }
      });
      check(r.base.devicePixelRatio === r.dpr && typeof r.base.upscaled === 'boolean' && r.base.floor === 0.6, 'scale lists current / devicePixelRatio / upscaled / floor', JSON.stringify(r.base));
      check(r.low.autoLowered === true && r.low.current < r.max && r.low.upscaled === true, 'after auto-lowering: autoLowered and upscaled are true', JSON.stringify(r.low));
      check(r.warns.length === 1 && /->/.test(r.warns[0]) && /adaptiveResolution: false/.test(r.warns[0]), 'one dev warning names the change, the fps and how to turn it off', JSON.stringify(r.warns));
      check(/render scale: .*auto-lowered/.test(r.text), 'the text summary says so too');
    },
  },
  {
    // W8: every engine module reports itself (rule R44 enforces the hook exists; this checks the hooks answer with their fields on a real page),
    // and "who set it" is `writer` everywhere: no `by` key anywhere in describe() (style values under `value` are data, not a who field)
    name: 'describe hooks: ambience / collision / music / particles / photo / rigid / water / settings report their state, no `by` key left (example world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        if (engine.particles.effects.has('dust')) engine.particles.emit('dust', engine.player.position, { count: 12 });
        const d = engine.describe(), keys = o => (o && typeof o === 'object' ? Object.keys(o).sort().join() : String(o));
        const byPaths = [];
        (function walk(o, path) {
          if (!o || typeof o !== 'object') return;
          for (const [k, v] of Object.entries(o)) { if (k === 'by') byPaths.push(path + '.by'); if (k !== 'value') walk(v, path + '.' + k); }
        })(d, 'describe()');
        const pick = n => (d[n] === undefined ? 'missing' : keys(d[n]));
        return { mods: Object.fromEntries(['ambience', 'collision', 'music', 'particles', 'photo', 'rigid', 'water', 'settings', 'debugPanel'].map(n => [n, pick(n)])),
          hasDust: engine.particles.effects.has('dust'), live: d.particles?.alive.effects, sea: d.water?.sea, byPaths,
          tone: d.render?.toneMapping, exposure: d.render?.exposure, run: d.time.run, installed: [...engine.modules.keys()] };
      });
      const want = { ambience: 'on,rules', collision: 'atPlayer,boxes,cameraOcclusion,circles,fields', music: 'current,ducked,gain,intensity,override,pending,playing,ready,ruled,stems,tracks',
        particles: 'alive,effects,emitters', photo: 'album,keyBound,last,maxAlbum', rigid: 'bodies,colliders,dynamic,fixed,frozen,ready,sleeping,vehicles', water: 'bodies,sea',
        settings: 'capturing,open,tab,values', debugPanel: 'benchmarking,open' };
      for (const [n, k] of Object.entries(want)) {
        if (n === 'debugPanel' && !r.installed.includes(n)) continue;   // dev builds only
        check(`describe().${n} has its fields`, r.mods[n] === k, `${r.mods[n]} (want ${k})`);
      }
      if (r.hasDust) check('particles: a burst shows in live', r.live?.dust > 0, JSON.stringify(r.live));
      check('water: the sea reports its level and size', typeof r.sea?.level === 'number' && r.sea.size > 0, JSON.stringify(r.sea));
      check('no `by` key anywhere in describe() (who set it = writer)', r.byPaths.length === 0, r.byPaths.join(', '));
      check('render: toneMapping / exposure say writer, exposure points at its look record', typeof r.tone?.writer === 'string' && typeof r.exposure?.writer === 'string' && 'look' in r.exposure, JSON.stringify([r.tone, r.exposure]));
      check('time.run lists pause owners as owners', Array.isArray(r.run?.owners) && r.run.owners.length > 0, JSON.stringify(r.run));
    },
  },
  {
    name: "describe level + debug view 'triggers': level reports file / markers, the view draws the zones and 'off' clears them (level page)",
    url: '/tests/level/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const lv = engine.describe().level, zones = engine.triggers.list().length;
        const lines = () => engine.scene.getObjectByName('triggers-debug')?.children.length ?? 0;
        const on = engine.debug.view('triggers'), drawn = lines(), text = engine.describeText({ path: 'render' });
        engine.debug.view('off');
        return { lv, zones, on, drawn, after: lines(), text, modes: engine.debug.viewModes() };
      });
      check('describe().level: code-built scene (file null), ready, markers counted, spawn', r.lv?.file === null && r.lv.ready === true && r.lv.markers > 0 && typeof r.lv.spawn?.x === 'number', JSON.stringify(r.lv));
      check("'triggers' is a debug view mode", r.modes.includes('triggers') && r.on.mode === 'triggers', JSON.stringify(r.on));
      check('the view draws one wireframe per zone', r.zones > 0 && r.drawn === r.zones, `${r.drawn} / ${r.zones}`);
      check('describe().render says the triggers view is on', /DEBUG VIEW .*triggers/.test(r.text));
      check("view 'off' clears the wireframes", r.after === 0);
    },
  },
];

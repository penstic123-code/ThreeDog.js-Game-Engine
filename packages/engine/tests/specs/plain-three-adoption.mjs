// [guard] Plain three.js is adopted: a game written only with three.js calls (scene.add, new THREE.PointLight, its own materials,
// engine.post.add of a plain Pass, scene.fog writes, its own EffectComposer) gets what engine calls would have given it. Why a guard: the owner's
// rule is "the AI writes three.js, the engine plugs it in" (docs/plans/2026-11-03-slot-map.md). Before, scene.add left an object
// unknown to engine.thing / describe / thing.set, a three.js Pass had to be wrapped in an effect { name, create }, and a game's own composer was drawn
// over by the engine's frame every frame. If any of these regresses, the AI is pushed back to engine-only calls without being told.
// Page: perf city (sky, calendar, weather, settings); the WebGPU half runs on the post-webgpu page (both renderers, hand-made PostFX).
// Same format as the other files here.

export const specs = [
  {
    name: '[guard] plain three.js adoption: scene.add is engine.add, lights and own materials untouched, a fog write stays, engine.post.add(Pass) slots, own composer takes the frame',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.haltLoop();
        const { THREE, ShaderPass, CopyShader } = window.threedogTest, out = {}, err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        // 1. scene.add of a plain mesh with its own material is registered like engine.add (thing, describe, thing.set)
        const before = engine.describe().scene.game;
        const mat = new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.8 });
        const crate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
        const hut = new THREE.Group(); hut.add(crate);   // built off-scene, then attached: adopted when the root enters
        engine.scene.add(hut);
        const twin = engine.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
        const t = engine.thing(crate), t2 = engine.thing(twin);
        out.thing = { id: t.id, owner: t.owner, saved: t.saved, twinSaved: t2.saved, at: t.at, twinAt: t2.at, game: engine.describe().scene.game - before };
        engine.ops.run('thing.set', { id: t.id, position: [3, 0, 4] });
        out.moved = hut.position.toArray();
        // what the engine and its modules put in the scene (sky dome, lights, terrain, level) is never the game's
        out.before = before;
        out.engineKids = engine.scene.children.filter(o => o !== hut && o !== twin).map(o => engine._things.byObj.get(o)?.owner ?? '-');
        out.dome = engine.sky?.dome ? engine.thing(engine.sky.dome).owner : 'none';
        // engine.add with an id still upgrades an object the scene already adopted
        const named = new THREE.Object3D(); engine.scene.add(named); engine.add(named, { id: 'plain-named' });
        out.named = engine.thing('plain-named').object === named;
        // 2. a plain point light: adopted (thing), still a real three.js light the engine does not rewrite through weather / day-night
        const lamp = new THREE.PointLight(0xffaa66, 5, 12); lamp.position.set(2, 3, 2);
        engine.scene.add(lamp);
        const W = engine.modules.get('weather');
        W.applyState(engine, { weather: 'rain' }); engine.calendar.timeOfDay = 0.9;
        for (let i = 0; i < 5; i++) engine.step(0.05);
        out.lamp = { owner: engine.thing(lamp).owner, intensity: lamp.intensity, color: lamp.color.getHex() };
        out.mat = { color: mat.color.getHex(), roughness: mat.roughness, fog: mat.fog };
        // 3. fog: a direct scene.fog write stays
        engine.scene.fog = new __threedogThree.Fog(0x8899aa, 10, 400); engine.scene.fog.far = 77; engine.step(0.05); W.applyState(engine, { weather: 'clear' }); engine.step(0.05);
        out.fogWrite = { far: engine.scene.fog.far };
        // 4. engine.post.add(pass): a three.js Pass as it is; RenderPass / OutputPass are already the engine's; remove() leaves it alive
        const copy = new ShaderPass(CopyShader);
        let disposed = 0; const d0 = copy.dispose.bind(copy); copy.dispose = () => { disposed++; d0(); };
        const ch = engine.post.add(copy); engine.step(0.05);
        const C = engine.post.object();
        out.pass = { list: engine.post.list().filter(e => e.name.startsWith('CopyShader')).map(e => `${e.name}:${e.slot}`), inChain: C.passes.includes(copy),
          describe: JSON.stringify(engine.describe().render?.post ?? '').includes('CopyShader') };
        const RenderPass = C.passes[0].constructor, EffectComposer = C.constructor;
        const n0 = C.passes.length; engine.post.add(new RenderPass(engine.scene, engine.camera));
        out.renderPassSkipped = engine.post.object().passes.length === n0;
        ch.remove(); engine.step(0.05);
        out.removed = { gone: !engine.post.object().passes.includes(copy), alive: disposed === 0 };
        // 5. a game's own EffectComposer rendered every frame takes the frame: the engine stops drawing; deleting the call hands it back
        const own = new EffectComposer(engine.renderer); own.addPass(new RenderPass(engine.scene, engine.camera));
        let engineDraws = 0; const real = engine.post.render.bind(engine.post);
        engine.post.render = (...a) => { engineDraws++; return real(...a); };
        const h = engine.onFrame(() => own.render());
        for (let i = 0; i < 4; i++) engine.step(0.05);
        out.own = { engineDraws, yielded: engine._ownFrame.yielded };
        h.remove(); engineDraws = 0;
        for (let i = 0; i < 3; i++) engine.step(0.05);
        out.back = { engineDraws, yielded: engine._ownFrame.yielded };
        delete engine.post.render; own.dispose();
        out.badPass = err(() => engine.post.add({}));
        return out;
      });
      console.log('  plain three adoption:', JSON.stringify(r));
      check('scene.add(group) is registered like engine.add: same save tier, owner game, file:line, counted in describe().scene',
        r.thing.owner === 'game' && r.thing.saved === r.thing.twinSaved && r.thing.game === 2 && (r.thing.twinAt == null || /\.js:\d+/.test(r.thing.at ?? '')), JSON.stringify(r.thing));
      check("thing.set reaches a scene.add object's root", r.moved.join() === '3,0,4', JSON.stringify(r.moved));
      check('engine objects keep their module owner (sky dome, lights, terrain, level, batching root): the city page adds nothing of its own, so none is the game\'s',
        r.before === 0 && !r.engineKids.includes('game') && (r.dome === 'none' || r.dome === 'engine:sky'), JSON.stringify([r.before, r.dome, r.engineKids]));
      check('engine.add(obj, { id }) on an adopted object gives it the id', r.named, String(r.named));
      check('a plain PointLight is adopted and keeps its own values through rain and dusk', r.lamp.owner === 'game' && r.lamp.intensity === 5 && r.lamp.color === 0xffaa66, JSON.stringify(r.lamp));
      check('an own MeshStandardMaterial keeps its values and takes the scene fog', r.mat.color === 0x336699 && r.mat.roughness === 0.8 && r.mat.fog === true, JSON.stringify(r.mat));
      check('scene.fog.far = 77: the value stays through a weather change', r.fogWrite.far === 77, JSON.stringify(r.fogWrite));
      check('engine.post.add(ShaderPass) joins the chain in hdr, shows in list and describe', r.pass.inChain && r.pass.list.join() === 'CopyShader#1:hdr' && r.pass.describe, JSON.stringify(r.pass));
      check("engine.post.add(RenderPass of engine.scene) is skipped (the engine renders the scene)", r.renderPassSkipped, String(r.renderPassSkipped));
      check('its remove() takes it out and does not dispose it (three semantics)', r.removed.gone && r.removed.alive, JSON.stringify(r.removed));
      check("a game's own EffectComposer rendered in onFrame takes the frame: the engine stops drawing", r.own.yielded && r.own.engineDraws <= 1, JSON.stringify(r.own));
      check('deleting the own render call hands the frame back on the next frame', !r.back.yielded && r.back.engineDraws >= 2, JSON.stringify(r.back));
      check('engine.post.add of a non-pass throws with the accepted shapes', r.badPass.includes('three.js Pass') && r.badPass.includes('node function') && r.badPass.includes('[post-effect]'), r.badPass);
    },
  },
  {
    name: '[guard] plain three.js adoption, post on both renderers: engine.post.add(Pass) on WebGL, engine.post.add(node function) on WebGPU',
    url: '/tests/post-webgpu/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.postAddPass());
      console.log('  addPass both backends:', JSON.stringify(r));
      check('WebGPU: engine.post.add((input, { tsl }) => tsl.vec4(input.rgb.mul(0.25), input.a)) runs in the RenderPipeline (picture darker) and is listed', r.gpu.dark < r.gpu.base * 0.5 && r.gpu.list.join() === 'nodePass#1:hdr', JSON.stringify(r.gpu));
      check('WebGL: engine.post.add(ShaderPass) is in the composer and listed', r.gl.inChain && r.gl.list.join() === 'CopyShader#1:hdr', JSON.stringify(r.gl));
      check('WebGL: a node function names the WebGPU-only form', r.glNode.includes('only node()'), r.glNode);
    },
  },
  {
    // Why a guard: the engine used to add the cloud shadow to a game's plain materials on its own. Now a game material compiles exactly what the game wrote, and
    // one line, applyEffects(mat), gives it the term, so a crate can still darken under the same clouds as the ground.
    name: '[guard] cloud shadow on a game material: nothing is added unasked with the signal on; applyEffects(mat) darkens it on WebGL and WebGPU, sun only, one program, free when off',
    url: '/tests/engine-webgpu/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.plainClouds());
      console.log('  plain clouds:', JSON.stringify(r));
      for (const side of ['gl', 'gpu']) {
        const o = r[side];
        check(`${side}: a plain material in the scene with uCloudShadow up has no patch and does not darken`, o.leftPatches.length === 0 && Math.abs(o.leftDim) < 2, JSON.stringify([o.leftDim, o.leftPatches]));
        check(`${side}: a MeshStandardMaterial passed to applyEffects carries the clouds term and darkens when the cloud shadow deepens`, o.patches.includes('clouds') && o.plain > 10, JSON.stringify([o.plain, o.patches]));
        check(`${side}: six materials of one type share one program`, o.share.keys === 1 && (o.share.builds ?? 0) <= 2, JSON.stringify(o.share));
        // Why: going back to 0 and up again is a branch on the uniform, not a second program per material type
        check(`${side}: turning the cloud shadow on and off builds no new program`, o.newPrograms === 0, String(o.newPrograms));
        // Why: clouds used to darken all direct light, so a street lamp's pool of light flickered under the drifting noise
        check(`${side}: a PointLight lamp (sun and sky light off) is not shaded by clouds`, o.lampLit > 20 && Math.abs(o.lamp) < 2, JSON.stringify([o.lampLit, o.lamp]));
      }
      check('gpu: a NodeMaterial in the scene is left alone until the game passes it to applyEffects', r.gpu.node?.left === 0 && r.gpu.node.asked.includes('clouds'), JSON.stringify(r.gpu.node));
    },
  },
];

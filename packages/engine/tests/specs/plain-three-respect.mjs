// [guard] The engine never blocks, rewrites or silently overrides plain three.js. Each check is a place the 2026-11-03 review found where
// the engine behaved differently from the same three.js lines without it: a minimap drawn with renderer.render stopped the main picture,
// a pass added after OutputPass ran before tone mapping, renderer.setSize / setPixelRatio left the composer at the old size, scene.add /
// remove grew the thing registry forever, the engine overrode a game light's shadow.autoUpdate, and changes to three.js were missing from
// threePatches. Page: perf city (WebGL, no effect on until check 2 adds a pass, hlod installed). Same format as the other files here.

export const specs = [
  {
    name: '[guard] plain three.js adoption, respected: minimap is not an own frame, pass after OutputPass, composer follows setSize, registry released, light shadow handed back, threePatches lists every change',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.haltLoop();
        const { THREE, ShaderPass, CopyShader } = window.threedogTest, out = {}, R = engine.renderer;
        let draws = 0; const real = engine.post.render.bind(engine.post);
        engine.post.render = (...a) => { draws++; return real(...a); };
        const run = (n = 3) => { draws = 0; for (let i = 0; i < n; i++) engine.step(0.05); return { draws, yielded: engine._ownFrame.yielded }; };
        // 1. extra renders on top of the canvas (the usual minimap / HUD lines) are not "the game draws its own frame"
        const hud = new THREE.Scene(); hud.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()));
        const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10); ortho.position.z = 5;
        const size = R.getSize(new THREE.Vector2());
        const minimap = () => {
          R.autoClear = false; R.setScissorTest(true); R.setScissor(0, 0, 100, 100); R.setViewport(0, 0, 100, 100);
          R.render(hud, ortho);
          R.setScissorTest(false); R.setViewport(0, 0, size.x, size.y); R.autoClear = true;
        };
        let h = engine.onFrame(minimap); out.scissor = run(); h.remove();
        h = engine.onFrame(() => { R.autoClear = false; R.render(hud, ortho); R.autoClear = true; }); out.overlay = run(); h.remove();
        engine.use({ name: 'minimapLayer', type: 'rules', afterRender() { minimap(); } });
        out.afterRender = run();
        engine._hooks.afterRender = engine._hooks.afterRender.filter(x => x.name !== 'minimapLayer' && x.mod?.name !== 'minimapLayer');
        h = engine.onFrame(() => R.render(engine.scene, engine.camera)); out.own = run(); h.remove();
        out.back = run();
        // 2. bloom -> OutputPass -> LUT: a pass added after the game's OutputPass runs after tone mapping, before it in hdr.
        // The page draws effect-free straight to its MSAA canvas (no chain); the first pass builds the chain, and stays on through 3
        const pre = new ShaderPass(CopyShader), hp = engine.post.add(pre); engine.step(0.05);
        const OutputPass = engine.post.object().passes.find(p => p.isOutputPass).constructor, output = new OutputPass(), lut = new ShaderPass(CopyShader);
        const ho = engine.post.add(output), hl = engine.post.add(lut); engine.step(0.05);
        const passes = engine.post.object().passes, slots = () => engine.post.list().filter(e => e.name.startsWith('CopyShader')).map(e => e.slot);
        out.post = { slots: slots(), order: [passes.indexOf(pre), passes.findIndex(p => p.isOutputPass), passes.indexOf(lut)],
          slotRow: JSON.stringify(engine.describe().slots?.filter(s => s.slot === 'post').map(s => s.plugged)) };
        ho.remove(); out.postNoOutput = slots();
        hl.remove(); engine.step(0.05);
        // 3. the game's own renderer.setSize / setPixelRatio: the composer follows on the next frame
        const pr0 = R.getPixelRatio(), w0 = size.x, h0 = size.y;
        R.setPixelRatio(pr0 * 0.5); R.setSize(w0 - 20, h0 - 10, false); engine.step(0.05);
        const db = R.getDrawingBufferSize(new THREE.Vector2()), rt = engine.post.object().renderTarget1;
        out.size = { db: [db.x, db.y], rt: [rt.width, rt.height] };
        R.setPixelRatio(pr0); R.setSize(w0, h0, false); engine.autoView.manual('pixelRatio', false); hp.remove(); engine.step(0.05);
        // 4. scene.add / scene.remove of temporary objects: the registry lets them go; an id'd object and a same-line re-add keep theirs
        const T = engine._things, n0 = T.byId.size, geo = new THREE.BoxGeometry(), mat = new THREE.MeshBasicMaterial();
        for (let i = 0; i < 50; i++) { const b = new THREE.Mesh(geo, mat); engine.scene.add(b); engine.scene.remove(b); }
        const keep = new THREE.Mesh(geo, mat); engine.scene.add(keep); const id = engine.thing(keep).id;
        engine.scene.remove(keep); engine.scene.add(keep);
        const named = new THREE.Mesh(geo, mat); engine.add(named, { id: 'respect-named' }); engine.scene.remove(named);
        await Promise.resolve(); await Promise.resolve();
        out.reg = { grew: T.byId.size - n0, sameId: engine.thing(keep).id === id, named: T.byObj.has(named) };
        engine.scene.remove(keep); engine.remove(named);
        // 5. a game light's shadow.autoUpdate: idled at 0 and visible in describe; a game write while idled hands it back; opt-out per light
        const lamp = new THREE.PointLight(0xffffff, 0, 8); lamp.name = 'respectLamp'; lamp.castShadow = true; engine.scene.add(lamp);
        const opt = new THREE.PointLight(0xffffff, 0, 8); opt.castShadow = true; opt.userData.idleShadow = false; engine.scene.add(opt);
        engine.step(0.05);
        const row = () => engine.describe().render.lights.find(l => l.name === 'respectLamp');
        out.light = { idled: lamp.shadow.autoUpdate, shown: !!row()?.shadowIdled, opt: opt.shadow.autoUpdate };
        lamp.shadow.autoUpdate = true; engine.step(0.05); engine.step(0.05);
        out.light.handed = lamp.shadow.autoUpdate;
        lamp.intensity = 5; engine.step(0.05); lamp.intensity = 0; engine.step(0.05);
        out.light.staysGame = lamp.shadow.autoUpdate;
        engine.scene.remove(lamp, opt);
        // 6. every change to three.js is listed with what it reaches and what turning it off costs
        out.patches = engine.describe().threePatches;
        delete engine.post.render;
        return out;
      });
      console.log('  plain three respected:', JSON.stringify(r));
      check('a minimap drawn with scissor + small viewport in onFrame does not stop the engine frame', !r.scissor.yielded && r.scissor.draws === 3, JSON.stringify(r.scissor));
      check('an overlay drawn with autoClear = false (another scene) in onFrame does not stop the engine frame', !r.overlay.yielded && r.overlay.draws === 3, JSON.stringify(r.overlay));
      check("a minimap drawn in a module's afterRender does not stop the engine frame", !r.afterRender.yielded && r.afterRender.draws === 3, JSON.stringify(r.afterRender));
      check('renderer.render(engine.scene, engine.camera) to the whole canvas still takes the frame, and deleting it hands it back', r.own.yielded && r.own.draws <= 1 && !r.back.yielded && r.back.draws >= 2, JSON.stringify([r.own, r.back]));
      check('engine.post.add(pass) after an OutputPass runs after tone mapping (ldr), before it in hdr; chain order pre < output < lut', r.post.slots.join() === 'hdr,ldr' && r.post.order[0] < r.post.order[1] && r.post.order[1] < r.post.order[2], JSON.stringify(r.post));
      check('describe().slots names the skipped OutputPass', r.post.slotRow.includes('OutputPass'), r.post.slotRow);
      check('removing the OutputPass puts the later pass back before tone mapping', r.postNoOutput.join() === 'hdr,hdr', JSON.stringify(r.postNoOutput));
      check("renderer.setSize / setPixelRatio by the game: the composer's targets follow the drawing buffer", r.size.db.join() === r.size.rt.join(), JSON.stringify(r.size));
      check('50 scene.add / scene.remove pairs leave no registry entries (the 2 left are the re-added one still in the scene and the id one); a same-line re-add keeps its id; an object with an id stays', r.reg.grew === 2 && r.reg.sameId && r.reg.named, JSON.stringify(r.reg));
      check('a casting game light at intensity 0 is idled and describe says shadowIdled; userData.idleShadow = false opts out', r.light.idled === false && r.light.shown && r.light.opt === true, JSON.stringify(r.light));
      check('the game writing shadow.autoUpdate while idled gets the light back: the engine never switches it again', r.light.handed === true && r.light.staysGame === true, JSON.stringify(r.light));
      const ids = r.patches.map(p => p.id);
      const want = ['shadow-accessors', 'scene-add-hook', 'mesh-material-accessor', 'material-compile-accessor', 'renderer-render', 'shader-chunks', 'light-idle-shadow', 'post-shadow-hold', 'post-background-tone', 'node-twin-dress', 'node-builder-hook', 'device-lost-hook', 'webgpu-record-sweep', 'batching-draw-walk'];
      check('threePatches lists every change (class, objects, renderer) with scope and what is lost', want.every(id => ids.includes(id)) && r.patches.every(p => p.scope && p.lost),
        JSON.stringify(r.patches.map(p => [p.id, p.scope, p.offable])));
      check('the two that cannot be undone say so (offable false): shader-chunks, node-twin-dress', r.patches.filter(p => !p.offable).map(p => p.id).sort().join() === 'node-twin-dress,shader-chunks', JSON.stringify(r.patches.filter(p => !p.offable)));
    },
  },
  {
    name: '[guard] plain three.js adoption, hlod: an xxx_LOD1 node is hidden with plain visible, a game\'s write stands, remove() gives the old value back',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        const { THREE } = threedogTest, g = new THREE.BoxGeometry(), m = new THREE.MeshLambertMaterial(), root = new THREE.Group();
        const house = new THREE.Mesh(g, m); house.name = 'house'; house.position.set(600, 40, 600);
        const lod = new THREE.Group(); lod.name = 'house_LOD1'; lod.add(new THREE.Mesh(g, m)); lod.position.copy(house.position);
        root.add(house, lod); engine.add(root);
        const h = engine.hlod.add(root);
        for (let i = 0; i < 20 && !h.ready; i++) engine.step(1 / 30, { render: false });
        const hidden = lod.visible;
        lod.visible = true;   // a direct write wins while hlod holds it (hard rule 4)
        const written = lod.visible; lod.visible = false;
        h.remove();
        const out = { hidden, written, afterRemove: lod.visible, plain: !Object.getOwnPropertyDescriptor(lod, 'visible')?.get };
        engine.remove(root);
        return out;
      });
      check('LOD1 node reads hidden while registered, a direct write stands, and remove() gives back what it had', r.hidden === false && r.written === true && r.afterRemove === true && r.plain, JSON.stringify(r));
    },
  },
];

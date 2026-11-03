// 每个外观值只有一个接管入口、着色代码只走槽位（W5 / W6，2026-11-02）：每条删掉的旧路一条"不许绕开"的检查。
// 为什么要守：旧写法（sky({ sun: 'manual' })、style.*.glsl、改全页 ShaderChunk.fog_*、userData 记阴影、替换相机方法）删了之后，
// 有人顺手加回来不会有别的测试变红；这里每条都直接试那条旧路，必须报错或者看得见。
// Same format as the other files here.
const HELPERS = `
  const { THREE, createEngine, sky } = threedogTest;
  const make = (style, opts = {}) => {
    const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'one-entry', style });
    try { e.use(sky(opts)); } catch (err) { e.dispose(); return { error: err.message }; }
    return { e };
  };
  const err = f => { try { f(); return ''; } catch (x) { return x.message; } };
  // 一个场景：地面 + 400 米外的方块，用给定的材质（引擎场景里打过补丁的那几个），自己的 renderer 读像素
  const shot = (fog, mats, camY = 3) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const R = new THREE.WebGLRenderer({ canvas }), rt = new THREE.WebGLRenderTarget(32, 32), bytes = new Uint8Array(32 * 32 * 4);
    const sc = new THREE.Scene(); sc.fog = fog; sc.background = new THREE.Color(0x000000);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
    const g = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), mats[0]);
    const box = new THREE.Mesh(new THREE.BoxGeometry(80, 160, 80), mats[1]); box.position.set(0, 80, -400);
    sc.add(g, box);
    const cam = new THREE.PerspectiveCamera(60, 1, 0.3, 1500); cam.position.set(0, camY, 0); cam.lookAt(0, camY * 0.6, -100);
    let e = ''; R.debug.onShaderError = (gl, p, vs, fs) => { e += (gl.getProgramInfoLog(p) || '') + (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || ''); };
    R.setRenderTarget(rt); R.render(sc, cam); R.readRenderTargetPixels(rt, 0, 0, 32, 32, bytes); R.setRenderTarget(null);
    sc.remove(g, box); rt.dispose(); R.dispose(); R.forceContextLoss();
    return { px: Array.from(bytes).join(','), err: e.slice(0, 400) };
  };
  // 把材质放进引擎的场景，跑一帧天空：fog 补丁就是这一步打上的（fog.js fogMaterials）
  const inScene = (e, mats) => { const grp = new THREE.Group(); for (const m of mats) grp.add(new THREE.Mesh(new THREE.BoxGeometry(), m)); e.scene.add(grp); e.sky.update(e.focus); return mats; };
`;
const page = fn => new Function(`${HELPERS}\nreturn (${fn})();`);
const URL = '/tests/perf/index.html?mode=world';

export const specs = [
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: "[guard] one takeover entry: sky({ sun | hemisphere | fog: 'manual' }) throws naming look.<part>.manual; scene.fog = yours yields the owned record (no second flag)",
    url: URL,
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        out.sun = make({}, { sun: 'manual' }).error; out.hemi = make({}, { hemisphere: 'manual' }).error; out.fog = make({}, { fog: 'manual' }).error;
        const e = make({}).e; e.sky.update(e.focus);
        const was = e.scene.fog, own = new THREE.Fog(0x112233, 3, 30); e.scene.fog = own; e.sky.update(e.focus);
        out.replaced = [e.scene.fog === own, own.far, e.describe().owned?.fog?.writer, '_fogHeld' in e.sky];
        e.scene.fog = was; e.look.fog.manual(false); e.sky.update(e.focus);
        out.back = [e.scene.fog !== own, e.describe().owned?.fog?.writer];
        e.dispose();
        return out;
      }));
      check("sky({ sun: 'manual' }) throws and names look.lights.manual", /not an option.*look\.lights\.manual/.test(r.sun || ''), r.sun);
      check("sky({ hemisphere: 'manual' }) throws and names look.lights.manual('hemi')", /look\.lights\.manual\('hemi'\)/.test(r.hemi || ''), r.hemi);
      check("sky({ fog: 'manual' }) throws and names look.fog.manual()", /look\.fog\.manual\(\)/.test(r.fog || ''), r.fog);
      check('scene.fog = a fog of yours: the owned fog record yields (writer three), the sky does not write it, no sky._fogHeld', r.replaced[0] && r.replaced[1] === 30 && /three/.test(r.replaced[2] ?? '') && !r.replaced[3], JSON.stringify(r.replaced));
      check('look.fog.manual(false) hands the record back to the engine', r.back[0] && r.back[1] === 'engine', JSON.stringify(r.back));
    },
  },
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: '[guard] fog only through the slot patch: THREE.ShaderChunk.fog_* never changes; exp / height fog reaches a plain MeshStandardMaterial and an engine-patched one; two engines with different fog on one page',
    url: URL,
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {}, C = THREE.ShaderChunk, NAMES = ['fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment'];
        const snap = () => NAMES.map(n => C[n]).join('|'), orig = snap();
        const plainPair = () => [new THREE.MeshStandardMaterial({ color: 0x336633 }), new THREE.MeshStandardMaterial({ color: 0x993333 })];
        // reference picture: three's own exp2 with the same fog object (what an unpatched material would draw)
        const a = make({ sky: { fog: { kind: 'height', height: 0, falloff: 0.08, density: 0.03 } } }).e;
        const b = make({ sky: { fog: { kind: 'exp' } } }).e;   // a different custom fog on the same page: used to throw
        out.chunks = snap() === orig;
        const pa = inScene(a, plainPair()), pb = inScene(b, plainPair());
        const raw = plainPair();
        const ra = shot(a.scene.fog, pa), rraw = shot(a.scene.fog, raw), rb = shot(b.scene.fog, pb), rbraw = shot(b.scene.fog, plainPair());
        out.a = { err: ra.err, differs: ra.px !== rraw.px }; out.b = { err: rb.err, differs: rb.px !== rbraw.px, notA: rb.px !== ra.px };
        out.height = shot(a.scene.fog, pa, 40).px !== ra.px;
        // an engine-patched material (makeMaterial: lighting / effects patches already on it) gets the fog patch on top
        const em = a.makeMaterial('default'); inScene(a, [em]);
        const re = shot(a.scene.fog, [em, em]), rer = shot(a.scene.fog, [new THREE.MeshLambertMaterial(), new THREE.MeshLambertMaterial()]);
        out.engineMat = { err: re.err, ok: re.px !== rer.px };
        out.ownedRow = Object.keys(a.describe().owned?.['fog.patch'] ?? {}).length > 0;
        out.chunksAfter = snap() === orig;
        b.dispose(); out.aAfterB = shot(a.scene.fog, pa).px === ra.px;
        a.dispose(); out.chunksEnd = snap() === orig;
        out.styleGlsl = make({ sky: { fog: { glsl: 'vec4 threedogFog(vec3 c, float d, vec3 p){ return vec4(c, 0.5); }' } } }).error;
        return out;
      }));
      check('THREE.ShaderChunk.fog_* is never rewritten (two custom-fog engines, before and after dispose)', r.chunks && r.chunksAfter && r.chunksEnd);
      check("kind 'height' on a plain MeshStandardMaterial in the scene: compiles and draws differently from three's exp2", r.a.err === '' && r.a.differs, JSON.stringify(r.a));
      check("second engine with kind 'exp' on the same page: compiles, differs from three's exp2 and from engine A", r.b.err === '' && r.b.differs && r.b.notA, JSON.stringify(r.b));
      check('height fog changes with camera height', r.height);
      check('an engine-made material (already patched) gets the fog too', r.engineMat.err === '' && r.engineMat.ok, JSON.stringify(r.engineMat));
      check("describe().owned['fog.patch'] lists the game materials it patched", r.ownedRow);
      check('disposing engine B leaves engine A\'s fog as it was', r.aAfterB);
      check('style.sky.fog.glsl is an unknown option (the hook is look.fog.patch)', /glsl/.test(r.styleGlsl || ''), r.styleGlsl);
    },
  },
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: '[guard] glsl only through look.<part>.patch: style.sky.clouds.glsl, style.water.glsl, water({ glsl }), style.wind.glsl throw naming the hook',
    url: URL,
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const { water } = threedogTest;
        const out = {};
        out.clouds = make({ sky: { clouds: { glsl: 'vec4 threedogClouds(vec3 d, float t, vec3 s, float n, vec3 l, vec3 sh, float c){ return vec4(l, 0.5); }' } } }).error;
        const mk = (style, opts) => { const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'one-entry', style }); try { e.use(water(opts)); return ''; } catch (x) { return x.message; } finally { e.dispose(); } };
        out.waterStyle = mk({ water: { glsl: { wave: 'float threedogWaterWave(vec3 p, float t){ return 0.0; }' } } }, {});
        out.waterOpt = mk({}, { glsl: { wave: 'float threedogWaterWave(vec3 p, float t){ return 0.0; }' } });
        return out;
      }));
      check("style.sky.clouds.glsl throws naming look.sky.patch('clouds')", /look\.sky\.patch\('clouds'/.test(r.clouds || ''), r.clouds);
      check("style.water.glsl throws naming look.water.patch", /look\.water\.patch/.test(r.waterStyle || ''), r.waterStyle);
      check('water({ glsl }) is an unknown option', /glsl/.test(r.waterOpt || ''), r.waterOpt);
    },
  },
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: '[guard] shadow settings off/on is the renderer switch only: plain three castShadow stays the game\'s (a game write in between wins); tone mapping writer is an owned record; ortho camera is reported',
    url: URL,
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        const { THREE } = threedogTest, out = {};
        const a = new THREE.PointLight(0xffffff, 1, 10), b = new THREE.SpotLight(0xffffff, 1);
        a.castShadow = true; b.castShadow = false; engine.scene.add(a, b);
        const hs = engine.look.shadow.set({ enabled: false }, { owner: 'oneEntry' });
        out.off = [a.castShadow, b.castShadow, engine.renderer.shadowMap.enabled, engine.describe().owned?.['shadows.off'] ?? null];
        hs.remove();
        out.on = [a.castShadow, b.castShadow, engine.renderer.shadowMap.enabled];
        // the player turns shadows off in the settings, the game changes its mind meanwhile, the player turns them on again: the game's value stands
        const menu = engine.stacks.get('look.shadow.enabled'); menu.take({ owner: 'settings', layer: 'settings', set: false });   // what the settings row does
        a.castShadow = false; b.castShadow = true;
        out.menuOff = [engine.renderer.shadowMap.enabled, a.castShadow, b.castShadow];
        menu.release('settings');
        out.menuOn = [engine.renderer.shadowMap.enabled, a.castShadow, b.castShadow];
        engine.scene.remove(a, b);
        // tone mapping: one owned record; a direct write yields it quietly and describe says 'game'
        const r0 = engine.describe().owned?.toneMapping?.writer, before = engine.renderer.toneMapping;
        engine.renderer.toneMapping = THREE.NeutralToneMapping;
        out.tone = [r0, engine.describe().render.toneMapping.writer, engine.describe().owned?.toneMapping?.writer, '_renderBase' in engine && !('tone' in engine._renderBase)];
        engine.renderer.toneMapping = before;
        // camera: the class carries the ortho behavior (no method patched on the instance), and describe says which projection
        const cam = engine.camera;
        cam.orthoSize = 30; cam.isOrthographicCamera = true; cam.isPerspectiveCamera = false; cam.updateProjectionMatrix();
        out.cam = [Object.hasOwn(cam, 'updateProjectionMatrix'), cam.isEngineCamera, engine.describe().camera.projection, engine.describe().camera.orthoSize, cam.top];
        cam.orthoSize = 0; cam.isOrthographicCamera = false; cam.isPerspectiveCamera = true; cam.updateProjectionMatrix();
        out.camBack = engine.describe().camera.projection;
        return out;
      });
      check('look.shadow enabled false: the renderer switch is off and no light is written (castShadow as the game set it, no owned record)', r.off[0] === true && r.off[1] === false && r.off[2] === false && r.off[3] === null, JSON.stringify(r.off));
      check('enabled back on: renderer switch on, lights unchanged', r.on[0] === true && r.on[1] === false && r.on[2] === true, JSON.stringify(r.on));
      check('settings off, game sets castShadow in between, settings on: final castShadow is what the game set', r.menuOff[0] === false && r.menuOff[1] === false && r.menuOff[2] === true && r.menuOn[0] === true && r.menuOn[1] === false && r.menuOn[2] === true, JSON.stringify([r.menuOff, r.menuOn]));
      check("toneMapping: owned record 'engine' at start; a direct write -> render.toneMapping.writer 'game', owned writer 'three (engine yielded)'; no remembered creation value", r.tone[0] === 'engine' && r.tone[1] === 'game' && r.tone[2] === 'three (engine yielded)' && r.tone[3], JSON.stringify(r.tone));
      check('ortho camera: EngineCamera class method (not an instance patch), describe().camera.projection orthographic + orthoSize', !r.cam[0] && r.cam[1] === true && r.cam[2] === 'orthographic' && r.cam[3] === 30 && Math.abs(r.cam[4] - 15) < 1e-9 && r.camBack === 'perspective', JSON.stringify(r.cam));
    },
  },
];

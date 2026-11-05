// 每个外观值只有一个接管入口、着色代码只走槽位（W5 / W6，2026-11-02）：每条删掉的旧路一条"不许绕开"的检查。
// 为什么要守：旧写法（sky({ sun: 'manual' })、clouds 选项里的 glsl、userData 记阴影、替换相机方法）删了之后，
// 有人顺手加回来不会有别的测试变红；这里每条都直接试那条旧路，必须报错或者看得见。
// Same format as the other files here.
const HELPERS = `
  const { THREE, createEngine, sky } = threedogTest;
  const bare = () => createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'one-entry' });
  const make = (opts = {}) => {
    const e = bare();
    try { e.use(sky(opts)); } catch (err) { e.dispose(); return { error: err.message }; }
    return { e };
  };
`;
const page = fn => new Function(`${HELPERS}\nreturn (${fn})();`);
const URL = '/tests/perf/index.html?mode=world';

export const specs = [
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: "[guard] glsl only through one entry: sky({ clouds: { glsl } }) throws naming engine.sky.clouds()",
    url: URL,
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        out.clouds = make({ clouds: { glsl: 'vec4 threedogClouds(vec3 d, float t, vec3 s, float n, vec3 l, vec3 sh, float c){ return vec4(l, 0.5); }' } }).error;
        return out;
      }));
      check('sky({ clouds: { glsl } }) throws naming engine.sky.clouds()', /sky\.clouds\(/.test(r.clouds || ''), r.clouds);
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
        const hs = engine.mod('shadows.enabled', { owner: 'oneEntry', set: false });
        out.off = [a.castShadow, b.castShadow, engine.renderer.shadowMap.enabled, engine.describe().owned?.['shadows.off'] ?? null];
        hs.remove();
        out.on = [a.castShadow, b.castShadow, engine.renderer.shadowMap.enabled];
        // the player turns shadows off in the settings, the game changes its mind meanwhile, the player turns them on again: the game's value stands
        const menu = engine.stacks.get('shadows.enabled'); menu.take({ owner: 'settings', layer: 'settings', set: false });   // what the settings row does
        a.castShadow = false; b.castShadow = true;
        out.menuOff = [engine.renderer.shadowMap.enabled, a.castShadow, b.castShadow];
        menu.release('settings');
        out.menuOn = [engine.renderer.shadowMap.enabled, a.castShadow, b.castShadow];
        engine.scene.remove(a, b);
        // tone mapping: one owned record; a direct write yields it quietly and describe says 'game'
        const B = threedogTest.createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'one-entry-tone' });   // this page writes its own curve
        const r0 = B.describe().owned?.toneMapping?.writer;
        B.renderer.toneMapping = THREE.NeutralToneMapping;
        out.tone = [r0, B.describe().render.toneMapping.writer, B.describe().owned?.toneMapping?.writer, '_renderBase' in B && !('tone' in B._renderBase)];
        B.dispose();
        // camera: the class carries the ortho behavior (no method patched on the instance), and describe says which projection
        const cam = engine.camera;
        cam.orthoSize = 30; cam.isOrthographicCamera = true; cam.isPerspectiveCamera = false; cam.updateProjectionMatrix();
        out.cam = [Object.hasOwn(cam, 'updateProjectionMatrix'), cam.isEngineCamera, engine.describe().camera.projection, engine.describe().camera.orthoSize, cam.top];
        cam.orthoSize = 0; cam.isOrthographicCamera = false; cam.isPerspectiveCamera = true; cam.updateProjectionMatrix();
        out.camBack = engine.describe().camera.projection;
        return out;
      });
      check('shadows.enabled false: the renderer switch is off and no light is written (castShadow as the game set it, no owned record)', r.off[0] === true && r.off[1] === false && r.off[2] === false && r.off[3] === null, JSON.stringify(r.off));
      check('enabled back on: renderer switch on, lights unchanged', r.on[0] === true && r.on[1] === false && r.on[2] === true, JSON.stringify(r.on));
      check('settings off, game sets castShadow in between, settings on: final castShadow is what the game set', r.menuOff[0] === false && r.menuOff[1] === false && r.menuOff[2] === true && r.menuOn[0] === true && r.menuOn[1] === false && r.menuOn[2] === true, JSON.stringify([r.menuOff, r.menuOn]));
      check("toneMapping: owned record 'engine' at start; a direct write -> render.toneMapping.writer 'game', owned writer 'three (engine yielded)'; no remembered creation value", r.tone[0] === 'engine' && r.tone[1] === 'game' && r.tone[2] === 'three (engine yielded)' && r.tone[3], JSON.stringify(r.tone));
      check('ortho camera: EngineCamera class method (not an instance patch), describe().camera.projection orthographic + orthoSize', !r.cam[0] && r.cam[1] === true && r.cam[2] === 'orthographic' && r.cam[3] === 30 && Math.abs(r.cam[4] - 15) < 1e-9 && r.camBack === 'perspective', JSON.stringify(r.cam));
    },
  },
];

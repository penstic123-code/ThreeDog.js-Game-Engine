// [guard] picture check facts about hand-written materials and light layout (packages/tools/picture/check.mjs): real renders through the same page probe as
// threedog shot, so a fact only appears when the pixels show it. A shader that does take fog and tone, and a pair that does not depend on order, must stay silent.
import { probeSource, pictureHints, pictureNumbers } from '@threedog/tools/picture-check';

const PAGE = '/tests/threads/';
const VERT = 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const VERT_FOG = '#include <fog_pars_vertex>\nvoid main() { vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}';
const PLAIN = 'void main() { gl_FragColor = vec4(0.4, 0.5, 0.6, 1.0); }';
const FULL = '#include <common>\n#include <fog_pars_fragment>\nvoid main() { gl_FragColor = vec4(0.4, 0.5, 0.6, 1.0);\n#include <tonemapping_fragment>\n#include <fog_fragment>\n}';
const OWN_FOG = 'uniform float uMyFog; void main() { gl_FragColor = vec4(vec3(0.4) * uMyFog, 1.0); }';

/** Run the probe on a fresh engine with fog and a curve on; scene(T, E) places the objects */
async function probe(ev, src, build) {
  return ev(async ([src, build]) => {
    window.__probePicture = (0, eval)('(' + src + ')');
    const { mk } = threedogThreads, A = threedogThreads.all;
    const E = mk(A.createEngine, 'picture-own-draws'), T = __threedogThree;
    E.renderer.toneMapping = T.ACESFilmicToneMapping;
    E.scene.fog = new T.Fog(0x808080, 100, 300);
    E.scene.background = new T.Color(0x202020);
    E.camera.position.set(0, 0, 8); E.camera.lookAt(0, 0, 0); E.camera.updateMatrixWorld();
    await E.start(); E.haltLoop();
    (0, eval)('(' + build + ')')(T, E);
    E.step(1 / 30);
    const before = { far: E.scene.fog.far, exposure: E.renderer.toneMappingExposure };
    const p = await window.__probePicture(E, { time: false });
    const after = { far: E.scene.fog.far, exposure: E.renderer.toneMappingExposure, probing: E._probing };
    delete p.pixels; E.dispose();
    return { p, before, after };
  }, [src, build]);
}
const hintsOf = p => pictureHints({ numbers: pictureNumbers(new Uint8Array(64), 4), probe: p });
const ids = hs => hs.map(h => h.id);

export const specs = [
  {
    // this bundle is built like a release (one minified file): the tracker must not be in it, and every answer must say so instead of naming assets/x.js:1
    name: '[guard] picture writers in a bundle: not tracked, and no accessor on three.js objects',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, A = threedogThreads.all, E = mk(A.createEngine, 'picture-bundle');
        await E.start();
        const out = { w: E.describe('picture').picture.writers, x: E.explain({ picture: 'fog.far' }), d: Object.getOwnPropertyDescriptor(E.renderer, 'toneMappingExposure'), p: A.threePatches?.list().map(p => p.id) };
        E.dispose();
        return { w: out.w, x: out.x, plain: 'value' in out.d, p: out.p };
      });
      check('[guard] describe and explain say not tracked, naming the dev server', r.w.tracked === false && /not tracked/.test(r.w.note) && /dev server/.test(r.x.text) && r.x.ok === false, JSON.stringify([r.w, r.x]));
      check('[guard] renderer.toneMappingExposure stays a plain value and no change is listed', r.plain && !(r.p ?? []).includes('picture-writers'), JSON.stringify(r.p));
    },
  },
  {
    name: '[guard] picture facts: a ShaderMaterial without fog or tone is named from pixels, one with them is not',
    url: PAGE, software: true,
    async run({ check, ev }) {
      const src = probeSource;
      const build = code => `(T, E) => { const m = new T.ShaderMaterial(${code}); m.name = 'mine'; E.scene.add(new T.Mesh(new T.BoxGeometry(3, 3, 3), m)); }`;
      const plain = await probe(ev, src, build(`{ vertexShader: ${JSON.stringify(VERT)}, fragmentShader: ${JSON.stringify(PLAIN)} }`));
      const h = hintsOf(plain.p), fog = h.find(x => x.id === 'shader-no-fog'), tone = h.find(x => x.id === 'shader-no-tone');
      check('[guard] ignores fog: measured, named, the count of pixels in the text', /'mine' ignores the fog/.test(fog?.text ?? '') && /moved 0 of its \d+ pixels/.test(fog.text), JSON.stringify([plain.p.shaders, ids(h)]));
      check('[guard] ignores tone: measured, named', /'mine' ignores the tone curve/.test(tone?.text ?? '') && /moved \d+ of its \d+ pixels/.test(tone.text), JSON.stringify(plain.p.shaders));
      check('values are put back, and the probe flag is down', plain.after.far === plain.before.far && plain.after.exposure === plain.before.exposure && plain.after.probing === false, JSON.stringify([plain.before, plain.after]));
      const full = await probe(ev, src, build(`{ fog: true, uniforms: T.UniformsUtils.merge([T.UniformsLib.fog]), vertexShader: ${JSON.stringify(VERT_FOG)}, fragmentShader: ${JSON.stringify(FULL)} }`));
      const hf = hintsOf(full.p);
      check('[guard] a shader with the fog and tone chunks: no fact', full.p.shaders?.rows[0]?.fog?.answer === 'follows' && full.p.shaders.rows[0].tone?.answer === 'follows' && !ids(hf).some(x => x.startsWith('shader-')), JSON.stringify([full.p.shaders, ids(hf)]));
      const own = await probe(ev, src, build(`{ uniforms: { uMyFog: { value: 1 } }, vertexShader: ${JSON.stringify(VERT)}, fragmentShader: ${JSON.stringify(OWN_FOG)} }`));
      check('[guard] its own fog through a uniform the probe cannot feed: not sure, never "ignores"', ids(hintsOf(own.p)).includes('shader-fog-unsure') && !ids(hintsOf(own.p)).includes('shader-no-fog') && /not sure/.test(hintsOf(own.p).find(x => x.id === 'shader-fog-unsure').text), JSON.stringify(own.p.shaders));
      const sky = await probe(ev, src, `(T, E) => { const m = new T.ShaderMaterial({ vertexShader: ${JSON.stringify(VERT)}, fragmentShader: ${JSON.stringify(PLAIN)}, side: T.BackSide }); E.scene.add(new T.Mesh(new T.SphereGeometry(80), m)); }`);
      check('a mesh around the camera is a sky and is left out', !sky.p.shaders, JSON.stringify(sky.p.shaders));
    },
  },
  {
    name: '[guard] picture facts: transparent pair by swapped pixels, light layout from the light watch',
    url: PAGE, software: true,
    async run({ check, ev }) {
      const src = probeSource;
      const pair = blend => `(T, E) => { const mk = (c, x, n) => { const m = new T.Mesh(new T.PlaneGeometry(4, 4), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, depthWrite: false, blending: ${blend}, fog: false })); m.name = n; m.position.x = x; E.scene.add(m); }; mk(0xff0000, -0.5, 'red'); mk(0x00ff00, 0.5, 'green'); }`;
      const normal = await probe(ev, src, pair('T.NormalBlending'));
      const t = hintsOf(normal.p).find(x => x.id === 'transparent-order');
      check('[guard] two overlapping transparent meshes, one renderOrder: pixels moved with the swap, both named', /'red'|'green'/.test(t?.text ?? '') && /swapping their draw order moved \d+ pixels/.test(t.text), JSON.stringify(normal.p.transparent));
      const add = await probe(ev, src, pair('T.AdditiveBlending'));
      check('[guard] additive pairs overlap too, but order changes no pixel: no fact', add.p.transparent?.pairs === 1 && add.p.transparent.swapped.length === 0 && !ids(hintsOf(add.p)).includes('transparent-order'), JSON.stringify(add.p.transparent));
      const lights = await ev(async src => {
        window.__probePicture = (0, eval)('(' + src + ')');
        const { mk } = threedogThreads, A = threedogThreads.all, E = mk(A.createEngine, 'picture-own-lights'), T = __threedogThree;
        E.scene.add(new T.Mesh(new T.BoxGeometry(2, 2, 2), new T.MeshStandardMaterial()));
        E.camera.position.set(0, 0, 8); E.camera.lookAt(0, 0, 0);
        await E.start(); E.haltLoop(); E.step(1 / 30); E.step(1 / 30);
        const quiet = await window.__probePicture(E, { time: false }); delete quiet.pixels;
        E.scene.add(new T.PointLight(0xffffff, 5)); E.step(1 / 30); E.step(1 / 30);
        const changed = await window.__probePicture(E, { time: false }); delete changed.pixels;
        E.dispose();
        return { quiet: quiet.lightLayout, changed: changed.lightLayout };
      }, src);
      check('[guard] no light added: no change reported', lights.quiet?.changes.length === 0, JSON.stringify(lights.quiet));
      const h = hintsOf({ lightLayout: lights.changed }).find(x => x.id === 'light-layout');
      check('[guard] a light added in play: the change and the program count, measured', lights.changed?.changes.length === 1 && /light layout changed during play/.test(h?.text ?? '') && /point 0.* -> .*point 1/.test(h.text) && lights.changed.changes[0].programs > 0, JSON.stringify(lights.changed));
      const u = hintsOf({ lightLayout: { changes: [], last: 'point 0', now: 'point 1' } }).find(x => x.id === 'light-layout-unsure');
      check('layout differs with no compile seen: says not sure', /not sure/.test(u?.text ?? ''), u?.text);
    },
  },
];

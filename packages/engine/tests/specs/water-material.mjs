// The water's picture is plain three.js on the module (modules/water/Water.js): .material swaps it as given, .uniforms are live, .patches keep the behavior on a game
// material, shader() and normalMap() are the two methods for what is built, not tuned. The pixels of the shader code: appearance-water.mjs.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAKE = `
  const { THREE, createEngine, water, applyEffects, materialPatches } = threedogTest;
  const make = mods => { const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'water-material' }); e.use(...mods); return e; };
  const err = f => { try { f(); return ''; } catch (x) { return x.message; } };
`;
const page = fn => new Function(`${MAKE}\nreturn (${fn})();`);
const WATER = fileURLToPath(new URL('../../modules/water/', import.meta.url));

export const specs = [
  {
    name: '[guard] water picture: swappable through .material as given on every mesh; nothing in the module reaches engine.look / engine.style / makeMaterial',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const src = readdirSync(WATER).map(f => readFileSync(WATER + f, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')).join('\n');
      check('the module source names no picture entry', !/\b(engine|e)\.(look|style)\b|\bmakeMaterial\b|\bdefineLookPart\b/.test(src));
      const r = await ev(page(() => {
        const e = make([water({ level: 1, size: 40, segments: 8 })]), W = e.water, out = {};
        e.addWaterBody({ position: [50, 0, 0], radius: 5, level: 3 });
        W.update(e.focus, 0);   // builds the sea mesh
        const meshes = () => [W.sea, ...W.bodies.values()], own = W.material;
        out.neutral = [own.type, own.color.getHex(), own.opacity, own.transparent, own.flatShading, materialPatches(own).join()];
        const m = new THREE.MeshPhongMaterial({ color: 0x3070a0 });
        W.material = m;
        out.swapped = W.material === m && meshes().every(x => x.material === m);
        e.addWaterBody({ position: [80, 0, 0], radius: 5, level: 3 });
        out.later = meshes().every(x => x.material === m);
        e.uniforms.uCloudShadow.value = 0.5; e.step(0.1);   // cloud shadow on: plain lit materials get the term, this one was given to the engine as it is
        out.given = materialPatches(m).join();
        W.material = own;
        out.back = meshes().every(x => x.material === own);
        out.bad = err(() => { W.material = 42; });
        e.dispose();
        return out;
      }));
      check('default: the neutral Lambert with waves and fresnel, today\'s values', r.neutral.join() === `MeshLambertMaterial,${0x888888},0.85,true,true,waves,fresnel`, JSON.stringify(r.neutral));
      check('set swaps every mesh, and meshes added later draw it', r.swapped && r.later, JSON.stringify(r));
      check('a set material gets no patch, not even the plain-material cloud shadow', r.given === '', r.given);
      check('the engine\'s material can be set back; a non-material throws the form', r.back && /takes a three.js Material/.test(r.bad), r.bad);
    },
  },
  {
    name: 'water: uniforms are live, patches keep the waves on a game material, even a MeshBasicMaterial',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const e = make([water({ sea: false })]), W = e.water, out = {};
        out.names = ['uTime', 'uWave', 'uWaveScale', 'uWaveSpeed', 'uFresnel'].every(k => 'value' in W.uniforms[k]);
        out.shared = W.patches.find(p => p.name === 'waves').uniforms.uWave === W.uniforms.uWave && W.patches.find(p => p.name === 'fresnel').uniforms.uFresnel === W.uniforms.uFresnel;
        const phong = applyEffects(new THREE.MeshPhongMaterial({ shininess: 90 }), { clouds: false, patches: W.patches });
        out.phong = materialPatches(phong).join();
        const basic = new THREE.MeshBasicMaterial(), R = engine.renderer, prev = R.debug.onShaderError;
        out.basic = err(() => applyEffects(basic, { clouds: false, patches: W.patches }));
        let bad = ''; R.debug.onShaderError = gl => { bad += 'compile failed ' + gl; };
        const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(); sc.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), basic));
        const rt = new THREE.WebGLRenderTarget(4, 4); R.setRenderTarget(rt); R.render(sc, cam); R.setRenderTarget(null); rt.dispose(); R.debug.onShaderError = prev;
        out.basic += bad;
        e.dispose();
        return out;
      }));
      check('uniforms are { value } objects and the same ones the patches read', r.names && r.shared, JSON.stringify(r));
      check('applyEffects(game material, { patches }) carries waves and fresnel', r.phong === 'waves,fresnel', r.phong);
      check('one list fits a MeshBasicMaterial too, and it compiles', r.basic === '', r.basic);
    },
  },
  {
    name: 'water.shader: refreshes patches and the engine material, keeps what the game wrote, leaves a game material alone; wrong values throw with nothing changed',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const e = make([water({ sea: false })]), W = e.water, out = {};
        e.addWaterBody({ position: [0, 0, 0], radius: 30, level: 1 });
        const mesh = () => W.bodies.values().next().value, uWave = W.uniforms.uWave, m0 = W.material;
        W.material.color.set(0x3070a0); W.material.opacity = 0.5;
        W.shader({ foam: { start: 0.2 }, depthColor: { shallow: 0x55ddcc, deep: 0x082040 } });
        const m1 = W.material;
        out.built = [m1 === m0, mesh().material === m1, materialPatches(m1).join(), W.patches.map(p => p.name).join(), m1.color.getHex() === 0x3070a0, m1.opacity];
        out.tune = [W.uniforms.uWave === uWave, W.uniforms.uFoamStart.value];
        W.shader({ uniforms: { uK: 2 } });
        out.merged = [W.uniforms.uK.value, W.uniforms.uFoamStart.value];
        W.shader({ foam: null, depthColor: null });
        out.cleared = materialPatches(W.material).join();
        const game = new THREE.MeshPhongMaterial(), before = W.patches;
        W.material = game;
        W.shader({ foam: true });
        out.game = [W.material === game, materialPatches(game).join(), W.patches !== before, W.patches.map(p => p.name).join()];
        W.material = m1;
        const keep = W.patches;
        out.bad = [err(() => W.shader({ wave: 'float nope() { return 1.0; }' })), err(() => W.shader({ depthColor: { by: 'sideways' } })), err(() => W.shader({ glsl: 'x' }))];
        out.keep = W.patches === keep;
        e.dispose();
        return out;
      }));
      check('shader() patches the engine material again in place: same material on the meshes, color and opacity kept', r.built.join() === 'true,true,waves,waterSurface,fresnel,waves,waterSurface,fresnel,true,0.5', JSON.stringify(r.built));
      check('uWave stays the same object, the new values are in uniforms', r.tune.join() === 'true,0.2', JSON.stringify(r.tune));
      check('keys left out stay; null takes a part out of the program', r.merged.join() === '2,0.2' && r.cleared === 'waves,fresnel', JSON.stringify([r.merged, r.cleared]));
      check('a game material is left alone, patches still refresh', r.game.join() === 'true,,true,waves,waterSurface,fresnel', JSON.stringify(r.game));
      check('wrong wave / by / key throw with the fix, nothing changed', r.bad[0].includes('threedogWaterWave') && r.bad[1].includes('sideways') && r.bad[2].includes('glsl') && r.keep, JSON.stringify(r.bad));
    },
  },
  {
    name: 'water.normalMap: on the engine material, tiles the meshes, scrolls for any material; null takes it off; moved water() options name the new entry',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const e = make([water({ sea: false })]), W = e.water, out = {};
        e.addWaterBody({ position: [0, 0, 0], radius: 30, level: 1 });
        const uv = () => W.bodies.values().next().value.geometry.attributes.uv.getX(0), uv0 = uv();
        const t = W.normalMap('water-n', { scale: 0.8, repeat: 0.1, speed: [1, 0] }), uv1 = uv();
        out.on = [t === W.normalTexture, W.material.normalMap === t, W.material.normalScale.x, uv0 !== uv1];
        W.normalMap('water-n', { repeat: 0.2 });
        out.retile = [W.normalTexture === t, Math.abs(uv() / uv1 - 2) < 1e-5, W.material.normalScale.x];
        const game = new THREE.MeshPhongMaterial({ normalMap: t }); W.material = game;
        const x0 = t.offset.x; W.update(e.focus, 0.5);
        out.scroll = t.offset.x - x0;
        W.material = W._own;
        W.normalMap(null);
        out.off = [W.normalTexture, W.material.normalMap];
        out.bad = [err(() => W.normalMap(5)), err(() => W.normalMap('n', { sclae: 1 }))];
        e.dispose();
        out.kept = err(() => water({ sea: false, level: 1, flat: true, size: 50, segments: 8 }));
        return out;
      }));
      check('normalMap: the texture goes on the engine material with its strength, and the UVs tile', r.on.join() === 'true,true,0.8,true', JSON.stringify(r.on));
      check('same name again keeps the texture; repeat tiles once more; scale stays', r.retile.join() === 'true,true,0.8', JSON.stringify(r.retile));
      check('the scroll runs under a game material', r.scroll === 0.5, String(r.scroll));
      check('null takes it off; wrong name / key throw', r.off[0] === null && r.off[1] === null && /asset name/.test(r.bad[0]) && /sclae/.test(r.bad[1]), JSON.stringify([r.off, r.bad]));
      check('structural options stay', r.kept === '', r.kept);
    },
  },
];

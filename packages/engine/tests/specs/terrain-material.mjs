// The ground's picture is plain three.js on the module: terrain({ colors, detail, material ... }) at the start, engine.terrain.material swaps the material as given,
// .patches keep the engine's effects on a game material, .recolor() changes what the workers baked in. The chunk data itself: terrain-draw.mjs.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAKE = `
  const { THREE, createEngine, terrain, applyEffects, materialPatches } = threedogTest;
  const patched = m => !!Object.getOwnPropertyDescriptor(m, 'onBeforeCompile')?.get;
  const err = f => { try { f(); return ''; } catch (x) { return x.message; } };
  const ready = async E => { for (let i = 0; i < 600 && !E.terrain.isReadyAround({ x: 0, z: 0 }); i++) { E.step(1 / 60); await new Promise(res => setTimeout(res, 5)); } return E; };
  const make = async (opts, key) => {
    const E = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'terrain-mat-' + key });
    E.use(terrain({ seed: 7, viewChunks: 1, ...opts })); await E.start();
    return ready(E);
  };
  const chunk = E => E.terrain.chunks.get('0,0'), mesh = E => E.terrainDraw.meshes.get(chunk(E)).mesh;
`;
const page = fn => new Function(`${MAKE}\nreturn (${fn})();`);
const URL_ = '/tests/perf/index.html?mode=world';
const TERRAIN = fileURLToPath(new URL('../../modules/terrain/', import.meta.url));

export const specs = [
  {
    name: '[guard] terrain drawing: swappable through .material as given on every chunk; nothing in the module reaches engine.look / engine.style / makeMaterial',
    url: URL_,
    async run({ check, ev }) {
      const src = readdirSync(TERRAIN).map(f => readFileSync(TERRAIN + f, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')).join('\n');
      check('the module source names no picture entry', !/\b(engine|e)\.(look|style)\b|\bmakeMaterial\b|\bdefineLookPart\b/.test(src));
      const r = await ev(page(async () => {
        const E = await make({}, 'guard'), own = E.terrain.material, out = {};
        out.neutral = [own.type, own.vertexColors, own.color.getHex() === 0xffffff, materialPatches(own).join()];
        const data = chunk(E).data, m = new THREE.MeshStandardMaterial({ vertexColors: true });
        E.terrain.material = m;
        out.swapped = E.terrain.material === m && mesh(E).material === m && chunk(E).data === data;
        E.uniforms.uCloudShadow.value = 0.5; E.step(0.1);   // cloud shadow on: plain lit materials get the term, this one was given to the engine as it is
        out.given = patched(m);
        E.terrain.material = own;
        out.back = mesh(E).material === own;
        out.bad = err(() => { E.terrain.material = 42; });
        E.dispose();
        return out;
      }));
      check('default: the neutral vertex-colored Lambert with cloud shadow and season', r.neutral.join() === 'MeshLambertMaterial,true,true,world,clouds,season', JSON.stringify(r.neutral));
      check('set swaps the loaded chunks, nothing regenerated', r.swapped, JSON.stringify(r));
      check('a set material gets no patch, not even the plain-material cloud shadow', r.given === false, JSON.stringify(r));
      check('the engine\'s material can be set back; a non-material throws the form', r.back && /takes a three.js Material/.test(r.bad), r.bad);
    },
  },
  {
    name: '[guard] terrain({ material, effects: false }): the game material is used untouched at build; without effects it is patched; a function gets the engine; effects alone throws',
    url: URL_,
    async run({ check, ev }) {
      const r = await ev(page(async () => {
        const bare = new THREE.MeshStandardMaterial({ color: 0x6a8a4a }), fx = new THREE.MeshStandardMaterial({ color: 0x6a8a4a });
        let got = null;
        const A = await make({ material: bare, effects: false, detail: { noise: 'grain' } }, 'a'), B = await make({ material: fx }, 'b');
        const C = await make({ material: e => { got = e; return new THREE.MeshToonMaterial(); } }, 'c');
        const out = { a: { same: A.terrain.material === bare, patched: patched(bare), mesh: mesh(A).material === bare },
          b: { same: B.terrain.material === fx, patched: patched(fx) }, fn: got === C && C.terrain.material.isMeshToonMaterial && patched(C.terrain.material) };
        A.terrain.recolor({ detail: { noise: 'paper' } });
        out.a.after = patched(bare);
        out.bad = err(() => terrain({ effects: false }));
        for (const e of [A, B, C]) e.dispose();
        return out;
      }));
      check('effects: false: chunks draw the game material as given, never patched, recolor detail included', r.a.same && !r.a.patched && r.a.mesh && !r.a.after, JSON.stringify(r.a));
      check('without it the cloud shadow / season patches are added (unchanged default)', r.b.same && r.b.patched, JSON.stringify(r.b));
      check('(engine) => Material form', r.fn, String(r.fn));
      check('effects without a material throws with the one-line fix', /terrain\(\{ material: myMaterial, effects: false \}\)/.test(r.bad || ''), r.bad);
    },
  },
  {
    software: true,   // renders the game material to prove the handed-out patches still compile
    name: 'terrain patches and detail: terrain({ detail }) and recolor({ detail }) keep the capability (glsl too); .patches carry it to a game material; .uniforms are live',
    url: URL_,
    async run({ check, ev }) {
      const r = await ev(page(async () => {
        const GLSL = 'vec4 threedogDetailSample(vec2 p){ return vec4(vec3(fract(p.x)), 0.5); }';
        const E = await make({ detail: { glsl: GLSL, strength: 0.4 } }, 'det'), T = E.terrain, own = T.material, out = {};
        out.start = [materialPatches(own).join(), T.patches.map(p => p.name).join(), T.uniforms.uDetailStrength.value, T.uniforms.uDetailScale.value];
        const game = applyEffects(new THREE.MeshStandardMaterial({ vertexColors: true }), { clouds: false, patches: T.patches });
        out.game = materialPatches(game).join();
        const R = engine.renderer, prev = R.debug.onShaderError; let bad = '';
        R.debug.onShaderError = () => { bad += 'compile failed'; };
        const sc = new THREE.Scene(), g = new THREE.PlaneGeometry(1, 1);
        g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3));
        sc.add(new THREE.Mesh(g, game), new THREE.DirectionalLight());
        const rt = new THREE.WebGLRenderTarget(4, 4); R.setRenderTarget(rt); R.render(sc, new THREE.PerspectiveCamera()); R.setRenderTarget(null); rt.dispose(); R.debug.onShaderError = prev;
        out.compile = bad;
        T.material = game;
        T.recolor({ detail: { noise: 'paper', strength: 0.1 } });
        out.gameKept = [T.material === game, T.patches.find(p => p.name === 'detail').uniforms.uDetailStrength.value];
        T.material = own;
        const key = own.customProgramCacheKey();
        T.recolor({ detail: { noise: 'grain', strength: 0.2 } });
        out.swap = [T.material === own, own.customProgramCacheKey() !== key, T.uniforms.uDetailStrength.value];
        T.recolor({ detail: null });
        out.off = [materialPatches(own).join(), Object.keys(T.uniforms).length];
        E.dispose();
        return out;
      }));
      check('terrain({ detail: { glsl } }) is on the material, in patches, its uniforms readable', r.start.join() === 'world,clouds,season,detail,world,clouds,season,detail,0.4,0.25', JSON.stringify(r.start));
      check('applyEffects(game material, { patches }) carries the effects and compiles', r.game === 'world,season,clouds,detail' || r.game.split(',').sort().join() === 'clouds,detail,season,world', r.game);
      check('the handed-out patches compile on a game material', r.compile === '', r.compile);
      check('recolor({ detail }) leaves a game material on the chunks, patches refresh', r.gameKept.join() === 'true,0.1', JSON.stringify(r.gameKept));
      check('recolor({ detail }) changes the engine material in place', r.swap[0] && r.swap[1] && r.swap[2] === 0.2, JSON.stringify(r.swap));
      check('recolor({ detail: null }) takes the layer off', r.off.join() === 'world,clouds,season,0', JSON.stringify(r.off));
    },
  },
  {
    name: 'terrain.recolor: rebuilds chunks with new colors, keeps edits, shading null goes back; terrain() colors reach the workers as plain data; wrong values throw',
    url: URL_,
    async run({ check, ev }) {
      const r = await ev(page(async () => {
        const colors = { a: 0xff0000 }, biomeColors = { default: ['a'] };
        const out = {}, E = await make({ colors, biomeColors, shading: 'flat', normals: 'flat', variation: { jitter: { size: 1 } } }, 'rc'), T = E.terrain;
        const red = () => { const c = chunk(E).data.col; return [c[0] > c[1], c[1] > c[0]]; };
        out.cfg = (() => { try { structuredClone({ ...T.T.config, height: null, groundType: null, normalFn: null }); return true; } catch { return false; } })();
        out.start = [red()[0], T.T.config.shading, T.T.config.normals];
        T.edit({ x: 8, z: 8 }, { radius: 3, raise: 2 });
        const h = E.surface(8, 8);
        T.recolor({ colors: { a: 0x00ff00 } });
        await ready(E); for (let i = 0; i < 300 && !chunk(E)?.data; i++) { E.step(1 / 60); await new Promise(res => setTimeout(res, 5)); }
        out.green = red()[1];
        out.edit = Math.abs(E.surface(8, 8) - h) < 1e-6;
        T.recolor({ shading: 'smooth' }); out.smooth = T.T.config.shading;
        T.recolor({ shading: null }); out.back = T.T.config.shading;
        T.recolor({ normals: null, variation: null });
        out.cleared = [T.T.config.normals, T.T.config.variation ?? null];
        out.bad = [err(() => T.recolor({ shading: 'fancy' })), err(() => T.recolor({ colors: 5 })), err(() => T.recolor({ colours: {} })), err(() => T.recolor({ variation: { jiter: {} } })), err(() => terrain({ shading: 'fancy' }))];
        out.detail = err(() => terrain({ detail: 4 }));
        E.dispose();
        return out;
      }));
      check('terrain({ colors, biomeColors, shading, normals, variation }) reach the chunks; the config stays cloneable', r.cfg && r.start.join() === 'true,flat,flat', JSON.stringify([r.cfg, r.start]));
      check('recolor({ colors }) rebuilds the chunks, edits stay', r.green && r.edit, JSON.stringify([r.green, r.edit]));
      check('recolor({ shading }) changes it, null goes back to what terrain() was given', r.smooth === 'smooth' && r.back === 'flat', JSON.stringify([r.smooth, r.back]));
      check('null takes a baked value out', r.cleared[0] === null && r.cleared[1] === null, JSON.stringify(r.cleared));
      check('wrong values throw naming the key', /shading/.test(r.bad[0]) && /colors/.test(r.bad[1]) && /colours/.test(r.bad[2]) && /jiter/.test(r.bad[3]) && /shading/.test(r.bad[4]) && /detail/.test(r.detail), JSON.stringify([r.bad, r.detail]));
    },
  },
  {
    name: "terrain under a replaced draw part: material / patches read as empty, set and recolor throw naming why",
    url: URL_,
    async run({ check, ev }) {
      const r = await ev(page(async () => {
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'terrain-mat-own' });
        const [data] = terrain({ seed: 7, viewChunks: 1 });
        E.use(data);
        const out = { m: E.terrain.material, p: E.terrain.patches.length, set: err(() => { E.terrain.material = new THREE.MeshBasicMaterial(); }), re: err(() => E.terrain.recolor({ colors: {} })) };
        E.dispose();
        return out;
      }));
      check('reads are empty', r.m === null && r.p === 0, JSON.stringify(r));
      check('writes say the picture is replaced', /terrain-draw/.test(r.set) && /terrain-draw/.test(r.re), JSON.stringify(r));
    },
  },
];

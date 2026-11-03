// Node-material version of the sky dome (modules/sky/shader.js) and of the sky's own fog kinds (modules/sky/fog.js) for WebGPURenderer.
// Why a registry instead of an import: modules/sky is in every WebGL game's bundle and must not pull in three/tsl, so this file (loaded with
// threedog/tsl, i.e. only on the WebGPU route) registers itself (render/backend.js registerWebGPUPart) and the sky looks it up when the renderer is a
// WebGPURenderer (same pattern as particles.tsl.js / patchNodes.tsl.js).
// One copy of every value: the dome's uniforms stay the { value } objects frame.js and look.sky write (sky.uniforms); the nodes read them back
// each render. The engine's own ones (uSunDir, uTime, uCloud) come from threedog/tsl uniforms(engine), the same cached nodes every other
// TSL shader of that engine reads, so the calendar / weather writing engine.uniforms moves this dome and a game's own TSL sky together.
// Line for line the GLSL domeFragment: gradient, sun and moon discs, clouds ('plane' / 'cumulus'), stars, fog band, dome layers.
// The three GLSL hooks of the sky each have a tsl form here, same contract as a shader patch's tsl field: (ctx) => node, ctx carrying the value
// so far and the hook's inputs (look.sky.patch('clouds'), style.sky.layers / look.sky.patch('layer:<name>'), look.fog.patch('fog')). A hook with
// only GLSL throws [webgpu-needs-tsl] by name on this renderer; the GLSL form keeps drawing on WebGLRenderer unchanged.
import * as TSL from 'three/tsl';
import { MeshBasicNodeMaterial, BackSide } from 'three/webgpu';
import { noise, hash } from './noise.tsl.js';
import { uniforms as engineUniforms, readBack, valueNode } from './uniforms.tsl.js';
import { codedError } from '../../core/errorHints.js';
import { registerWebGPUPart } from '../backend.js';
import { SKY as K } from '../fxNumbers.js';

const { Fn, positionGeometry, varying, positionWorld, positionView, cameraPosition, float, vec2, vec3, vec4, select, mix, pow, max, dot,
  floor, fract, step, smoothstep, clamp, normalize, exp, abs, length, If, fog, rangeFogFactor, densityFogFactor } = TSL;

/** @template {string} T @typedef {import('three/webgpu').Node<T>} N */
/**
 * The dome's uniforms as nodes, by node type (makeSkyUniforms, clouds.js cloudUniforms, look.js); a hook's own uniforms are the extra keys.
 * Colors are typed vec3 (what they are in the shader): @types/three's 'color' node type lacks the vec3 operators (addAssign ...)
 * @typedef {{ uTop: N<'vec3'>, uHorizon: N<'vec3'>, uSunColor: N<'vec3'>, uMoonColor: N<'vec3'>, uCloudColor: N<'vec3'>,
 *   uCloudShade: N<'vec3'>, uFogColor: N<'vec3'>, uSunDir: N<'vec3'>, uCloudWeights: N<'vec3'>, uCloudSpeed: N<'vec2'>, uCloudFade: N<'vec2'>,
 *   uCloudMul: N<'vec2'>, uNight: N<'float'>, uSunSize: N<'float'>, uSunGlow: N<'float'>, uSunPower: N<'float'>, uMoonPower: N<'float'>,
 *   uMoonSize: N<'float'>, uTime: N<'float'>, uCloud: N<'float'>, uCloudCover: N<'float'>, uCloudScale: N<'float'>, uStars: N<'float'>,
 *   uStarCloudDim: N<'float'>, uStarScale: N<'float'>, uCurve: N<'float'>, uCloudHorizon: N<'float'>, uCloudOpacity: N<'float'>,
 *   uCloudSoft: N<'float'>, uCloudRelief: N<'float'>, uFogBand: N<'float'>, [k: string]: any }} SkyNodes
 */

/** sky.uniforms -> nodes: engine.uniforms entries through uniforms(engine), the sky's own { value } objects read back every render */
/** @returns {SkyNodes} */
function nodesOf(u, engine) {
  const E = engineUniforms(engine), n = /** @type {SkyNodes} */ ({});
  for (const [k, o] of Object.entries(u)) {
    if (engine.uniforms[k] === o) { n[k] = E[k]; continue; }   // shared object (makeSkyUniforms puts engine.uniforms.uSunDir in): no second node
    const v = o.value;
    if (typeof v !== 'number' && !v?.isVector2 && !v?.isVector3 && !v?.isColor) continue;
    // read back every render, also for vectors / colors: uFogColor is a getter (the fog object's color, which a game may replace)
    n[k] = valueNode(o);
  }
  return n;
}

/** GLSL h3 (the star hash) */
const h3 = Fn(/** @param {[N<'vec3'>]} a */ ([p0]) => {
  const p = fract(p0.mul(K.starMul).add(K.starAdd)).mul(K.starScale);
  return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z)));
});

/** clouds dim toward SKY.nightDim at night (GLSL nightDim + (1 - nightDim) * (1 - night)) */
const nightDim = (/** @type {SkyNodes} */ U) => U.uNight.oneMinus().mul(1 - K.nightDim).add(K.nightDim);

// The built-in cloud kinds (clouds.js PLANE / CUMULUS); same arguments as threedogClouds(d, time, sunDir, night, lit, shade, cov)
/** @type {Record<string, (U: SkyNodes, d: N<'vec3'>, cov: N<'float'>) => N<'vec4'>>} */
const CLOUDS = {
  plane: (U, d, cov) => {
    const cp = d.xz.div(d.y.add(U.uCloudHorizon)).mul(U.uCloudScale).add(U.uCloudSpeed.mul(U.uTime));
    const cn = noise(cp).mul(U.uCloudWeights.x).add(noise(cp.mul(U.uCloudMul.x).add(7)).mul(U.uCloudWeights.y)).add(noise(cp.mul(U.uCloudMul.y)).mul(U.uCloudWeights.z));
    const lo = cov.oneMinus();
    const cloud = smoothstep(lo, lo.add(U.uCloudSoft), cn).mul(smoothstep(U.uCloudFade.x, U.uCloudFade.y, d.y));
    const cc = mix(U.uCloudShade, U.uCloudColor, smoothstep(K.planeTone[0], K.planeTone[1], cn)).mul(nightDim(U));
    return vec4(cc, cloud.mul(U.uCloudOpacity));
  },
  cumulus: (U, d, cov) => {
    // threedogCumulusDensity: the 4-octave loop unrolled (JS builds the same four steps)
    const density = (/** @type {N<'vec2'>} */ p0) => {
      /** @type {N<'float'>} */ let s = float(0);
      let p = p0, a = 0.5;
      for (let i = 0; i < 4; i++) { s = s.add(noise(p).mul(a)); p = p.mul(K.lacunarity).add(K.offset); a *= 0.5; }
      return s.div(K.norm);
    };
    const cp = d.xz.div(d.y.add(U.uCloudHorizon)).mul(U.uCloudScale).add(U.uCloudSpeed.mul(U.uTime));
    const toSun = normalize(U.uSunDir.xz.add(vec2(0.0001, 0))).mul(K.toSun);
    const n0 = density(cp).toVar(), n1 = density(cp.add(toSun));
    const t = cov.mul(K.cover).oneMinus();
    const body = smoothstep(t, t.add(U.uCloudSoft), n0), core = smoothstep(t, t.add(K.core), n0);
    const sunSide = clamp(n0.sub(n1).mul(U.uCloudRelief).add(0.5), 0, 1);
    const light = mix(sunSide, float(1), core.oneMinus().mul(K.rim)).mul(core.mul(0.5).oneMinus().mul(K.coreDark).add(1 - K.coreDark));
    const cc = mix(U.uCloudShade, U.uCloudColor, light).mul(nightDim(U));
    return vec4(cc, body.mul(smoothstep(U.uCloudFade.x, U.uCloudFade.y, d.y)).mul(U.uCloudOpacity));
  },
};

/** What every sky hook's tsl code gets besides its inputs: the noise functions of the GLSL scope (threedogHash / threedogNoise) */
const FX = Object.freeze({ noise, hash });

/** Run a hook's tsl code; a throw or a non-node result is named after the hook, so the error points at the game's own code */
function runHook(where, fn, ctx) {
  let v;
  try { v = fn(ctx); }
  catch (e) { throw Object.assign(codedError('sky-option', `[sky] ${where} tsl: ${e?.message ?? e}`), { cause: e }); }
  if (!v?.isNode) throw codedError('sky-option', `[sky] ${where} tsl must return a vec4 node (rgb, amount), got ${v === null ? 'null' : typeof v}`);
  return v;
}

/**
 * The hooks a node dome draws, checked: each needs its tsl form (GLSL text has no node form), and each is run once on stand-in values now, so a
 * typo throws at the patch / sky() call instead of at the first draw (patchNodes.tsl.js does the same for its build-time slots).
 * @param {any} cloudsHook look.sky.patch('clouds') value (GLSL string | { glsl?, tsl?, uniforms? }) or null
 * @param {{ tsl?: Function, blend: string, where: string }[]} layers resolved dome layers (domeLayers.js, gpu mode)
 * @param {Record<string, any>} U the dome uniforms as nodes (the real ones: a hook reading ctx.uniforms.uMine is checked too)
 * @returns {Function | null} the clouds tsl code
 */
function checkHooks(cloudsHook, layers, U) {
  const h = typeof cloudsHook === 'string' ? { glsl: cloudsHook } : cloudsHook;
  if (h != null && typeof h.tsl !== 'function') throw glslPart("look.sky.patch('clouds')");
  for (const l of layers) if (typeof l.tsl !== 'function') throw glslPart(l.where);
  const v3 = vec3(0, 1, 0), f = float(0.5), stand = { dir: v3, time: f, sunDir: v3, night: f, uniforms: U, fx: FX, tsl: TSL };
  if (h) runHook("look.sky.patch('clouds')", h.tsl, { ...stand, lit: v3, shade: v3, cover: f, clouds: vec4(0) });
  for (const l of layers) runHook(l.where, l.tsl, { ...stand, color: v3 });
  return h?.tsl ?? null;
}

/**
 * The dome's color node (the domeFragment math) over sky.uniforms, with the hooks' tsl code where the GLSL calls its functions.
 * @param {SkyNodes} U nodes of sky.uniforms @param {string} kind built-in cloud kind
 * @param {Function | null} clouds look.sky.patch('clouds') tsl @param {{ tsl: Function, blend: string, where: string }[]} layers
 */
function domeColor(U, kind, clouds, layers) {
  // unit sphere: positionGeometry is already unit length at the vertices, normalized again per pixel like GLSL normalize(vDir)
  const vDir = varying(normalize(positionGeometry));
  return Fn(() => {
    const d = normalize(vDir).toVar();
    const y = max(d.y, 0);
    const col = select(d.y.lessThan(0), U.uHorizon, mix(U.uHorizon, U.uTop, pow(y, U.uCurve))).toVar();
    const sd = max(dot(d, U.uSunDir), 0);
    col.addAssign(U.uSunColor.mul(pow(sd, U.uSunSize).mul(U.uSunPower).add(pow(sd, K.glowPower).mul(U.uSunGlow))).mul(step(0, U.uSunDir.y.add(K.sunCut))));
    const md = max(dot(d, U.uSunDir.negate()), 0);
    col.addAssign(U.uMoonColor.mul(pow(md, U.uMoonSize)).mul(U.uMoonPower).mul(U.uNight));
    const g = floor(d.mul(U.uStarScale));
    const cov = U.uCloud.mul(U.uCloudCover), clA = float(0).toVar();
    // what every hook gets: the arguments its GLSL function takes, the dome's uniforms as nodes, the noise functions and three/tsl
    const base = { dir: d, time: U.uTime, sunDir: U.uSunDir, night: U.uNight, uniforms: U, fx: FX, tsl: TSL };
    If(d.y.greaterThan(0).and(cov.greaterThan(0.01)), () => {
      // look.sky.patch('clouds') tsl: ctx.clouds is the built-in kind's result (the value so far), built only when the code reads it
      const cl = (clouds ? runHook("look.sky.patch('clouds')", clouds, { ...base, lit: U.uCloudColor, shade: U.uCloudShade, cover: cov,
        get clouds() { return CLOUDS[kind](U, d, cov); } }) : CLOUDS[kind](U, d, cov)).toVar();
      col.assign(mix(col, cl.rgb, cl.a)); clA.assign(cl.a);
    });
    // stars behind the clouds, dimmed by the weather's cover (see the GLSL comment in shader.js)
    const star = step(U.uStars.oneMinus(), h3(g)).mul(U.uNight).mul(smoothstep(0, K.starFade, d.y)).mul(clA.oneMinus())
      .mul(clamp(U.uCloud, 0, 1).mul(U.uStarCloudDim).oneMinus());
    col.addAssign(vec3(star));
    // fog band (fog.js DOME_FOG): always built, switched by uFogBand
    col.assign(mix(col, U.uFogColor, U.uFogBand.mul(smoothstep(-0.02, 0.15, d.y).oneMinus())));
    // dome layers after the fog band, in their resolved order, as the GLSL body appends them; ctx.color is the sky so far
    for (const l of layers) {
      const L = runHook(l.where, l.tsl, { ...base, color: col }).toVar();
      if (l.blend === 'add') col.addAssign(L.rgb.mul(L.a)); else col.assign(mix(col, L.rgb, L.a));
    }
    return vec4(col, 1);
  })();
}

/**
 * The dome material: MeshBasicNodeMaterial with the domeFragment math as its colorNode, reading sky.uniforms.
 * @param {Record<string, { value: any }>} u sky.uniforms (makeSkyUniforms + prepareLook) @param {any} st style.sky + sky() options
 * @param {string} kind cloud kind @param {any} engine
 * @param {{ clouds?: any, layers?: any[] }} [hooks] clouds hook value and resolved dome layers (shader.js / lookSky.js resolve them)
 */
function domeMaterial(u, st, kind, engine, hooks = {}) {
  const m = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, depthTest: false, fog: false });
  setHooks(m, u, kind, engine, hooks);
  return m;
}

/**
 * Point a node dome at new hooks (look.sky.patch rebuild): checked first, so a bad hook throws with the dome unchanged; then a new color node
 * (one recompile, like the GLSL dome's new fragment text). The nodes are made again here: a hook may have brought uniforms of its own.
 */
function setHooks(m, u, kind, engine, { clouds = null, layers = [] } = {}) {
  const U = nodesOf(u, engine), fn = checkHooks(clouds, layers, U);
  m.colorNode = domeColor(U, kind, fn, layers);
  m.needsUpdate = true;
}

/** A GLSL-only sky hook on WebGPU: named, with the ways that do draw there. Why throw: a dome missing its layers is a wrong sky, not a neutral one */
const glslPart = what => codedError('webgpu-needs-tsl', `[sky] ${what} is GLSL only, which does not draw on WebGPURenderer: give it a tsl form too ` +
  "(tsl: (ctx) => vec4 node, recipe 52 'tsl forms'), keep this sky on WebGLRenderer, or draw your own sky object (engine.look.sky.replace(object), " +
  "e.g. three's SkyMesh from three/addons/objects/SkyMesh.js)");

// ---- the sky's fog kinds on node materials ----
// On WebGPURenderer fog is one node per scene (scene.fogNode, read by every NodeMaterial with fog: true), not code inside each material, so
// the sky sets that instead of the GLSL 'fog' patch. Values are read from scene.fog every render (color / density the sky writes each frame).
// Like the GLSL patch, the replacement only stands while scene.fog is the fog object its kind compiles under (fog.js fogMaterials checks it per
// frame): a game that swaps in the other object gets three's own fog, as the patch's #else branch gives it on WebGL.

/**
 * The scene fog node for resolved settings: a built-in kind ('exp' / 'height'), or the look.fog.patch('fog') tsl code.
 * @param {any} scene @param {any} f resolved fog settings (fog.js resolveFog: kind, height, falloff, hook)
 */
function fogNode(scene, f) {
  // readBack (render group), like three's own scene fog: the materials reading scene.fogNode are mostly plain ones with no node of their own,
  // and an object-group value would freeze at the first frame's fog color / density (uniforms.tsl.js readBack says why)
  const held = scene.fog.color.clone();
  const color = readBack(() => scene.fog?.color ?? held, held);
  const density = readBack(() => scene.fog?.density ?? 0, 0);
  const near = readBack(() => scene.fog?.near ?? 0, 0), far = readBack(() => scene.fog?.far ?? 0, 0);
  // GLSL vFogDepth is -mvPosition.z (view depth), the same as three's own range fog uses
  const depth = positionView.z.negate();
  const kind = f.kind;
  const builtIn = () => kind === 'exp' ? exp(density.negate().mul(depth)).oneMinus()
    : kind === 'height' ? heightFactor(density, f) : kind === 'linear' ? rangeFogFactor(near, far) : densityFogFactor(density);
  if (!f.hook) return fog(color, builtIn());
  // look.fog.patch('fog') tsl: the arguments of the GLSL threedogFog, the values its scope has, and ctx.fog = what the kind alone would draw
  const out = runHook("look.fog.patch('fog')", f.hook.tsl, { color, depth, worldPos: positionWorld, cameraPosition, density, near, far,
    height: float(f.height), falloff: float(f.falloff), get fog() { return vec4(color, builtIn()); }, fx: FX, tsl: TSL });
  return fog(out.rgb, clamp(out.a, 0, 1));
}

/** 'height': the integral of exp(-falloff * (y - floor)) along the view ray (fog.js FN.height, same clamp at the floor) */
const heightFactor = (density, f) => Fn(() => {
  const b = float(f.falloff), floorY = float(f.height);
  const hc = max(cameraPosition.y.sub(floorY), 0), hp = max(positionWorld.y.sub(floorY), 0);
  const dist = length(positionWorld.sub(cameraPosition)), dh = hp.sub(hc);
  const k = select(abs(dh.mul(b)).lessThan(1e-4), exp(b.negate().mul(hc)), exp(b.negate().mul(hc)).sub(exp(b.negate().mul(hp))).div(b.mul(dh)));
  return exp(density.negate().mul(dist).mul(k)).oneMinus();
})();

/**
 * The sky's fog on one scene (fog.js setFogPatch / fogMaterials on WebGPU). Same rule as the GLSL patch: for the density kinds the node stands only
 * while scene.fog is a FogExp2, for a 'linear' hook only while it is a THREE.Fog (sync, every frame); the other fog object gets three's own fog.
 * A scene.fogNode the game set itself is never overwritten.
 */
function fogSide(scene) {
  let make = null, node = null, linear = false;
  const sync = () => {
    const want = !!make && (linear ? !!scene.fog?.isFog : !!scene.fog?.isFogExp2);
    if (want && !node) node = make();
    const target = want ? node : null;
    if (scene.fogNode !== target && (scene.fogNode == null || scene.fogNode === node)) scene.fogNode = target;
  };
  return {
    /** @param {any} f resolved fog settings (fog.js resolveFog) or null */
    set(f) {
      if (f?.hook) {
        if (typeof f.hook.tsl !== 'function') throw codedError('webgpu-needs-tsl', "[sky] look.fog.patch('fog') is GLSL only, which does not draw on WebGPURenderer: " +
          "give it a tsl form too ({ glsl, tsl: (ctx) => vec4(fog rgb, amount) }, recipe 52 'tsl forms'), use look.fog kind 'linear' | 'exp' | 'exp2' | 'height', " +
          'or set your own scene.fogNode (three/tsl fog())');
        // run once on stand-ins now: a typo throws at look.fog.patch, not at the first draw
        const v = vec3(0), x = float(1);
        runHook("look.fog.patch('fog')", f.hook.tsl, { color: v, depth: x, worldPos: v, cameraPosition: v, density: x, near: x, far: x, height: x, falloff: x,
          fog: vec4(0), fx: FX, tsl: TSL });
      }
      if (node && scene.fogNode === node) scene.fogNode = null;
      node = null; linear = f?.kind === 'linear';
      // plain linear / exp2 without a hook: three's own fog. Built on first use (reads scene.fog)
      make = f && (f.hook || f.kind === 'exp' || f.kind === 'height') ? () => fogNode(scene, f) : null;
      sync();
    },
    sync,
  };
}

registerWebGPUPart('sky', Object.freeze({ domeMaterial, setHooks, fogSide, kinds: Object.freeze(Object.keys(CLOUDS)) }));

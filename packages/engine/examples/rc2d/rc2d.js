// @ts-check
// 2D radiance cascades: screen-space global illumination for top-down and side-view games (WebGL2, fragment shaders only, no compute).
// An optional example, not an engine module: copy this folder (rc2d.js + shaders.js) into your game and import it.
//
//   import { createRadianceCascades2D } from './rc2d/rc2d.js';
//   wall.layers.enable(5); lamp.layers.enable(5);          // what light sees: lamps (emissive) and walls (not emissive) on one layer
//   const rc = createRadianceCascades2D(engine, { ambient: 0.15 });
//   yourPostChain.add(rc.pass);                            // a plain three.js Pass; before the tone curve, the light is linear
//   rc.describe(); rc.texture; rc.resize(); rc.dispose();
//
// Each frame (engine.onRender, before the frame): the meshes on `layer` are drawn from the game camera into a scene target (rgb = their emissive,
// a = solid) -> jump flood -> distance field -> cascades traced and merged from the coarsest down -> gather into `texture` (linear light per
// screen pixel). `pass` is a three.js ShaderPass that adds that light to the frame; the caller puts it in the post chain, or leaves it out and
// samples `texture` in its own materials (screen uv). Colours and strengths are the game's: a lamp shines with its material's emissive * emissiveIntensity.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VERT, SEED, JFA, DIST, CASCADE, GATHER, APPLY } from './shaders.js';

/**
 * The parameters, in one place. quality: RC resolution as a share of the screen (CSS pixels) and the march step cap per ray.
 * interval: cascade 0's ray length in RC pixels (each cascade's is 4x the one below). cascades: 'auto' = enough to cross the screen diagonal.
 * ambient: the light level the frame is already lit with (albedo = color / ambient).
 */
export const RC2D_DEFAULTS = Object.freeze({ layer: 5, quality: 'medium', cascades: 'auto', interval: 4, ambient: 1 });
/** @typedef {{ layer?: number, quality?: 'low' | 'medium' | 'high', cascades?: number | 'auto', interval?: number, ambient?: number }} Rc2dOptions */
export const RC2D_QUALITY = Object.freeze({ low: { scale: 0.25, steps: 16 }, medium: { scale: 0.5, steps: 24 }, high: { scale: 1, steps: 32 } });
const SPACING0 = 2;   // cascade 0 probe spacing (RC pixels); with 4 directions it keeps every cascade target about the scene target's size

/**
 * @param {any} engine a threedog engine (renderer, scene, onRender)
 * @param {Rc2dOptions} [options]
 */
export function createRadianceCascades2D(engine, options = {}) {
  for (const k of Object.keys(options)) if (!(k in RC2D_DEFAULTS)) throw new Error(`rc2d: unknown option '${k}'; options: ${Object.keys(RC2D_DEFAULTS).join(', ')}`);
  const o = /** @type {Required<Rc2dOptions>} */ ({ ...RC2D_DEFAULTS, ...options });
  const q = RC2D_QUALITY[/** @type {keyof typeof RC2D_QUALITY} */ (o.quality)];
  if (!q) throw new Error(`rc2d: quality '${o.quality}' is not one of ${Object.keys(RC2D_QUALITY).join(', ')}`);
  if (!(o.interval > 0)) throw new Error(`rc2d: interval is cascade 0's ray length in RC pixels (> 0), got ${o.interval}`);
  if (o.cascades !== 'auto' && !(Number.isInteger(o.cascades) && o.cascades >= 1 && o.cascades <= 8)) throw new Error(`rc2d: cascades is 'auto' or 1..8, got ${o.cascades}`);
  if (!(Number.isInteger(o.layer) && o.layer >= 1 && o.layer <= 31)) throw new Error(`rc2d: layer is a three.js layer 1..31 (0 is everything), got ${o.layer}`);
  if (!(o.ambient > 0)) throw new Error(`rc2d: ambient is the light level the frame is already lit with (> 0), got ${o.ambient}`);

  const { renderer, scene } = engine;
  const quad = new FullScreenQuad();
  const mat = (/** @type {string} */ fragmentShader, /** @type {Record<string, any>} */ uniforms, defines = {}) => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false });
  const u = (/** @type {any} */ v) => ({ value: v });
  const mats = {
    seed: mat(SEED, { tScene: u(null) }),
    jfa: mat(JFA, { tSeed: u(null), uSize: u(new THREE.Vector2()), uStep: u(1) }),
    dist: mat(DIST, { tSeed: u(null) }),
    cascade: mat(CASCADE, { tScene: u(null), tDist: u(null), tUpper: u(null), uSize: u(new THREE.Vector2()), uTile: u(new THREE.Vector2()), uS: u(2),
      uSpacing: u(SPACING0), uStart: u(0), uLen: u(1), uHasUpper: u(0), uUpperTile: u(new THREE.Vector2()), uUpperS: u(4) },
    { STEPS: q.steps }),
    gather: mat(GATHER, { tC0: u(null), uTile0: u(new THREE.Vector2()), uTex0: u(new THREE.Vector2()), uSpacing0: u(SPACING0) }),
  };
  // frame * (1 + gi / ambient), in linear colour before tone mapping. tGI is written after each gather: a resize makes a new texture
  const pass = new ShaderPass(mat(APPLY, { tDiffuse: u(null), tGI: u(null), uAmbient: u(o.ambient) }));
  /** @type {{ scene: THREE.WebGLRenderTarget, seed: THREE.WebGLRenderTarget[], dist: THREE.WebGLRenderTarget, gi: THREE.WebGLRenderTarget, cascades: { rt: THREE.WebGLRenderTarget, tile: THREE.Vector2, s: number, spacing: number, start: number, len: number }[] } | null} */
  let t = null;
  const size = new THREE.Vector2(), css = new THREE.Vector2();
  let disposed = false;

  const target = (/** @type {number} */ w, /** @type {number} */ h, /** @type {object} */ extra = {}) => new THREE.WebGLRenderTarget(w, h,
    { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, ...extra });
  const freeTargets = () => {
    if (!t) return;
    for (const rt of [t.scene, ...t.seed, t.dist, t.gi, ...t.cascades.map(c => c.rt)]) rt.dispose();
    t = null;
  };
  // Sized from the renderer's CSS size (not the drawing buffer), so adaptive resolution changing the pixel ratio does not rebuild everything
  function build() {
    renderer.getSize(css);
    const w = Math.max(8, Math.ceil(css.x * q.scale)), h = Math.max(8, Math.ceil(css.y * q.scale));
    if (t && size.x === w && size.y === h) return;
    freeTargets();
    size.set(w, h);
    const n = o.cascades === 'auto' ? Math.min(8, Math.max(1, Math.ceil(Math.log(3 * Math.hypot(w, h) / o.interval + 1) / Math.log(4)))) : o.cascades;
    const cascades = [];
    for (let i = 0; i < n; i++) {
      const spacing = SPACING0 * 2 ** i, s = 2 ** (i + 1);   // probes halve per axis, directions x4: each target stays near the scene size
      const tile = new THREE.Vector2(Math.ceil(w / spacing), Math.ceil(h / spacing));
      // linear filtering for cascade 0 only: the gather reads 4 neighbouring probes in one fetch (the merge reads exact texels)
      const filter = i === 0 ? THREE.LinearFilter : THREE.NearestFilter;
      cascades.push({ rt: target(tile.x * s, tile.y * s, { minFilter: filter, magFilter: filter }), tile, s, spacing,
        start: o.interval * (4 ** i - 1) / 3, len: o.interval * 4 ** i });
    }
    t = { scene: target(w, h), seed: [target(w, h, { type: THREE.FloatType }), target(w, h, { type: THREE.FloatType })], dist: target(w, h),
      gi: target(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }), cascades };
  }

  const draw = (/** @type {THREE.ShaderMaterial} */ m, /** @type {THREE.WebGLRenderTarget} */ rt) => { quad.material = m; renderer.setRenderTarget(rt); quad.render(renderer); };

  // The meshes on `layer` drawn with a flat material each: colour = their emissive (0 for walls), alpha 1 = solid. Cached per source material.
  /** @type {WeakMap<THREE.Material, THREE.MeshBasicMaterial>} */
  const proxies = new WeakMap();
  const swapped = /** @type {[THREE.Mesh, any][]} */ ([]);
  const proxyOf = (/** @type {any} */ m) => {
    let p = proxies.get(m);
    // hint-off(material): a flat stand-in whose colour is the source material's emissive, not art
    if (!p) { p = new THREE.MeshBasicMaterial({ fog: false, toneMapped: false }); proxies.set(m, p); }
    p.color.setRGB(0, 0, 0);
    if (m.emissive) p.color.copy(m.emissive).multiplyScalar(m.emissiveIntensity ?? 1);   // read every frame: flicker and day / night keep working
    p.side = m.side;
    return p;
  };
  const clear = new THREE.Color();
  function drawScene(/** @type {THREE.Camera} */ camera) {
    scene.traverse((/** @type {any} */ obj) => {
      if (!obj.isMesh || !obj.layers.isEnabled(o.layer)) return;
      swapped.push([obj, obj.material]);
      obj.material = Array.isArray(obj.material) ? obj.material.map(proxyOf) : proxyOf(obj.material);
    });
    // what is saved here is put back before the frame renders, so the engine's own per-frame writes (sky background) never see a change
    const mask = camera.layers.mask, bg = scene.background, alpha = renderer.getClearAlpha(), auto = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(clear);
    camera.layers.set(o.layer); scene.background = null; renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(t.scene); renderer.clear(); renderer.render(scene, camera);
    renderer.setClearColor(clear, alpha); renderer.shadowMap.autoUpdate = auto; scene.background = bg; camera.layers.mask = mask;
    for (const [obj, m] of swapped) obj.material = m;
    swapped.length = 0;
  }

  let frameMs = 0;
  function update(/** @type {{ camera: THREE.Camera }} */ { camera }) {
    if (disposed) return;
    const t0 = performance.now();   // measure: CPU-side submit time only (describe().ms); GPU time needs the perf tool
    build();
    if (!t) return;
    drawScene(camera);
    // jump flood: seed, then steps of half the largest power of two down to 1, ping-ponging the two float targets
    mats.seed.uniforms.tScene.value = t.scene.texture; draw(mats.seed, t.seed[0]);
    let src = 0;
    mats.jfa.uniforms.uSize.value.copy(size);
    for (let step = 2 ** Math.floor(Math.log2(Math.max(size.x, size.y))); step >= 1; step /= 2) {
      mats.jfa.uniforms.tSeed.value = t.seed[src].texture; mats.jfa.uniforms.uStep.value = step;
      draw(mats.jfa, t.seed[1 - src]); src = 1 - src;
    }
    mats.dist.uniforms.tSeed.value = t.seed[src].texture; draw(mats.dist, t.dist);
    // cascades from the coarsest (longest rays, fewest probes) to cascade 0, each merging the one above it
    const cu = mats.cascade.uniforms;
    cu.tScene.value = t.scene.texture; cu.tDist.value = t.dist.texture; cu.uSize.value.copy(size);
    for (let i = t.cascades.length - 1; i >= 0; i--) {
      const c = t.cascades[i], up = t.cascades[i + 1];
      cu.uTile.value.copy(c.tile); cu.uS.value = c.s; cu.uSpacing.value = c.spacing; cu.uStart.value = c.start; cu.uLen.value = c.len;
      cu.uHasUpper.value = up ? 1 : 0;
      if (up) { cu.tUpper.value = up.rt.texture; cu.uUpperTile.value.copy(up.tile); cu.uUpperS.value = up.s; }
      else cu.tUpper.value = null;   // never the target being written
      draw(mats.cascade, c.rt);
    }
    const c0 = t.cascades[0], gu = mats.gather.uniforms;
    gu.tC0.value = c0.rt.texture; gu.uTile0.value.copy(c0.tile); gu.uTex0.value.set(c0.rt.width, c0.rt.height);
    draw(mats.gather, t.gi);
    pass.uniforms.tGI.value = t.gi.texture;
    renderer.setRenderTarget(null);
    frameMs = performance.now() - t0;
  }
  const hook = engine.onRender(update);

  return {
    /** The ShaderPass that adds the light to the frame. Yours to put in the post chain; take it out of the chain before dispose() */
    pass,
    /** The gathered light, linear rgb per screen uv (null before the first frame); a new texture after a resize */
    get texture() { return t ? t.gi.texture : null; },
    /** The render target holding `texture` (HalfFloat RGBA, linear filtering), for size or readRenderTargetPixels (Uint16Array, half floats) */
    get target() { return t ? t.gi : null; },
    /** Re-read the render size now (it is also checked every frame); rebuilds the targets when it changed */
    resize() { if (!disposed) build(); },
    /** Remove the hook, free every render target and material, the pass's too */
    dispose() {
      if (disposed) return;
      disposed = true;
      hook.remove();
      freeTargets();
      for (const m of Object.values(mats)) m.dispose();
      quad.dispose();
      pass.dispose();
    },
    describe() {
      return { size: [size.x, size.y], quality: o.quality, layer: o.layer, interval: o.interval, ambient: o.ambient,
        cascades: t ? t.cascades.map(c => ({ probes: [c.tile.x, c.tile.y], directions: c.s * c.s, spacing: c.spacing, interval: [c.start, c.start + c.len] })) : [],
        targets: t ? 5 + t.cascades.length : 0, cpuMs: +frameMs.toFixed(2), disposed };
    },
  };
}

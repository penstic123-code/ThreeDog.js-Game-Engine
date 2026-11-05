// Post chain on WebGLRenderer (EffectComposer). PostFX.js holds the effect list and calls these with itself as `post`.
//
// Why EffectComposer and not three 0.187's renderer.setEffects(): setEffects fixes MSAA when the renderer is created (no
// runtime switch for the settings menu) and always tone-maps last, so there is no place for sRGB-space effects (LUT, palette
// quantising, paper grain). The engine owns the composer; post.object() / targets() hand it out for reading.
//
// MSAA: with no effect on, the canvas's own (the engine makes the context with the default antialias), and the scene renders straight to the
// canvas with nothing allocated (direct: Color, clear-color and sRGB texture backgrounds are drawn tone-mapped there too, as the composer does).
// With an effect on, or antialias switched away from the canvas's at runtime (a context's MSAA is fixed when it is made), it lives in the
// composer's render targets, so it survives any effect and can be switched at runtime.
// Why the state stays on the PostFX object (post.composer, post._fused ...): tests and post.object() read it there; splitting the file changed no behavior.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FusedPass, groupFuse, checkDepthOrder } from './fuse.js';
import { codedError } from '../core/base/errorHints.js';
import { holdShadowRedraw, MSAA_SAMPLES } from './backend.js';
import { notePatch, patchOn } from '../core/scene/threePatches.js';

// One FusedPass per group of neighboring fuse effects, kept while the same effects stay grouped (a changed group recompiles once)
function fuseEntry(post, group, used) {
  const key = group.map(e => e.name).join('+'), old = post._fused.get(key);
  let pass = old && old.items.every((e, i) => e === group[i]) ? old : null;
  if (!pass) { old?.dispose(); pass = new FusedPass(group); post._fused.set(key, pass); }
  used.add(key);
  return { name: `fused(${key})`, _impl: pass };
}

// Shadow maps once a frame. three redraws every shadow map in each renderer.render() while shadowMap.autoUpdate is on, and effects that render the
// scene again for their own buffers (ao's normals, outline's normals and mask) did so a second time: measured 2 redraws a frame with ao on, 5-20 % frame
// time (tests/specs/shadow-passes.mjs). So the pass that draws the scene (index 0 of the chain) turns redraws off once it has drawn, and
// render() puts the switch back after the whole chain. Why after the scene pass and not before the chain: that pass is the one whose
// shadows the picture shows, and it also uses up a requested redraw (needsUpdate, sky's shadow.updateEvery), so "every N frames" still works.
// Why wrapping the pass's render and not an extra marker pass: the chain's pass list is what tests and post.object() show.
const HOLDS = new WeakSet();
notePatch('post-shadow-hold', "render of the first pass of the WebGL post chain, which may be the game's own Pass: wrapped so shadow maps redraw once a frame (render/postWebGL.js)", () => {},
  { scope: 'post chain', lost: 'effects that draw the scene again (ao, outline) redraw every shadow map a second time each frame' });
function holdAfterScene(post, pass) {
  if (!pass || HOLDS.has(pass)) return;
  HOLDS.add(pass);
  const render = pass.render;
  pass.render = function (...a) {
    const out = render.apply(this, a);
    post.engine.occlusion?._sceneDrawn();   // whichever pass drew the scene: the later passes must not see occlusion's boxes
    if (post._shadowRelease === null && patchOn('post-shadow-hold')) post._shadowRelease = holdShadowRedraw(post.engine.renderer, post.engine.scene);
    return out;
  };
}
// The composer follows the renderer's size and pixel ratio, read every frame (four number compares). Why here and not only in the engine's
// resize: EffectComposer does not follow the renderer by itself, and a game calling renderer.setSize / setPixelRatio itself (three's usual
// window.onresize handler, or a sharper picture) left the chain drawing at the old size, stretched or blurred, on WebGL only (WebGPU's
// pass() nodes follow the drawing buffer on their own). The renderer is the one truth; the engine's resize and photo mode write only it.
const _css = new THREE.Vector2();
function follow(post) {
  const c = post.composer, r = post.engine.renderer, s = r.getSize(_css), pr = r.getPixelRatio();
  if (c._pixelRatio !== pr) c.setPixelRatio(pr);
  if (c._width !== s.x || c._height !== s.y) c.setSize(s.x, s.y);
}
/** composer.render with the shadow switch put back afterwards, even when a pass throws */
function composerRender(post, dt) {
  post._shadowRelease = null;
  try { post.composer.render(dt); } finally { post._shadowRelease?.(); post._shadowRelease = undefined; }
}

/**
 * The chain into a render target. The composer's last pass draws to the canvas whenever renderToScreen is on (three's passes call
 * setRenderTarget(null) themselves), so the chain runs off-screen and its result, left in readBuffer (a swapping pass swapped it there, a
 * non-swapping one wrote it there), is copied into target with the composer's own copy pass: the same values the canvas would get.
 */
function toTarget(post, dt, target) {
  const c = post.composer, r = post.engine.renderer;
  c.renderToScreen = false;
  try { webglPost.render(post, dt); } finally { c.renderToScreen = true; }
  const prev = r.getRenderTarget();
  c.copyPass.renderToScreen = false;
  try { c.copyPass.render(r, target, c.readBuffer); } finally { r.setRenderTarget(prev); }
}

// The meshes three draws a texture background with (WebGLBackground's plane and box), by their material names
const BG_MATERIALS = ['BackgroundMaterial', 'BackgroundCubeMaterial'];
notePatch('post-background-tone', "onBeforeRender of three's own background mesh (the one WebGLBackground keeps): tone mapping on while the engine draws straight to the canvas (render/postWebGL.js)", () => {},
  { scope: 'engine renderer', lost: 'with no effect on, a texture background is not tone-mapped, so it changes when the first effect turns on' });
/**
 * draw() with three's background mesh tone-mapped. three resets material.toneMapped of that mesh in every render (before drawing it) and keeps
 * the mesh to itself, so it is found once in the render list (the background is unshifted to opaque[0]) and given an onBeforeRender that turns
 * tone mapping on while post._toneBg is set: three picks the program after onBeforeRender, so the switch costs one program, not one a frame.
 * The first draw that finds the mesh is drawn again so even the first frame matches. Only here: the composer renders into a target (never
 * tone-mapped there) and a game's own renderer.render keeps three's rule.
 */
function toneBackground(post, draw) {
  const r = post.engine.renderer;
  post._toneBg = true;
  try {
    draw();
    const m = r.renderLists.get(post.engine.scene, 0).opaque[0]?.object;
    if (!m || !BG_MATERIALS.includes(m.material?.name) || post._bgMeshes.has(m)) return;
    post._bgMeshes.add(m);
    const before = m.onBeforeRender;
    m.onBeforeRender = function (...a) { before.apply(this, a); if (post._toneBg && patchOn('post-background-tone')) this.material.toneMapped = true; };
    draw();
  } finally { post._toneBg = false; }
}

export const webglPost = {
  /** @param {any} post */
  init(post) {
    /** @internal */ post._fused = /** @type {Map<string, FusedPass>} */ (new Map()); post._scenePass = null; post._output = null;
    /** @internal three's background meshes already hooked (toneBackground) */ post._bgMeshes = new WeakSet(); post._toneBg = false;
  },
  object: post => post.composer,
  targets(post) {
    const c = post.composer;
    // a fresh frozen object each call: reassigning a field here cannot swap the composer's own buffers
    return c ? Object.freeze({ renderTarget1: c.renderTarget1, renderTarget2: c.renderTarget2, readBuffer: c.readBuffer, writeBuffer: c.writeBuffer }) : null;
  },
  /** a fuse effect's params changed: its fused pass re-reads the values (uniforms, no recompile) */
  refresh(post) { for (const p of post._fused.values()) p.refresh(); },
  samples: post => (post.active ? post.composer?.renderTarget1.samples ?? (post._aa ? MSAA_SAMPLES : 0) : post._ownAA ? MSAA_SAMPLES : 0),
  setAntialias(post, on) {
    if (post.composer) for (const rt of [post.composer.renderTarget1, post.composer.renderTarget2]) { rt.samples = on ? MSAA_SAMPLES : 0; rt.dispose(); }
  },
  // Rebuild the pass chain from the list: scene (or the default RenderPass) -> hdr -> tone (or the default OutputPass) -> ldr -> final.
  // Only enabled effects are in the chain; an implementation is built the first time its effect is on and kept after.
  sync(post) {
    const { renderer, scene, camera } = post.engine, size = post._size();
    if (!post.composer) {
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: post._aa ? MSAA_SAMPLES : 0 });
      post.composer = new EffectComposer(renderer, rt);
      // EffectComposer takes a given target's size (device pixels) as its CSS size; reset it so setPixelRatio does not scale twice
      const css = renderer.getSize(new THREE.Vector2());
      post.composer.setSize(css.x, css.y);
      post._scenePass = new RenderPass(scene, camera);
      post._output = new OutputPass();
    }
    const c = post.composer, on = post._sorted().filter(e => e.enabled);
    for (const e of on) if (!e._impl && !e._def.fuse) {
      if (typeof e._def.create !== 'function') throw codedError('post-effect', `post effect '${e.name}' has only node() (a TSL node, WebGPURenderer only) and this game chose WebGLRenderer: use createEngine({ renderer: 'webgpu' }), or give it create: (ctx) => pass (a three.js postprocessing Pass)`);
      e._impl = e._def.create({ engine: post.engine, scene, camera, width: size.x, height: size.y, params: e.params });
      if (!e._impl || typeof e._impl.render !== 'function') { e._impl = null; throw codedError('post-effect', `post effect '${e.name}': create() must return a pass with render() (a three.js postprocessing Pass)`); }
    }
    const used = new Set();
    const slot = s => groupFuse(on.filter(e => e.slot === s)).map(g => Array.isArray(g) ? fuseEntry(post, g, used) : g);
    const named = [slot('scene')[0] ?? { name: 'scene render', _impl: post._scenePass }, ...slot('hdr'),
      slot('tone')[0] ?? { name: 'output (tone mapping)', _impl: post._output }, ...slot('ldr'), ...slot('final')];
    for (const [k, p] of post._fused) if (!used.has(k)) { p.dispose(); post._fused.delete(k); }
    checkDepthOrder(named);
    // Effects reading depth (outline) need a depth texture on both ping-pong targets; added once, kept
    if (on.some(e => e._def.needsDepth)) for (const rt of [c.renderTarget1, c.renderTarget2]) if (!rt.depthTexture) { rt.depthTexture = new THREE.DepthTexture(size.x, size.y); rt.dispose(); }
    c.passes = named.map(e => e._impl);
    holdAfterScene(post, c.passes[0]);
    for (const p of c.passes) p.setSize(size.x, size.y);
    // nothing on and the canvas's own MSAA in use: the frame draws straight to the canvas, so the targets give their memory back (over 200 MB at 1080p with MSAA); three allocates them again on the next use
    if (!post.active) for (const rt of [c.renderTarget1, c.renderTarget2]) rt.dispose();
  },
  dispose(post) {
    for (const p of post._fused.values()) p.dispose();
    post._fused.clear();
    post._bgTex?.dispose(); post._bgTex = null;
    if (!post.composer) return;
    post._scenePass.dispose(); post._output.dispose();
    post.composer.dispose(); post.composer = null;
  },
  sceneTarget(post) {
    if (!post.composer) post._sync();
    return post.composer?.renderTarget1 ?? null;   // RenderPass draws into readBuffer, which is renderTarget1 or its twin (same format: same program key)
  },
  render(post, dt, target = null) {
    if (!post.composer) post._sync();
    follow(post);
    if (target) { toTarget(post, dt, target); return; }
    // no background: RenderPass clears the half-float target with whatever clear value three last set, which after the previous frame's
    // OutputPass is the clear color converted for the canvas (sRGB), not linear, so OutputPass tone-maps the wrong value. The clear color as a
    // Color background for this render makes three set the linear value and clear with it (the same pixel a Color background gives)
    const s = post.engine.scene, c = s.background == null && post._clearColor();
    if (!c) { composerRender(post, dt); return; }
    s.background = c;
    try { composerRender(post, dt); } finally { s.background = null; }
  },
  /**
   * The straight-to-canvas render. A THREE.Color scene.background, and with no background the renderer's clear color, is a clear,
   * and three never tone-maps a clear, while the composer path tone-maps everything in its OutputPass: the sky color shifted whenever an effect
   * or MSAA switched on. Here such a background is drawn for this one render as a 1x1 linear texture, which three draws as a tone-mapped quad,
   * so both paths show the same pixel (render() fixes the composer side of a missing background). Not for a see-through clear (clear alpha < 1: the quad would make the canvas opaque) or when the game
   * clears itself (autoClear off). A texture background: an sRGB one is drawn untone-mapped on the canvas by three's own rule (WebGLBackground
   * sets toneMapped from the texture's color space every frame) and tone-mapped by OutputPass and by WebGPURenderer, so a skybox photo changed
   * brightness when MSAA or an effect switched; toneBackground turns tone mapping on for it here. A linear (HDR) one agrees as it is.
   * Why not always render through the composer: that costs a half-float target and a fullscreen pass on every page that has no effects.
   */
  direct(post, target = null) {
    const { renderer: r, scene: s, camera } = post.engine, bg = s.background;
    // a render target gets the scene as three draws into one (linear, no tone mapping); post.active is what gives the canvas's pixels
    if (target) { const prev = r.getRenderTarget(); r.setRenderTarget(target); try { r.render(s, camera); } finally { r.setRenderTarget(prev); } return; }
    if (r.toneMapping !== THREE.NoToneMapping && bg?.isTexture && THREE.ColorManagement.getTransfer(bg.colorSpace) === THREE.SRGBTransfer) {
      toneBackground(post, () => r.render(s, camera)); return;
    }
    // a Color background only while three's clear would paint it: with autoClear off three still clears for a Color, depth too, which the quad would not
    const col = bg?.isColor ? (r.autoClear && r.autoClearColor ? bg : null) : bg == null ? post._clearColor() : null;
    if (!col || r.toneMapping === THREE.NoToneMapping) { r.render(s, camera); return; }
    const t = post._bgTex ??= Object.assign(new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType), { colorSpace: THREE.LinearSRGBColorSpace });
    const d = t.image.data;
    if (d[0] !== col.r || d[1] !== col.g || d[2] !== col.b || d[3] !== 1) { d.set([col.r, col.g, col.b, 1]); t.needsUpdate = true; }
    const bi = s.backgroundIntensity;   // a clear ignores backgroundIntensity; the texture would not
    s.background = t; s.backgroundIntensity = 1;
    try { r.render(s, camera); } finally { s.background = bg; s.backgroundIntensity = bi; }
  },
};

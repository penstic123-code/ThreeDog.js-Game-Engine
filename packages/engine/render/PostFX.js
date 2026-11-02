// Post-processing as an ordered list of named effects in four slots. The engine owns no look of its own here: bloom, AO and
// outline are effects a style registers (they come from @threedog/post-effects); games add theirs with look.post.replace([...]).
// An effect promises only a name, params and on/off; how it draws is its create() (a three.js Pass under WebGLRenderer),
// so a WebGPU backend can later bring its own implementation without changing callers.
//
// Why EffectComposer and not three 0.187's renderer.setEffects(): setEffects fixes MSAA when the renderer is created (no
// runtime switch for the settings menu) and always tone-maps last, so there is no place for sRGB-space effects (LUT, palette
// quantising, paper grain). The composer stays an internal detail; nothing public returns it.
//
// MSAA lives in the composer's render targets, so it survives any effect and can be switched at runtime. With nothing on
// (antialias included) the scene renders straight to the canvas and nothing is allocated (a Color background or the clear color is drawn tone-mapped there too: _direct).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { warnMissing, warnOnce } from '../core/validate.js';
import { FusedPass, groupFuse, checkDepthOrder } from './fuse.js';
import { definePostLook } from './postLook.js';
import { codedError } from '../core/errorHints.js';
/** @import { Engine } from '../types/core' */

/**
 * @typedef {'scene' | 'hdr' | 'ldr' | 'final'} PostSlot
 *   scene: replaces the scene render (one at a time, e.g. a pixelating render); hdr: linear color before tone mapping (bloom, AO,
 *   outline); ldr: sRGB color after tone mapping (LUT, palette, grain, vignette); final: last of all (FXAA / SMAA).
 * @typedef {{ engine: Engine, scene: import('three').Scene, camera: import('three').Camera, width: number, height: number, params: Record<string, any> }} PostContext
 *   width / height are in device pixels.
 * @typedef {{ uniforms?: Record<string, string>, values?: (params: Record<string, any>) => Record<string, any>, glsl: string, reads?: boolean }} PostFuse
 *   A GLSL snippet that colors the pixel; neighboring effects with a fuse run as ONE fullscreen pass. glsl is statements that edit
 *   `vec4 color` (the input pixel so far) and may use vUv, tDiffuse, uTime (s), uResolution (device px) and fxHash(vec2). uniforms
 *   declares extra ones by GLSL type ({ uVigStrength: 'float' }; names must be unique across effects, prefix with the effect name);
 *   values(params) returns their current values. reads: true when the snippet samples tDiffuse at other uvs (blur, color fringe):
 *   it then starts a new group, so it sees the real input.
 * @typedef {{ name: string, create?: (ctx: PostContext) => object, fuse?: PostFuse, slot?: PostSlot, order?: number, enabled?: boolean, costly?: boolean,
 *   needsDepth?: boolean, params?: Record<string, any>, update?: (impl: any, params: Record<string, any>) => void }} PostEffect
 *   create: builds the implementation the first time the effect is on (WebGL: a three.js postprocessing Pass); optional when fuse is given.
 *   fuse: see PostFuse; effects with a fuse in the same slot next to each other are merged (never in slot 'scene'), their params
 *   update in place (no update() needed).
 *   order: position inside the slot, low first (ties keep add order). costly: off by default on low-tier devices.
 *   needsDepth: the scene's depth texture is kept for it (readBuffer.depthTexture). Only the buffer the scene render wrote holds
 *   scene depth, so a depth reader must run before any pass that swaps buffers (needsSwap, e.g. a ShaderPass, a scene-slot
 *   RenderPixelatedPass, or the tone-mapping output); the chain throws when it would not. A pass that writes the scene depth into its own output (gl_FragDepth, then set pass.keepsDepth = true; dof does) does not count as a swap. update: apply new params in place;
 *   without it set() rebuilds the implementation.
 * @typedef {{ readonly name: string, readonly slot: PostSlot, readonly order: number, readonly enabled: boolean,
 *   readonly params: Record<string, any> }} PostHandle
 */

const SLOTS = ['scene', 'hdr', 'ldr', 'final'];

export class PostFX {
  /**
   * @param {Engine} engine
   * @param {{ antialias?: boolean, effects?: PostEffect[], enabled?: Record<string, boolean> }} [opts]
   * @internal
   */
  constructor(engine, { antialias = true, effects = [], enabled = {} } = {}) {
    /** @internal */ this.engine = engine;
    /** @internal */ this._aa = antialias;
    /** @internal */ this._list = /** @type {any[]} */ ([]);
    /** @internal EffectComposer, built the first time anything is on */ this.composer = /** @type {any} */ (null);
    if (!Array.isArray(effects)) throw codedError('post-effect', 'style.post must be an array of post effects, e.g. post: [bloom({ strength: 0.35 })] (see recipe 09)');
    for (const name in enabled) if (!effects.some(e => e?.name === name))
      throw codedError('post-effect', `createEngine({ post }): no post effect named '${name}'; the style registers: ${effects.map(e => e.name).join(', ') || 'none'}`);
    /** @internal */ this._fused = /** @type {Map<string, FusedPass>} */ (new Map());
    /** @internal */ this._scenePass = /** @type {any} */ (null);
    /** @internal */ this._output = /** @type {any} */ (null);
    /** @internal */ this._building = true;     // add() skips chain rebuilds until every style effect is in
    /** Why a costly effect started off (name -> reason), shown by describe().render and logged once: a silent "bloom is missing" in headless / software rendering looked like a bug @internal */
    this._offWhy = /** @type {Record<string, string>} */ ({});
    for (const e of effects) {
      const lowOff = enabled[e.name] == null && e.costly && engine.tier === 'low';
      if (lowOff) this._offWhy[e.name] = `starts off: costly effect on a low-tier device (${engine.headless ? 'this headless page runs at the low tier: shot --tier high renders it' : 'weak GPU or software rendering'}); turn it on with createEngine({ post: { ${e.name}: true } }) or engine.look.post.set({ '${e.name}.enabled': true })`;
      this._add(e, { enabled: enabled[e.name] ?? (lowOff ? false : undefined) });
    }
    const why = Object.entries(this._offWhy);
    if (why.length) warnOnce(`post: ${why.map(([n]) => n).join(', ')} ${why.length > 1 ? 'are' : 'is'} off by default here. ${why[0][1]}`);
    this._building = false;
    this._sync();
    /** look.post: the style's effects are its style layer; look.post.set writes its 'game' layer @internal */ this._look = definePostLook(this, effects);
  }

  /**
   * MSAA on (read-only; switch with post.setAntialias(on))
   * @returns {boolean}
   */
  get antialias() { return this._aa; }
  /**
   * Whether any post work runs (antialias or an enabled effect)
   * @returns {boolean}
   */
  get active() { return this._aa || this._list.some(e => e.enabled); }

  /**
   * The three.js EffectComposer the chain runs in, for reading (pass list, sizes, its targets), or null while no post work has run yet (built
   * the first time an effect or MSAA is on; it is not built here, so asking never costs a half-float target). Read-only by rule, not by lock:
   * the engine owns it, rebuilds composer.passes whenever the chain changes and disposes it with the engine. To add a pass use look.post.add,
   * to own the whole chain look.post.replace (recipe 52). Why public: a game reading the chain had to dig into an internal field (review 2026-11-03)
   * @returns {any}
   */
  object() { return this.composer; }
  /**
   * The composer's render targets, for reading (sample the last frame's color or depth in a game pass, check formats / samples), or null while
   * there is no composer. renderTarget1 / renderTarget2 are the ping-pong pair. During the chain readBuffer is a pass's input and writeBuffer its
   * output; EffectComposer swaps them after every pass with needsSwap (most passes; the scene RenderPass does not). The last pass draws to the
   * canvas and still swaps, so after the frame (engine.onRender(fn, { when: 'after' })) neither target holds the final picture: writeBuffer holds
   * the input of that last pass (readBuffer when the last pass does not swap) and readBuffer is stale. For the final image, render into a target of your own.
   * Owned by the engine like object(): it resizes them, changes samples on setAntialias and adds a depth texture when an effect needs depth;
   * do not dispose them or swap their textures. A target of your own: new THREE.WebGLRenderTarget in onRender (recipe 54)
   * @returns {{ renderTarget1: any, renderTarget2: any, readBuffer: any, writeBuffer: any } | null}
   */
  targets() {
    const c = this.composer;
    // a fresh frozen object each call: reassigning a field here cannot swap the composer's own buffers
    return c ? Object.freeze({ renderTarget1: c.renderTarget1, renderTarget2: c.renderTarget2, readBuffer: c.readBuffer, writeBuffer: c.writeBuffer }) : null;
  }

  /** Effects are added by look.post (patch generates a fuse effect, replace swaps the chain) with this @internal */
  _add(effect, { slot, order, enabled } = {}) {
    if (!effect || typeof effect.name !== 'string' || (typeof effect.create !== 'function' && !effect.fuse))
      throw codedError('post-effect', "post effect: needs { name: 'myEffect', create: (ctx) => pass } (or a fuse snippet, see PostEffect)");
    if (this.get(effect.name)) throw codedError('post-effect', `post effect '${effect.name}' is already added; change it with look.post.set({ '${effect.name}.<param>': value }), or drop it with look.post.replace([...])`);
    const s = slot ?? effect.slot ?? 'hdr';
    if (!SLOTS.includes(s)) throw codedError('post-effect', `post effect '${effect.name}': unknown slot '${s}', use ${SLOTS.join(' | ')}`);
    if (effect.fuse && s === 'scene') throw codedError('post-effect', `post effect '${effect.name}': a fuse snippet colors an existing image, it cannot replace the scene render; use slot 'hdr' | 'ldr' | 'final'`);
    const other = s === 'scene' && this._list.find(e => e.slot === 'scene');
    if (other) throw codedError('post-effect', `post slot 'scene' already holds '${other.name}'; remove it first (only one effect can replace the scene render)`);
    const post = this;
    const h = {
      name: effect.name, slot: s, order: order ?? effect.order ?? 0, enabled: enabled ?? effect.enabled ?? true,
      params: { ...effect.params }, _def: effect, _impl: /** @type {any} */ (null), _removed: false,
      _enable(on) { const was = h.enabled; post._change(() => { h.enabled = !!on; }, () => { h.enabled = was; }); },
      _set(p) {
        Object.assign(h.params, p);
        if (effect.fuse) { for (const p of post._fused.values()) p.refresh(); return; }
        if (!h._impl) return;
        if (effect.update) effect.update(h._impl, h.params); else { h._impl.dispose?.(); h._impl = null; post._sync(); }
      },
      _remove() {
        if (h._removed) return;
        h._removed = true; h._impl?.dispose?.(); h._impl = null;
        post._list = post._list.filter(e => e !== h); post._sync();
      },
    };
    // a create() that throws or an order that breaks depth leaves no half-added effect behind
    this._change(() => this._list.push(h), () => { h._impl?.dispose?.(); h._impl = null; this._list = this._list.filter(e => e !== h); });
    return h;
  }
  /**
   * Read-only record of an added effect (name, slot, order, enabled, params), or undefined. Change one with engine.look.post.set({ 'bloom.strength': 0.6 })
   * @param {string} name
   * @returns {PostHandle | undefined}
   * @experimental
   */
  get(name) { return this._list.find(e => e.name === name); }
  /**
   * Turn MSAA (antialiasing of the post chain) on or off. It is a render target setting, not a look part.
   * @example engine.post.setAntialias(false);
   * @param {boolean} on
   * @returns {void}
   * @experimental
   */
  setAntialias(on) {
    this._aa = !!on;
    if (this.composer) for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) { rt.samples = on ? 4 : 0; rt.dispose(); }
    this._sync();
  }
  /**
   * Effects in render order: [{ name, slot, order, enabled }]
   * @returns {{ name: string, slot: PostSlot, order: number, enabled: boolean }[]}
   * @experimental
   */
  list() { return this._sorted().map(({ name, slot, order, enabled }) => ({ name, slot, order, enabled })); }

  /** @internal */
  _sorted() { return SLOTS.flatMap(s => this._list.filter(e => e.slot === s).sort((a, b) => a.order - b.order)); }
  /** @internal */
  _size() { return this.engine.renderer.getSize(new THREE.Vector2()).multiplyScalar(this.engine.renderer.getPixelRatio()); }
  /** Apply a list change, rebuild the chain, and undo the change when the rebuild throws (then rethrow) @internal */
  _change(apply, undo) {
    apply();
    try { this._sync(); } catch (err) { undo(); this._sync(); throw err; }
  }
  // One FusedPass per group of neighboring fuse effects, kept while the same effects stay grouped (a changed group recompiles once)
  /** @internal */
  _fuseEntry(group, used) {
    const key = group.map(e => e.name).join('+'), old = this._fused.get(key);
    let pass = old && old.items.every((e, i) => e === group[i]) ? old : null;
    if (!pass) { old?.dispose(); pass = new FusedPass(group); this._fused.set(key, pass); }
    used.add(key);
    return { name: `fused(${key})`, _impl: pass };
  }
  // Rebuild the pass chain from the list: scene (or the default RenderPass) -> hdr -> tone-mapped output -> ldr -> final.
  // Only enabled effects are in the chain; an implementation is built the first time its effect is on and kept after.
  /** @internal */
  _sync() {
    if (this._building || (!this.composer && !this.active)) return;
    const { renderer, scene, camera } = this.engine, size = this._size();
    if (!this.composer) {
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this._aa ? 4 : 0 });
      this.composer = new EffectComposer(renderer, rt);
      // EffectComposer takes a given target's size (device pixels) as its CSS size; reset it so setPixelRatio does not scale twice
      const css = renderer.getSize(new THREE.Vector2());
      this.composer.setSize(css.x, css.y);
      this._scenePass = new RenderPass(scene, camera);
      this._output = new OutputPass();
    }
    const c = this.composer, on = this._sorted().filter(e => e.enabled);
    for (const e of on) if (!e._impl && !e._def.fuse) {
      e._impl = e._def.create({ engine: this.engine, scene, camera, width: size.x, height: size.y, params: e.params });
      if (!e._impl || typeof e._impl.render !== 'function') { e._impl = null; throw codedError('post-effect', `post effect '${e.name}': create() must return a pass with render() (a three.js postprocessing Pass)`); }
    }
    const used = new Set();
    const slot = s => groupFuse(on.filter(e => e.slot === s)).map(g => Array.isArray(g) ? this._fuseEntry(g, used) : g);
    const named = [slot('scene')[0] ?? { name: 'scene render', _impl: this._scenePass }, ...slot('hdr'),
      { name: 'output (tone mapping)', _impl: this._output }, ...slot('ldr'), ...slot('final')];
    for (const [k, p] of this._fused) if (!used.has(k)) { p.dispose(); this._fused.delete(k); }
    checkDepthOrder(named);
    // Effects reading depth (outline) need a depth texture on both ping-pong targets; added once, kept
    if (on.some(e => e._def.needsDepth)) for (const rt of [c.renderTarget1, c.renderTarget2]) if (!rt.depthTexture) { rt.depthTexture = new THREE.DepthTexture(size.x, size.y); rt.dispose(); }
    c.passes = named.map(e => e._impl);
    for (const p of c.passes) p.setSize(size.x, size.y);
  }

  /**
   * Dispose the composer, every effect and the render targets (called by engine.dispose)
   * @internal
   */
  dispose() {
    for (const e of this._list) { e._impl?.dispose?.(); e._impl = null; }
    for (const p of this._fused.values()) p.dispose();
    this._fused.clear();
    this._bgTex?.dispose(); this._bgTex = null;
    if (!this.composer) return;
    this._scenePass.dispose(); this._output.dispose();
    this.composer.dispose(); this.composer = null;
  }
  /** @param {number} w @param {number} h @returns {void} */
  setSize(w, h) { this.composer?.setSize(w, h); }
  /** @param {number} r @returns {void} */
  setPixelRatio(r) { this.composer?.setPixelRatio(r); }
  /**
   * @internal The target the scene is drawn into this frame, for start()'s compileAsync: three keys a program by its output (the canvas gets tone
   * mapping + sRGB, a render target gets neither), so compiling for the canvas while the composer draws into its half-float target compiled
   * variants no frame used and the first frame compiled everything again. Builds the composer now when post is on; null when drawing straight to the canvas.
   * @returns {any}
   */
  _sceneTarget() {
    if (!this.active) return null;
    if (!this.composer) this._sync();
    return this.composer?.renderTarget1 ?? null;   // RenderPass draws into readBuffer, which is renderTarget1 or its twin (same format: same program key)
  }
  /** @param {number} dt @returns {void} */
  render(dt) {
    if (!this.active) { this._direct(); return; }
    if (!this.composer) this._sync();
    // no background: RenderPass clears the half-float target with whatever clear value three last set, which after the previous frame's
    // OutputPass is the clear color converted for the canvas (sRGB), not linear, so OutputPass tone-maps the wrong value. The clear color as a
    // Color background for this render makes three set the linear value and clear with it (the same pixel a Color background gives)
    const s = this.engine.scene, c = s.background == null && this._clearColor();
    if (!c) { this.composer.render(dt); return; }
    s.background = c;
    try { this.composer.render(dt); } finally { s.background = null; }
  }
  /** @internal The renderer's clear color when it stands in for a missing background: opaque and cleared by three (not the game), else null */
  _clearColor() {
    const r = this.engine.renderer;
    return r.autoClear && r.autoClearColor && r.getClearAlpha() === 1 ? r.getClearColor(this._clear ??= new THREE.Color()) : null;
  }
  /**
   * @internal The straight-to-canvas render. A THREE.Color scene.background, and with no background the renderer's clear color, is a clear,
   * and three never tone-maps a clear, while the composer path tone-maps everything in its OutputPass: the sky color shifted whenever an effect
   * or MSAA switched on. Here such a background is drawn for this one render as a 1x1 linear texture, which three draws as a tone-mapped quad,
   * so both paths show the same pixel (render() fixes the composer side of a missing background). Not for a see-through clear (clear alpha < 1: the quad would make the canvas opaque) or when the game
   * clears itself (autoClear off). Not for a texture background either: an sRGB one is drawn untone-mapped on the canvas by three's own rule
   * (WebGLBackground sets toneMapped from the texture's color space every frame) and tone-mapped by OutputPass; a linear (HDR) one agrees.
   * Why not always render through the composer: that costs a half-float target and a fullscreen pass on every page that has no effects (low-end devices).
   */
  _direct() {
    const { renderer: r, scene: s, camera } = this.engine, bg = s.background;
    const col = bg?.isColor ? bg : bg == null ? this._clearColor() : null;
    if (!col || r.toneMapping === THREE.NoToneMapping) { r.render(s, camera); return; }
    const t = this._bgTex ??= Object.assign(new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType), { colorSpace: THREE.LinearSRGBColorSpace });
    const d = t.image.data;
    if (d[0] !== col.r || d[1] !== col.g || d[2] !== col.b || d[3] !== 1) { d.set([col.r, col.g, col.b, 1]); t.needsUpdate = true; }
    const bi = s.backgroundIntensity;   // a clear ignores backgroundIntensity; the texture would not
    s.background = t; s.backgroundIntensity = 1;
    try { r.render(s, camera); } finally { s.background = bg; s.backgroundIntensity = bi; }
  }
}

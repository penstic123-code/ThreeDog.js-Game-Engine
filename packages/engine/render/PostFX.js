// Post-processing as an ordered list of named effects in four slots. The engine owns no look of its own here: bloom, AO and
// outline are effects a style pack registers (see styles/lowpoly/post.js); games add theirs with engine.post.add().
// An effect promises only a name, params and on/off; how it draws is its create() (a three.js Pass under WebGLRenderer),
// so a WebGPU backend can later bring its own implementation without changing callers.
//
// Why EffectComposer and not three 0.187's renderer.setEffects(): setEffects fixes MSAA when the renderer is created (no
// runtime switch for the settings menu) and always tone-maps last, so there is no place for sRGB-space effects (LUT, palette
// quantising, paper grain). The composer stays an internal detail; nothing public returns it.
//
// MSAA lives in the composer's render targets, so it survives any effect and can be switched at runtime. With nothing on
// (antialias included) the scene renders straight to the canvas and nothing is allocated.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { warnMissing } from '../core/validate.js';
/** @import { Engine } from '../types/core' */

/**
 * @typedef {'scene' | 'hdr' | 'ldr' | 'final'} PostSlot
 *   scene: replaces the scene render (one at a time, e.g. a pixelating render); hdr: linear color before tone mapping (bloom, AO,
 *   outline); ldr: sRGB color after tone mapping (LUT, palette, grain, vignette); final: last of all (FXAA / SMAA).
 * @typedef {{ engine: Engine, scene: import('three').Scene, camera: import('three').Camera, width: number, height: number, params: Record<string, any> }} PostContext
 *   width / height are in device pixels.
 * @typedef {{ name: string, create: (ctx: PostContext) => object, slot?: PostSlot, order?: number, enabled?: boolean, costly?: boolean,
 *   needsDepth?: boolean, params?: Record<string, any>, update?: (impl: any, params: Record<string, any>) => void }} PostEffect
 *   create: builds the implementation the first time the effect is on (WebGL: a three.js postprocessing Pass).
 *   order: position inside the slot, low first (ties keep add order). costly: off by default on low-tier devices.
 *   needsDepth: the scene's depth texture is kept for it (readBuffer.depthTexture). Only the buffer the scene render wrote holds
 *   scene depth, so a depth reader must run before any pass that swaps buffers (needsSwap, e.g. a ShaderPass, a scene-slot
 *   RenderPixelatedPass, or the tone-mapping output); the chain throws when it would not. update: apply new params in place;
 *   without it set() rebuilds the implementation.
 * @typedef {{ readonly name: string, readonly slot: PostSlot, readonly order: number, readonly enabled: boolean,
 *   readonly params: Record<string, any>, enable(on: boolean): void, set(params: Record<string, any>): void, remove(): void }} PostHandle
 */

const SLOTS = ['scene', 'hdr', 'ldr', 'final'];

// Only the buffer the scene render wrote holds scene depth: after a pass that swaps buffers, readBuffer.depthTexture is another
// target's (a fullscreen quad's, or stale). A depth reader behind such a pass would silently find nothing, so the chain refuses it.
function checkDepthOrder(chain) {
  let swapped = null;
  for (const e of chain) {
    if (e._def?.needsDepth && swapped)
      throw new Error(`post effect '${e.name}' reads scene depth (needsDepth) but runs after '${swapped}', which swaps buffers, so the depth it would read is not the scene's; ` +
        `give '${e.name}' a lower order or an earlier slot than '${swapped}', or turn one of them off`);
    if (e._impl.needsSwap) swapped ??= e.name;
  }
}

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
    if (!Array.isArray(effects)) throw new Error('style.post must be an array of post effects, e.g. post: [bloom({ strength: 0.35 })] (see recipe 09)');
    for (const name in enabled) if (!effects.some(e => e?.name === name))
      throw new Error(`createEngine({ post }): no post effect named '${name}'; the style pack registers: ${effects.map(e => e.name).join(', ') || 'none'}`);
    /** @internal */ this._scenePass = /** @type {any} */ (null);
    /** @internal */ this._output = /** @type {any} */ (null);
    /** @internal */ this._building = true;     // add() skips chain rebuilds until every style effect is in
    for (const e of effects) this.add(e, { enabled: enabled[e.name] ?? (e.costly && engine.tier === 'low' ? false : undefined) });
    this._building = false;
    this._sync();
  }

  /**
   * MSAA on (read-only; switch with post.enable('antialias', on))
   * @returns {boolean}
   */
  get antialias() { return this._aa; }
  /**
   * Whether any post work runs (antialias or an enabled effect)
   * @returns {boolean}
   */
  get active() { return this._aa || this._list.some(e => e.enabled); }

  /**
   * Add a named effect; returns its handle. Slot and order come from the effect unless given here.
   * @example
   * import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
   * const pixels = engine.post.add({ name: 'pixelate', slot: 'scene', params: { size: 4 },
   *   create: ({ scene, camera, width, height, params }) => new RenderPixelatedPass(params.size, scene, camera),
   *   update: (pass, p) => pass.setPixelSize(p.size) });
   * pixels.set({ size: 6 }); pixels.enable(false); pixels.remove();
   * @param {PostEffect} effect
   * @param {{ slot?: PostSlot, order?: number, enabled?: boolean }} [opts]
   * @returns {PostHandle}
   */
  add(effect, { slot, order, enabled } = {}) {
    if (!effect || typeof effect.name !== 'string' || typeof effect.create !== 'function')
      throw new Error("post.add(effect): effect needs { name: 'myEffect', create: (ctx) => pass }");
    if (this.get(effect.name)) throw new Error(`post effect '${effect.name}' is already added; change it with post.get('${effect.name}').set(params), or remove() it first`);
    const s = slot ?? effect.slot ?? 'hdr';
    if (!SLOTS.includes(s)) throw new Error(`post effect '${effect.name}': unknown slot '${s}', use ${SLOTS.join(' | ')}`);
    const other = s === 'scene' && this._list.find(e => e.slot === 'scene');
    if (other) throw new Error(`post slot 'scene' already holds '${other.name}'; remove it first (only one effect can replace the scene render)`);
    const post = this;
    const h = {
      name: effect.name, slot: s, order: order ?? effect.order ?? 0, enabled: enabled ?? effect.enabled ?? true,
      params: { ...effect.params }, _def: effect, _impl: /** @type {any} */ (null), _removed: false,
      enable(on) { const was = h.enabled; post._change(() => { h.enabled = !!on; }, () => { h.enabled = was; }); },
      set(p) {
        Object.assign(h.params, p);
        if (!h._impl) return;
        if (effect.update) effect.update(h._impl, h.params); else { h._impl.dispose?.(); h._impl = null; post._sync(); }
      },
      remove() {
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
   * Handle of an added effect, or undefined: engine.post.get('bloom')?.set({ strength: 0.6 })
   * @param {string} name
   * @returns {PostHandle | undefined}
   */
  get(name) { return this._list.find(e => e.name === name); }
  /**
   * Turn an effect, or 'antialias' (MSAA), on or off; false (and a dev warning naming the effects) when no such effect is added
   * @example
   * engine.post.enable('bloom', false); engine.post.enable('antialias', true);
   * @param {string} name
   * @param {boolean} on
   * @returns {boolean}
   */
  enable(name, on) {
    if (name === 'antialias') {
      this._aa = !!on;
      if (this.composer) for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) { rt.samples = on ? 4 : 0; rt.dispose(); }
      this._sync();
      return true;
    }
    const h = this.get(name);
    if (!h) { warnMissing('post effect', name, ['antialias', ...this._list.map(e => e.name)]); return false; }
    h.enable(on);
    return true;
  }
  /**
   * Effects in render order: [{ name, slot, order, enabled }]
   * @returns {{ name: string, slot: PostSlot, order: number, enabled: boolean }[]}
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
    for (const e of on) if (!e._impl) {
      e._impl = e._def.create({ engine: this.engine, scene, camera, width: size.x, height: size.y, params: e.params });
      if (!e._impl || typeof e._impl.render !== 'function') { e._impl = null; throw new Error(`post effect '${e.name}': create() must return a pass with render() (a three.js postprocessing Pass)`); }
    }
    const slot = s => on.filter(e => e.slot === s);
    const named = [slot('scene')[0] ?? { name: 'scene render', _impl: this._scenePass }, ...slot('hdr'),
      { name: 'output (tone mapping)', _impl: this._output }, ...slot('ldr'), ...slot('final')];
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
    if (!this.composer) return;
    this._scenePass.dispose(); this._output.dispose();
    this.composer.dispose(); this.composer = null;
  }
  /** @param {number} w @param {number} h @returns {void} */
  setSize(w, h) { this.composer?.setSize(w, h); }
  /** @param {number} r @returns {void} */
  setPixelRatio(r) { this.composer?.setPixelRatio(r); }
  /** @param {number} dt @returns {void} */
  render(dt) {
    if (this.active) { if (!this.composer) this._sync(); this.composer.render(dt); }
    else this.engine.renderer.render(this.engine.scene, this.engine.camera);
  }
}

// Post effects in five slots (both renderers). One list for WebGL and WebGPU. The engine owns no look of its own here: bloom, AO and
// outline are effects a style's plugins bring (they come from @threedog/post-effects). Everything gets into the list through ONE call,
// engine.look.post.add (render/postLook.js): game code, the plugins folder and a style pack's plugins alike; look.post.replace swaps the list.
// An effect promises only a name, params and on/off; how it draws is its create() (a three.js Pass under WebGLRenderer) or its
// node() (a TSL node under WebGPURenderer), so callers never see which backend runs.
//
// This file is the backend-free part (list, slots, ownership); the chain itself is postWebGL.js (EffectComposer) or, on WebGPURenderer,
// render/fx/postWebGPU.tsl.js (RenderPipeline). Why the WebGPU side is looked up on a global and not imported: importing it here would put
// three/webgpu into every WebGL game's bundle; it registers itself when threedog/tsl loads, the way patchNodes.tsl.js does for patches,
// and stays synchronous (a dynamic import would leave the first frames without post and make _sync async).
import * as THREE from 'three';
import { webglPost } from './postWebGL.js';
import { definePostLook } from './postLook.js';
import { codedError } from '../core/errorHints.js';
import { isWebGPU, webgpuPart, ownMsaa } from './backend.js';
import { defineOwned } from '../core/owned.js';
import { watchOwnFrame } from './ownFrame.js';
/** @import { Engine } from '../types/core' */

/**
 * @typedef {'scene' | 'hdr' | 'tone' | 'ldr' | 'final'} PostSlot
 *   scene: replaces the scene render (one at a time, e.g. a pixelating render); hdr: linear color before tone mapping (bloom, AO,
 *   outline); tone: replaces the engine's tone-mapping output stage (one at a time: an own curve, a filmic grade; it receives linear HDR
 *   color and must output display color, tone mapped AND converted to the output color space, as three's OutputPass / renderOutput do);
 *   ldr: sRGB color after tone mapping (LUT, palette, grain, vignette); final: last of all (FXAA / SMAA).
 * @typedef {{ engine: Engine, scene: import('three').Scene, camera: import('three').Camera, width: number, height: number, params: Record<string, any> }} PostContext
 *   width / height are in device pixels.
 * @typedef {{ uniforms?: Record<string, string>, values?: (params: Record<string, any>) => Record<string, any>, glsl: string, reads?: boolean }} PostFuse
 *   A GLSL snippet that colors the pixel; neighboring effects with a fuse run as ONE fullscreen pass. glsl is statements that edit
 *   `vec4 color` (the input pixel so far) and may use vUv, tDiffuse, uTime (s), uResolution (device px) and fxHash(vec2). uniforms
 *   declares extra ones by GLSL type ({ uVigStrength: 'float' }; names must be unique across effects, prefix with the effect name);
 *   values(params) returns their current values. reads: true when the snippet samples tDiffuse at other uvs (blur, color fringe):
 *   it then starts a new group, so it sees the real input.
 *   tsl (WebGPURenderer): (color, uv, t) => color, the same snippet as a TSL expression on the vec4 color node; t holds tsl (three/tsl),
 *   p (a uniform node per number / color param, live: set() changes .value, no rebuild), input (the image so far, sample it at other uvs with
 *   t.input.sample(uv)), time (s), resolution (device px). Neighbors are chained into one node, so three draws them in one pass.
 * @typedef {{ engine: Engine, scene: import('three').Scene, camera: import('three').Camera, width: number, height: number, params: Record<string, any>,
 *   scenePass: any, tsl: any, display: Record<string, Function>, p: Record<string, any> }} PostNodeContext
 *   WebGPU only. scenePass: the scene's pass() node (.getTextureNode('depth'), getViewZNode() ...); tsl: three/tsl; display: three's display nodes
 *   (bloom, ao from three/addons/tsl/display) plus pass (an extra scene render) and texture (the color so far as a texture to sample at other uvs),
 *   handed in so effect packages never import three/webgpu themselves and so the nodes they make are disposed with the chain;
 *   p: live uniform nodes of the number / color params (as in PostFuse tsl), so set() of those never rebuilds the pipeline; a param read from
 *   ctx.params while node() runs is a constant in the graph, so set() of it rebuilds the chain (as WebGL rebuilds an effect without update()).
 * @typedef {{ name: string, create?: (ctx: PostContext) => object, node?: (input: any, ctx: PostNodeContext) => any, fuse?: PostFuse, slot?: PostSlot | (string & {}), order?: number, enabled?: boolean, costly?: boolean,
 *   needsDepth?: boolean, params?: Record<string, any>, update?: (impl: any, params: Record<string, any>) => void }} PostEffect
 *   node (WebGPURenderer): returns the effect's output color node built on input (the color node so far); called again only when a param
 *   that is not a number / color changes (those are live in ctx.p). An effect with only create cannot run on WebGPURenderer (it throws by name).
 *   create: builds the implementation the first time the effect is on (WebGL: a three.js postprocessing Pass); optional when fuse is given.
 *   fuse: see PostFuse; effects with a fuse in the same slot next to each other are merged (never in slot 'scene'), their params
 *   update in place (no update() needed).
 *   slot: a PostSlot; typed as any string too because a slot in a plain JS object (an effect returned from a function) is a string to
 *   TypeScript, and the chain throws on an unknown slot naming the valid ones.
 *   order: position inside the slot, low first (ties keep add order). costly: off by default on low-tier devices.
 *   needsDepth: the scene's depth texture is kept for it (readBuffer.depthTexture). Only the buffer the scene render wrote holds
 *   scene depth, so a depth reader must run before any pass that swaps buffers (needsSwap, e.g. a ShaderPass, a scene-slot
 *   RenderPixelatedPass, or the tone-mapping output); the chain throws when it would not. A pass that writes the scene depth into its own output (gl_FragDepth, then set pass.keepsDepth = true; dof does) does not count as a swap. update: apply new params in place;
 *   without it set() rebuilds the implementation.
 * @typedef {{ readonly name: string, readonly slot: PostSlot, readonly order: number, readonly enabled: boolean,
 *   readonly params: Record<string, any> }} PostHandle
 */

const SLOTS = ['scene', 'hdr', 'tone', 'ldr', 'final'];
// slots one effect at a time: each replaces an engine stage (the scene render, the tone-mapping output), two replacements of one stage cannot both run
const EXCLUSIVE = { scene: 'replace the scene render', tone: 'replace the tone-mapping output' };

export class PostFX {
  /**
   * @param {Engine} engine
   * @param {{ antialias?: boolean, effects?: PostEffect[], enabled?: Record<string, boolean> }} [opts]
   * @internal
   */
  constructor(engine, { antialias = true } = {}) {
    /** @internal */ this.engine = engine;
    /** @internal */ this._aa = antialias;
    /** @internal */ this._list = /** @type {any[]} */ ([]);
    /** @internal EffectComposer, built the first time anything is on */ this.composer = /** @type {any} */ (null);
    /** @internal the chain's backend: postWebGL.js, or the WebGPU one threedog/tsl registers */ this._be = backendFor(engine.renderer);
    /** @internal the renderer's own MSAA on its canvas (fixed when it was made; the engine makes it with the default antialias) */ this._ownAA = ownMsaa(engine.renderer);
    this._be.init(this);
    /** @internal */ this._building = false;    // look.post.replace sets it while it swaps the list, so the chain is rebuilt once
    /** Why a costly effect started off (name -> reason), shown by describe().render and logged once: a silent "bloom is missing" in headless / software rendering looked like a bug @internal */
    this._offWhy = /** @type {Record<string, string>} */ ({});
    watchOwnFrame(engine);   // a game that renders the canvas itself (own EffectComposer) takes the frame; the loop yields (ownFrame.js)
    // look.post.manual(): the game takes the built chain (composer passes / pipeline.outputNode) and the engine stops rebuilding it; handing it
    // back rebuilds from the list. read is a constant: a direct write to object() is not a takeover (the next chain change replaces it)
    /** @internal */ this._own = defineOwned(engine, { id: 'post.chain', part: 'post', key: 'chain', read: () => 0,
      levels: { manual: "engine.look.post.manual('chain')" }, onChange: o => { if (!o.on) return; if (this._pipe) this._pipe.key = null; this._sync(); } });
    this._sync();
    // look.post.add is the one way an effect gets here (game code, the plugins folder, a style pack's plugins): render/postLook.js
    /** @internal */ this._look = definePostLook(this);
  }

  /**
   * MSAA on (read-only; switch with post.setAntialias(on))
   * @returns {boolean}
   */
  get antialias() { return this._aa; }
  /**
   * Whether the post chain runs: an effect is on, or antialias differs from the canvas's own MSAA (fixed when the renderer was made, so a
   * runtime switch away from it goes through the chain's targets)
   * @returns {boolean}
   */
  get active() { return this._aa !== this._ownAA || this._list.some(e => e.enabled); }

  /**
   * The three.js EffectComposer the chain runs in, for reading (pass list, sizes, its targets), or null while no post work has run yet (built
   * the first time an effect or MSAA is on; it is not built here, so asking never costs a half-float target). Read-only by rule, not by lock:
   * the engine owns it, rebuilds composer.passes whenever the chain changes and disposes it with the engine. To add a pass use look.post.add,
   * to own the whole chain look.post.replace (recipe 52). Why public: a game reading the chain had to dig into an internal field (review 2026-11-03)
   * @returns {any}
   */
  object() { return this._be.object(this); }
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
  targets() { return this._be.targets(this); }

  /** Effects are added by look.post (patch generates a fuse effect, replace swaps the chain) with this @internal */
  _add(effect, { slot, order, enabled } = {}) {
    if (!effect || typeof effect.name !== 'string' || (typeof effect.create !== 'function' && typeof effect.node !== 'function' && !effect.fuse))
      throw codedError('post-effect', "post effect: needs { name: 'myEffect', create: (ctx) => pass } (or a fuse snippet, see PostEffect)");
    if (this.get(effect.name)) throw codedError('post-effect', `post effect '${effect.name}' is already added; change it with look.post.set({ '${effect.name}.<param>': value }), or drop it with look.post.replace([...])`);
    const s = slot ?? effect.slot ?? 'hdr';
    if (!SLOTS.includes(s)) throw codedError('post-effect', `post effect '${effect.name}': unknown slot '${s}', use ${SLOTS.join(' | ')}`);
    if (effect.fuse && s === 'scene') throw codedError('post-effect', `post effect '${effect.name}': a fuse snippet colors an existing image, it cannot replace the scene render; use slot 'hdr' | 'ldr' | 'final'`);
    const other = s in EXCLUSIVE && this._list.find(e => e.slot === s);
    if (other) throw codedError('post-effect', `post slot '${s}' already holds '${other.name}'; remove it first (only one effect can ${EXCLUSIVE[s]})`);
    const post = this;
    const h = {
      name: effect.name, slot: s, order: order ?? effect.order ?? 0, enabled: enabled ?? effect.enabled ?? true,
      params: { ...effect.params }, _def: effect, _impl: /** @type {any} */ (null), _removed: false,
      _enable(on) { const was = h.enabled; post._change(() => { h.enabled = !!on; }, () => { h.enabled = was; }); },
      _set(p) {
        Object.assign(h.params, p);
        if (post._be.set?.(post, h, p)) return;   // WebGPU: live uniforms, or a rebuild of the node graph
        if (effect.fuse) { post._be.refresh(post, h); return; }
        if (!h._impl) return;
        if (effect.update) effect.update(h._impl, h.params); else { h._impl.dispose?.(); h._impl = null; post._sync(); }
      },
      _remove() {
        if (h._removed) return;
        h._removed = true;
        // a plain Pass the game handed in is the game's object: like three's composer.removePass it is not disposed. Only that case: on WebGPU
        // _impl is the engine's record of the nodes it built (bloom's mip targets), and skipping it leaked them on every off / on
        if (h._impl !== effect._pass) h._impl?.dispose?.();
        h._impl = null;
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
   * Turn MSAA on or off. It is a render setting, not a look part. With no effect on, the start value is the canvas's own MSAA (free: no
   * post chain); the other value, and any effect, draws through the chain, whose render targets carry the MSAA.
   * @example engine.post.setAntialias(false);
   * @param {boolean} on
   * @returns {void}
   * @experimental
   */
  setAntialias(on) {
    this._aa = !!on;
    this._be.setAntialias(this, this._aa);
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
  // Rebuild the chain from the list (the backend does it); skipped while the style's effects are still being added
  /** @internal */
  _sync() {
    if (this._building || (!this.composer && !this._pipe && !this.active)) return;
    if (!this._own.on && (this.composer || this._pipe)) return;   // the game owns the built chain (look.post.manual)
    this._be.sync(this);
  }

  /**
   * Dispose the composer, every effect and the render targets (called by engine.dispose)
   * @internal
   */
  dispose() {
    for (const e of this._list) { e._impl?.dispose?.(); e._impl = null; }
    this._be.dispose(this);
  }
  /**
   * @internal The target the scene is drawn into this frame, for start()'s compileAsync: three keys a program by its output (the canvas gets tone
   * mapping + sRGB, a render target gets neither), so compiling for the canvas while the composer draws into its half-float target compiled
   * variants no frame used and the first frame compiled everything again. Builds the composer now when post is on; null when drawing straight to the canvas.
   * @returns {any}
   */
  _sceneTarget() {
    if (!this.active) return null;
    return this._be.sceneTarget(this);
  }
  /**
   * Draw the frame through the chain. target: a render target to draw the finished picture into instead of the canvas (engine.renderOnce(target));
   * it gets the canvas's pixels (tone mapped, output color space). Why a target argument and not "set the render target first": the WebGL chain's
   * last pass always writes to the canvas (EffectComposer renderToScreen); the WebGPU pipeline draws into whatever target is set.
   * @param {number} dt @param {any} [target] @returns {void}
   */
  render(dt, target = null) {
    if (!this.active) { this._be.direct(this, target); return; }
    this._be.render(this, dt, target);
  }
  /**
   * @internal start() replaced the renderer (fallback: 'webgl'): the chain and every effect's built part (bloom's node, its targets) belong to
   * the old backend. Dropping each _impl matters: the WebGL backend builds an effect only when it has none, so a WebGPU record left behind
   * was used as a Pass and start() crashed.
   */
  _setBackend() {
    this._be.dispose(this);
    for (const e of this._list) { e._impl?.dispose?.(); e._impl = null; }
    this._be = backendFor(this.engine.renderer);
    this._ownAA = ownMsaa(this.engine.renderer);
    this._be.init(this);
    this._sync();
  }
  /** @internal The renderer's clear color when it stands in for a missing background: opaque and cleared by three (not the game), else null */
  _clearColor() {
    const r = this.engine.renderer;
    return r.autoClear && r.autoClearColor && r.getClearAlpha() === 1 ? r.getClearColor(this._clear ??= new THREE.Color()) : null;
  }
}

/** The chain backend for this renderer: WebGL here; the WebGPU one only when threedog/tsl registered it (render/fx/postWebGPU.tsl.js) */
function backendFor(r) {
  return isWebGPU(r) ? webgpuPart('post', 'engine.post (the post chain)') : webglPost;
}

// Performance budget, engine.budget: the game sets limits (only categories given are checked); on overrun it reports which category and who uses the most.
//   createEngine({ budget: { drawCalls: 250, fps: 55 } })  or  engine.budget.enable({ drawCalls: 250 })
//   engine.budget.report()   // { ok, over: [{ category, value, limit, top }] }; null when off
// Off by default; when off, sample() returns immediately and costs nothing. The engine presets no limit numbers.
// Categories: drawCalls, triangles, textures, cpuMs, fps, low1 (fps and low1 are lower bounds) + registered metrics (lights, shadowLights, shadowMaps, shadowMapSize, chunkApplyMs, rigidBodies...)
// + the apply-cost stages (applyTransitMs, applyBuildMs, applyColliderMs, applyUploadMs, applyStreamMs: ms per frame, see ApplyCost).
// "Who uses the most": draw calls are estimated by the userData.budgetTag of an object (or its parent); untagged counts as 'other'.
/** @import { Handle } from '../../types/common' */
/** @import { BudgetLimits, BudgetReport, BudgetTagStat } from '../../types/world' */
import { coded } from '../base/errorHints.js';
import { fmt, warnOnce } from '../base/validate.js';
import { r1 } from '../base/math.js';
import { SHADOW_TYPES } from '../../render/shadowTypes.js';
import * as THREE from 'three';
import { stats, shadowMaps } from '../../render/backend.js';

const STRINGS = {
  startup: 'Startup took {value} ms, over budget startupMs {limit} ms; slowest module: {top}',
  module: 'Module {name} took {value} ms to start, over budget moduleMs {limit} ms (init + waiting for ready)',
  over: 'Performance budget exceeded: {category} = {value} ({dir} {limit}). Most draw calls: {top}',
  min: 'minimum', max: 'maximum',
};
const LOWER = new Set(['fps', 'low1']);   // these two are lower bounds ("not below")
const WINDOW = 300;                       // how many recent frames the frame-rate stats use

/** Cost stages of bringing a background result into the frame, in the order a chunk goes through them */
const STAGES = ['transit', 'build', 'collider', 'upload', 'stream'];
const EMA = 0.1;   // per-frame smoothing, the same factor chunkApplyMs always used
const COMPILES_KEPT = 20;   // compile-stall frames remembered by ApplyCost.compiles

/** Bytes of the typed arrays in a plain result object, `depth` levels down @param {any} v @param {number} depth @returns {number} */
function arrayBytes(v, depth) {
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (!v || typeof v !== 'object' || depth < 0) return 0;
  let n = 0;
  for (const k in v) n += arrayBytes(v[k], depth - 1);
  return n;
}

/**
 * engine.budget.cost: where the main thread pays for background results (terrain chunks, vegetation, colliders, stream builds), split in stages.
 * Always on (a few performance.now() calls per applied result). Stages: transit = worker round trip minus the worker's own compute (queueing,
 * structured clone, waiting for a busy main thread: an async wait, not main-thread blocking, so it is an approximation); build = creating the
 * three.js objects (geometry, meshes, instanced meshes); collider = physics colliders; upload = GPU upload and shader compile, approximated as the
 * extra render time of frames that first draw new objects over the average render time of other frames; stream = the synchronous part of a stream
 * build() callback.
 */
class ApplyCost {
  /** @internal */
  constructor() {
    /** @internal */ this.t = {};
    for (const k of STAGES) this.t[k] = { n: 0, totalMs: 0, maxMs: 0, frameMs: 0, bytes: 0, _cur: 0 };
    /** @internal */ this._fresh = 0;
    /** @internal */ this._base = -1;
    /** Frames in which three.js compiled new shader programs (the last COMPILES_KEPT): { at (page time s), programs (new), ms (render ms of that frame over the usual) } */
    this.compiles = [];
    /** @internal */ this._programs = -1;
  }
  /** @internal Add ms to a stage (bytes: payload size, transit only) */
  add(stage, ms, bytes = 0) {
    const s = this.t[stage];
    s.n++; s.totalMs += ms; s._cur += ms; s.bytes += bytes;
    if (ms > s.maxMs) s.maxMs = ms;
  }
  /** @internal Close a span started with performance.now(); build and stream spans create objects the next render uploads */
  end(stage, t0) {
    this.add(stage, performance.now() - t0);   // measure
    if (stage === 'build' || stage === 'stream') this._fresh++;
  }
  /** @internal A worker result arrived: t0 is when its job was sent, r.ms what the worker spent computing it.
   * The payload size is the typed arrays in the result, at most two levels down ({ mesh: { pos, nor } }): measured from the shape of
   * any result, so core never learns one module's field names (it used to read terrain's four arrays by name). */
  transit(t0, r) {
    const bytes = arrayBytes(r, 2);
    this.add('transit', Math.max(0, performance.now() - t0 - (r.ms ?? 0)), bytes);   // measure
  }
  /** @internal One render finished (ms): a frame that drew new objects pays the upload, the others set the baseline. Also rolls the per-frame smoothing.
   * programs: renderer.info.programs.length after it; when it grew, three.js compiled shaders in this render (a compile stall, kept in compiles)
   * @returns {boolean} true when this render compiled shaders (adaptive resolution skips such frames) */
  rendered(ms, programs = -1, at = 0) {
    const compiled = programs > this._programs && this._programs >= 0;
    if (compiled) {
      this.compiles.push({ at: r1(at), programs: programs - this._programs, ms: r1(Math.max(0, ms - Math.max(0, this._base))) });
      if (this.compiles.length > COMPILES_KEPT) this.compiles.shift();
    }
    if (programs >= 0) this._programs = programs;
    if (this._fresh) { if (this._base >= 0) this.add('upload', Math.max(0, ms - this._base)); this._fresh = 0; }
    else this._base = this._base < 0 ? ms : this._base + (ms - this._base) * EMA;
    for (const k of STAGES) { const s = this.t[k]; s.frameMs += (s._cur - s.frameMs) * EMA; s._cur = 0; }
    return compiled;
  }
  /**
   * Per stage: n results, totalMs, maxMs of one result, frameMs (smoothed ms per frame), bytes (transit only)
   * @returns {Record<string, { n: number, totalMs: number, maxMs: number, frameMs: number, bytes: number }>}
   * @example engine.budget.cost.report().build   // { n: 12, totalMs: 9.4, maxMs: 1.8, frameMs: 0.2, bytes: 0 }
   */
  report() {
    const out = /** @type {any} */ ({});
    for (const k of STAGES) { const s = this.t[k]; out[k] = { n: s.n, totalMs: r1(s.totalMs), maxMs: r1(s.maxMs), frameMs: r1(s.frameMs), bytes: s.bytes }; }
    return out;
  }
  /** Forget what was counted so far (to measure one scene on its own) */
  reset() { for (const k of STAGES) Object.assign(this.t[k], { n: 0, totalMs: 0, maxMs: 0, frameMs: 0, bytes: 0, _cur: 0 }); this.compiles = []; }
}

/** engine.budget: performance budget (turned on by createEngine({ budget }) or enable(); off by default, costs nothing). */
export class Budget {
  /** @internal */
  constructor(engine) {
    /** @internal */ this.engine = engine;
    /** Is it on? */
    this.enabled = false;
    /** Current limits @type {BudgetLimits} @experimental */
    this.limits = {};
    /** @internal Module-defined categories: name -> { read, limit } @type {Map<string, { read: () => number, limit?: number }>} */
    this.metrics = new Map();
    /** @internal */ this._dts = [];
    /** @internal */ this._cpu = [];
    /** @internal */ this._t = 0;
    /** @internal @type {any} */ this._last = null;
    /** Cost of applying background results, split in stages (see ApplyCost) */
    this.cost = new ApplyCost();
    for (const k of STAGES) this.metric('apply' + k[0].toUpperCase() + k.slice(1) + 'Ms', () => this.cost.t[k].frameMs);
    /** @internal */ this._frustum = new THREE.Frustum();
    /** @internal */ this._m = new THREE.Matrix4();
  }
  /**
   * Turn on and set limits (only categories given are checked)
   * @param {BudgetLimits} [limits]
   * @returns {this}
   * @example engine.budget.enable({ drawCalls: 250, fps: 55 });
  */
  enable(limits = {}) { this.enabled = true; this.limits = { ...limits }; this._dts = []; this._cpu = []; this._last = null; return this; }
  /** Turn off @experimental */
  disable() { this.enabled = false; this._last = null; }
  /**
   * Module-defined category: read() returns the current value, opts.limit is the limit (the game's enable() takes precedence). Returns a handle { remove() }
   * @param {string} name
   * @param {() => number} read
   * @param {{ limit?: number }} [opts]
   * @returns {Handle}
  */
  metric(name, read, opts = {}) {
    const m = { read, limit: opts.limit };
    this.metrics.set(name, m);
    return { remove: () => { if (this.metrics.get(name) === m) this.metrics.delete(name); } };
  }
  /** Limit of a category; undefined if none was given (not checked) @param {string} name @returns {number | undefined} @experimental */
  limitOf(name) { return this.limits[name] ?? this.metrics.get(name)?.limit; }

  /** @internal Called by the engine after each rendered frame: records frame time, checks once a second, and warns once per category over its limit */
  sample(dt) {
    if (!this.enabled) return;
    this._dts.push(dt); this._cpu.push(this.engine._cpuMs ?? 0);
    if (this._dts.length > WINDOW) { this._dts.shift(); this._cpu.shift(); }
    if ((this._t += dt) < 1) return;
    this._t = 0;
    const r = this._last = this._evaluate();
    for (const o of r.over) {
      // once per category: the measured value changes every second, so the text alone would repeat
      warnOnce(coded('budget-over', fmt(STRINGS.over, { ...o, dir: LOWER.has(o.category) ? STRINGS.min : STRINGS.max, top: o.top.map(t => `${t.tag} ${t.drawCalls}`).join(', ') })), 'budget-over\0' + o.category);
    }
  }
  /** Budget report; null when off. In the real-time loop it returns the last second's result; in step() mode it is computed on demand @returns {BudgetReport | null} */
  report() {
    if (!this.enabled) return null;
    return this._last && this._dts.length ? this._last : this._evaluate();
  }
  /**
   * Called by the engine when startup finishes: warns if startupMs / moduleMs is exceeded and returns the offenders (empty array if none)
   * @param {{ totalMs: number, modules: Record<string, { init?: number, ready?: number }> }} s
   * @returns {{ category: 'startupMs' | 'moduleMs', value: number, limit: number, top: { tag: string, ms: number }[] }[]}
  * @experimental
  */
  checkStartup(s) {
    if (!this.enabled) return [];
    const { startupMs, moduleMs } = this.limits, /** @type {any[]} */ over = [];
    const mods = Object.entries(s.modules).map(([tag, v]) => ({ tag, ms: (v.init ?? 0) + (v.ready ?? 0) })).sort((a, b) => b.ms - a.ms);
    const top = mods.slice(0, 3);
    if (startupMs != null && s.totalMs > startupMs) {
      warnOnce(coded('budget-over', fmt(STRINGS.startup, { value: s.totalMs, limit: startupMs, top: top.map(t => `${t.tag} ${t.ms}`).join(', ') })));
      over.push({ category: 'startupMs', value: s.totalMs, limit: startupMs, top });
    }
    if (moduleMs != null) for (const m of mods) if (m.ms > moduleMs) {
      warnOnce(coded('budget-over', fmt(STRINGS.module, { name: m.tag, value: m.ms, limit: moduleMs })));
      over.push({ category: 'moduleMs', value: m.ms, limit: moduleMs, top: [m] });
    }
    return over;
  }
  /** Current value per category (fps/low1/cpuMs exist only once there are frame times) @returns {Record<string, number>} */
  values() {
    const s = stats(this.engine.renderer), v = /** @type {Record<string, number>} */ ({ drawCalls: s.drawCalls, triangles: s.triangles, textures: s.textures });
    const d = this._dts;
    if (d.length) {
      const sum = d.reduce((a, b) => a + b, 0), worst = d.slice().sort((a, b) => b - a), n = Math.max(1, Math.floor(d.length * 0.01));
      v.fps = r1(d.length / sum);
      v.low1 = r1(n / worst.slice(0, n).reduce((a, b) => a + b, 0));
      v.cpuMs = r1(this._cpu.reduce((a, b) => a + b, 0) / this._cpu.length);
    }
    for (const [name, m] of this.metrics) v[name] = r1(m.read());
    return v;
  }
  /** @internal */
  _evaluate() {
    const v = this.values(), over = [];
    let top = null;
    for (const [category, value] of Object.entries(v)) {
      const limit = this.limitOf(category);
      if (limit == null || value == null) continue;
      if (LOWER.has(category) ? value >= limit : value <= limit) continue;
      over.push({ category, value, limit, top: top ??= this.byTag().slice(0, 5) });
    }
    return { ok: !over.length, over };
  }
  /**
   * Estimate draw calls and triangles by userData.budgetTag (visible meshes inside the frustum; shadow casters count a second shadow draw).
   * Returns [{ tag, drawCalls, triangles }], largest first. Called only on overrun (at most once a second) or when debugging
   * @returns {BudgetTagStat[]}
  */
  byTag() {
    const e = this.engine, cam = e.camera, out = new Map(), shadows = e.renderer.shadowMap.enabled, shadowCost = Object.values(SHADOW_TYPES).find(t => t.three === e.renderer.shadowMap.type)?.cost ?? 1;
    // shadow passes a caster is drawn in: one per shadow map the renderer draws (each cascade on both renderers), six for a point light
    const passes = Math.max(1, shadowMaps(e.renderer, e.scene).reduce((n, m) => n + m.faces, 0));
    cam.updateMatrixWorld();
    this._frustum.setFromProjectionMatrix(this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const walk = (o, tag) => {
      if (!o.visible) return;
      tag = o.userData.budgetTag ?? tag;
      if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && (!o.frustumCulled || this._frustum.intersectsObject(o))) {
        const g = o.geometry, groups = Array.isArray(o.material) ? Math.max(1, g?.groups.length ?? 1) : 1;
        // a caster adds a shadow draw, scaled by the filter's rough cost (estimate: vsm ~1.6x, basic ~0.8x of pcf), once per pass
        // (an upper bound: each light culls to its own shadow box, so a near cascade skips most of the scene)
        const calls = groups * (shadows && o.castShadow ? 1 + shadowCost * passes : 1);
        const n = g ? (g.index ? g.index.count : g.attributes.position?.count ?? 0) : 0;
        const s = out.get(tag) || out.set(tag, { tag, drawCalls: 0, triangles: 0 }).get(tag);
        s.drawCalls += calls; s.triangles += o.isMesh ? Math.round(n / 3) * (o.count ?? 1) : 0;
      }
      for (const c of o.children) walk(c, tag);
    };
    walk(e.scene, 'other');
    return [...out.values()].sort((a, b) => b.drawCalls - a.drawCalls);
  }
}

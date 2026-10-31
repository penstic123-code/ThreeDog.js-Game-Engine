// Performance budget, engine.budget: the game sets limits (only categories given are checked); on overrun it reports which category and who uses the most.
//   createEngine({ budget: { drawCalls: 250, fps: 55 } })  or  engine.budget.enable({ drawCalls: 250 })
//   engine.budget.report()   // { ok, over: [{ category, value, limit, top }] }; null when off
// Off by default; when off, sample() returns immediately and costs nothing. The engine presets no limit numbers.
// Categories: drawCalls, triangles, textures, cpuMs, fps, low1 (the last two are lower bounds) + module-registered metrics (chunkApplyMs, rigidBodies...).
// "Who uses the most": draw calls are estimated by the userData.budgetTag of an object (or its parent); untagged counts as 'other'.
/** @import { Handle } from '../types/common' */
/** @import { BudgetLimits, BudgetReport, BudgetTagStat } from '../types/world' */
import { coded } from './errorHints.js';
import { fmt } from './validate.js';
import { r1 } from './math.js';
import * as THREE from 'three';

const STRINGS = {
  startup: 'Startup took {value} ms, over budget startupMs {limit} ms; slowest module: {top}',
  module: 'Module {name} took {value} ms to start, over budget moduleMs {limit} ms (init + waiting for ready)',
  over: 'Performance budget exceeded: {category} = {value} ({dir} {limit}). Most draw calls: {top}',
  min: 'minimum', max: 'maximum',
};
const LOWER = new Set(['fps', 'low1']);   // these two are lower bounds ("not below")
const WINDOW = 300;                       // how many recent frames the frame-rate stats use

/** engine.budget: performance budget (turned on by createEngine({ budget }) or enable(); off by default, costs nothing). */
export class Budget {
  /** @internal */
  constructor(engine) {
    /** @internal */ this.engine = engine;
    /** Is it on? */
    this.enabled = false;
    /** Current limits @type {BudgetLimits} */
    this.limits = {};
    /** @internal Module-defined categories: name -> { read, limit } @type {Map<string, { read: () => number, limit?: number }>} */
    this.metrics = new Map();
    /** @internal */ this._dts = [];
    /** @internal */ this._cpu = [];
    /** @internal */ this._t = 0;
    /** @internal @type {any} */ this._last = null;
    /** @internal */ this._warned = new Set();
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
  /** Turn off */
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
  /** Limit of a category; undefined if none was given (not checked) @param {string} name @returns {number | undefined} */
  limitOf(name) { return this.limits[name] ?? this.metrics.get(name)?.limit; }

  /** @internal Called by the engine after each rendered frame: records frame time, checks once a second, and warns once per category over its limit */
  sample(dt) {
    if (!this.enabled) return;
    this._dts.push(dt); this._cpu.push(this.engine.cpuMs ?? 0);
    if (this._dts.length > WINDOW) { this._dts.shift(); this._cpu.shift(); }
    if ((this._t += dt) < 1) return;
    this._t = 0;
    const r = this._last = this._evaluate();
    for (const o of r.over) {
      if (this._warned.has(o.category)) continue;
      this._warned.add(o.category);
      console.warn(coded('budget-over', fmt(STRINGS.over, { ...o, dir: LOWER.has(o.category) ? STRINGS.min : STRINGS.max, top: o.top.map(t => `${t.tag} ${t.drawCalls}`).join(', ') })));
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
  */
  checkStartup(s) {
    if (!this.enabled) return [];
    const { startupMs, moduleMs } = this.limits, /** @type {any[]} */ over = [];
    const mods = Object.entries(s.modules).map(([tag, v]) => ({ tag, ms: (v.init ?? 0) + (v.ready ?? 0) })).sort((a, b) => b.ms - a.ms);
    const top = mods.slice(0, 3);
    if (startupMs != null && s.totalMs > startupMs) {
      console.warn(coded('budget-over', fmt(STRINGS.startup, { value: s.totalMs, limit: startupMs, top: top.map(t => `${t.tag} ${t.ms}`).join(', ') })));
      over.push({ category: 'startupMs', value: s.totalMs, limit: startupMs, top });
    }
    if (moduleMs != null) for (const m of mods) if (m.ms > moduleMs) {
      console.warn(coded('budget-over', fmt(STRINGS.module, { name: m.tag, value: m.ms, limit: moduleMs })));
      over.push({ category: 'moduleMs', value: m.ms, limit: moduleMs, top: [m] });
    }
    return over;
  }
  /** Current value per category (fps/low1/cpuMs exist only once there are frame times) @returns {Record<string, number>} */
  values() {
    const info = this.engine.renderer.info, v = /** @type {Record<string, number>} */ ({ drawCalls: info.render.calls, triangles: info.render.triangles, textures: info.memory.textures });
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
    const e = this.engine, cam = e.camera, out = new Map(), shadows = e.renderer.shadowMap.enabled;
    cam.updateMatrixWorld();
    this._frustum.setFromProjectionMatrix(this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const walk = (o, tag) => {
      if (!o.visible) return;
      tag = o.userData.budgetTag ?? tag;
      if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && (!o.frustumCulled || this._frustum.intersectsObject(o))) {
        const g = o.geometry, groups = Array.isArray(o.material) ? Math.max(1, g?.groups.length ?? 1) : 1;
        const calls = groups * (shadows && o.castShadow ? 2 : 1);
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

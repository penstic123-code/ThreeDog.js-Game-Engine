// Adaptive resolution by frame cost.
// Lowers the render scale when frames cost more than the target allows, raises it back slowly when they are cheap.
// It judges frame COST (main-thread cpuMs, plus GPU time from EXT_disjoint_timer_query_webgl2 when the browser has it), not fps, because a low fps
// alone is ambiguous: a display or power mode that refreshes at 30 Hz (laptop battery saver, phone low-power mode) gives 33.3 ms frames with
// almost no work, and lowering the resolution there only blurs the picture for nothing. The fps path stays only as the fallback without GPU time
// (a GPU-bound game shows a low cpuMs), and even then a frame interval locked to the display's own refresh does not count as overload.
// Frames that compiled shaders (ApplyCost.rendered reports them) and the first GRACE seconds after ready are not judged: startup hitches are
// one-off costs that resolution cannot fix.
//
// shortcut: only the resolution is adjusted. A tier ladder (resolution -> shadows -> view distance -> vegetation) would hang off decide() below as
// further steps once a game needs it; until then the other knobs stay the game's (settings / engine.autoView).
import { DEV, warnOnce } from '../base/validate.js';

const GRACE = 3;          // s after ready that are not judged (warm-up compiles, first uploads, stream fill)
const WINDOW = 1;         // s of samples per decision
const HEAVY = 0.85;       // cost above this share of the frame budget = overload
const LIGHT = 0.6;        // cost under this share = headroom (raise after RAISE_AFTER windows in a row)
const RAISE_AFTER = 4;
const LOCK_TOL = 0.08;    // intervals within 8 % of the window median count as "clustered"

/** The engine.adaptive state object: the public fields (on, target, min, max, base, lowered, from; base is what this device or game starts at, the settings presets' base) plus the controller's own counters */
export function createAdaptive({ on, target, max }) {
  return { on, target, min: 0.6, max, base: max, t: 0, good: 0, cooldown: 0, lowered: false, from: null,
    age: 0, costs: [], gaps: [], refresh: Infinity, reason: null };
}

/**
 * The one engine write of the ratio; re-reading it after keeps this from counting as an outside write. Skips an equal value because three's
 * setPixelRatio resizes the canvas, which clears the drawing buffer.
 * @param {any} e @param {number} p
 */
export function writeRatio(e, p) { if (Math.abs(e.renderer.getPixelRatio() - p) > 0.001) e.renderer.setPixelRatio(p); e._oPixelRatio.mark(); }

const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/**
 * One frame's sample. dt in s (the requestAnimationFrame interval), cost in ms (max of cpu and gpu), compiled: this frame compiled shaders.
 * gpuKnown: cost includes measured GPU time, so a slow interval with a cheap cost is never our overload.
 */
export function adapt(e, dt, cost, compiled, gpuKnown) {
  const a = e.adaptive;
  if (!a.on || !e.ready) return;
  a.age += dt; a.t += dt; a.cooldown -= dt;
  if (!compiled) { a.costs.push(cost); a.gaps.push(dt * 1000); }
  if (a.t < WINDOW) return;
  const costs = a.costs, gaps = a.gaps; a.t = 0; a.costs = []; a.gaps = [];
  // the game set renderer.setPixelRatio itself: adaptive resolution stops (core/ops/owned.js); engine.autoView.manual('pixelRatio', false) resumes it
  e._oPixelRatio.check(); if (!e._oPixelRatio.on) return;
  if (!gaps.length) return;
  const gap = median(gaps), clustered = gaps.filter(g => Math.abs(g - gap) <= gap * LOCK_TOL).length >= gaps.length * 0.7;
  // the fastest steady interval ever seen is the display's refresh (learned during grace too: loading frames are slower, never faster)
  if (clustered) a.refresh = Math.min(a.refresh, gap);
  if (a.age < GRACE) return;
  const c = median(costs), budget = 1000 / a.target;
  const heavy = c > budget * HEAVY;
  const slow = gap > 1000 / (a.target - 5);
  // locked: the frames wait on the display (steady at its refresh, work clearly shorter than the interval), not on us
  const locked = clustered && Math.abs(gap - a.refresh) <= a.refresh * LOCK_TOL && c < gap * 0.8;
  const overload = heavy || (!gpuKnown && slow && !locked);
  const pr = e.renderer.getPixelRatio();
  if (overload && pr > a.min + 0.01) {
    const to = Math.max(a.min, +(pr - 0.1).toFixed(2));
    a.reason = heavy ? `frames cost ${c.toFixed(1)} ms of a ${budget.toFixed(1)} ms budget (target ${a.target} fps)` : `fps ${(1000 / gap).toFixed(0)} is under ${a.target}`;
    // never silent: the picture gets softer, and the game or an AI should know why (dev warning once; describe().render.scale keeps the facts)
    if (!a.lowered) { a.lowered = true; a.from = pr; if (DEV) warnOnce(`render scale ${pr} -> ${to} because ${a.reason}; adaptive resolution lowers it down to ${a.min}. Turn off with createEngine({ adaptiveResolution: false }) or engine.adaptive.on = false; see describe().render.scale`); }
    writeRatio(e, to); a.good = 0; a.cooldown = 5;
  } else if (!overload && c < budget * LIGHT && pr < a.max - 0.01 && a.cooldown <= 0) {
    if (++a.good >= RAISE_AFTER) { writeRatio(e, Math.min(a.max, +(pr + 0.05).toFixed(2))); a.good = 0; }
  } else a.good = 0;
}

/**
 * GPU time of the engine's render via EXT_disjoint_timer_query_webgl2 (null where the browser does not offer it: Safari, Firefox, most phones).
 * Results arrive a few frames late; ms is the latest one. Only runs while adaptive resolution is on.
 */
export class GpuTimer {
  constructor(gl) {
    this.gl = gl; this.ext = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2') ?? null;
    this.pending = []; this.free = []; this.active = null; this.ms = null;
  }
  begin() {
    const { gl, ext } = this;
    if (this.active) this.end();   // a render that threw left its query open: close it, or timing would stop for good
    if (!ext || gl.isContextLost()) return;
    this._poll();
    if (this.pending.length > 6) return;   // results stopped arriving (driver stall): skip timing rather than pile up queries
    const q = this.free.pop() ?? gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q); this.active = q;
  }
  end() { if (!this.active) return; this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push(this.active); this.active = null; }
  _poll() {
    const { gl, ext } = this, disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);   // a disjoint event (clock change) makes the results meaningless
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pending.shift();
      if (!disjoint) this.ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      this.free.push(q);
    }
  }
  dispose() { if (!this.ext || this.gl.isContextLost()) return; for (const q of [...this.pending, ...this.free]) this.gl.deleteQuery(q); this.pending = []; this.free = []; }
}

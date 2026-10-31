// Performance panel + time/weather debugging + stress test. Collapsed by default; F3 shows/hides it (debug({ open: true }) shows it at start). Quality, view distance and density are in the settings menu. Do not install this module in a release.
import { checkOptions } from '../../core/validate.js';
import { esc } from '../../ui/UI.js';
/** @import { ModuleDef } from '../../types/core' */

// Note: the debug panel is a dev tool; its UI text is plain English, not in the string table; do not install this module in a release.
/** engine.debug (F3 panel) */
export class DebugPanel {
  /** @internal */
  constructor(engine, { open = false } = {}) {
    /** @internal */ this.engine = engine;
    /** @internal */ this.bench = null;
    /** Stress test running (player auto-runs fast) @type {boolean} */
    this.benchmarking = false;
    /** Panel root element @type {HTMLElement} */
    this.el = document.createElement('div');
    const el = this.el;
    el.className = 'threedog-debug'; el.hidden = !open;   // collapsed by default so it does not cover the game HUD
    el.innerHTML = `<style>
      .threedog-debug{position:fixed;top:calc(12px + env(safe-area-inset-top,0px));left:max(12px,env(safe-area-inset-left,0px));width:min(290px,calc(100% - 24px));max-height:calc(100% - 24px);overflow:auto;
        background:rgba(17,23,20,.82);color:#e9ece0;border:1px solid rgba(226,232,214,.14);border-radius:10px;font:12px/1.5 system-ui,"PingFang SC","Microsoft YaHei",sans-serif;z-index:10;backdrop-filter:blur(8px)}
      .threedog-debug .g{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 10px;padding:10px 12px}
      .threedog-debug .s b{display:block;font:600 15px ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
      .threedog-debug .s span{color:#a2ad9b;font-size:11px}
      .threedog-debug details{border-top:1px solid rgba(226,232,214,.14)}
      .threedog-debug summary{cursor:pointer;padding:8px 12px;font-weight:700}
      .threedog-debug .c{padding:0 12px 12px;display:flex;flex-direction:column;gap:8px}
      .threedog-debug .r{display:grid;grid-template-columns:64px 1fr 44px;gap:8px;align-items:center}
      .threedog-debug .r label{color:#a2ad9b}.threedog-debug output{font-family:ui-monospace,Menlo,monospace;text-align:right}
      .threedog-debug input[type=range]{width:100%;accent-color:#f0b450}
      .threedog-debug .k{display:flex;flex-wrap:wrap;gap:4px 12px;color:#a2ad9b}
      .threedog-debug button{font:inherit;font-weight:700;background:#f0b450;color:#1b1408;border:0;border-radius:7px;padding:7px 10px;cursor:pointer}
      .threedog-debug .res{font-family:ui-monospace,Menlo,monospace;white-space:pre-line}
      .threedog-debug [hidden]{display:none!important}
      .threedog-debug>.res{padding:0 12px 8px}
      .threedog-debug .ok{color:#8fd17a}.threedog-debug .mid{color:#f0b450}.threedog-debug .bad{color:#ef7d62}
    </style>
    <div class="g">
      <div class="s"><b data-k="fps">--</b><span>FPS</span></div>
      <div class="s"><b data-k="ms">--</b><span>CPU ms/frame</span></div>
      <div class="s"><b data-k="calls">--</b><span>Draw calls</span></div>
      <div class="s"><b data-k="tris">--</b><span>Triangles</span></div>
      <div class="s"><b data-k="chunks">--</b><span>Visible/loaded</span></div>
      <div class="s"><b data-k="inst">--</b><span>Instances</span></div>
      <div class="s"><b data-k="apply">--</b><span>Upload ms</span></div>
      <div class="s"><b data-k="queue">--</b><span>Queued</span></div>
      <div class="s"><b data-k="clock">--</b><span>Time</span></div>
    </div>
    <div class="res k" data-k="budget" hidden></div>
    <div class="res k" data-k="startup" hidden></div>
    <details ${engine.renderer.getSize(new engine.THREE.Vector2()).x > 600 ? 'open' : ''}><summary>Debug</summary><div class="c">
      <div class="r"><label>Time scale</label><input data-i="ts" type="range" min="0" max="60" step="1"><output data-o="ts"></output></div>
      <div class="r"><label>Time</label><input data-i="tod" type="range" min="0" max="1" step="0.005"><output data-o="tod"></output></div>
      <div class="r"><label>Weather</label><select data-s="weather" style="grid-column:span 2;font:inherit;background:#222;color:#eee;border:1px solid #444;border-radius:6px;padding:3px">
</select></div>
      <button type="button" data-b="bench">20 s stress test</button>
      <div class="res" data-k="bench"></div>
    </div></details>`;
    this.engine.uiRoot.appendChild(el);
    const q = s => el.querySelector(s);
    /** @internal */ this.out = {}; el.querySelectorAll('[data-k]').forEach(n => this.out[n.dataset.k] = n);
    const e = engine, w = e.terrain;
    // controls for modules that are not installed are hidden
    const hideRow = k => { const i = q(`[data-i="${k}"]`); if (i) i.closest('.r').hidden = true; };
    if (!e.sky) { hideRow('ts'); hideRow('tod'); }
    if (!e.weather) q('[data-s="weather"]').closest('.r').hidden = true;
    const bind = (k, get, set, fmt) => {
      const i = q(`[data-i="${k}"]`), o = q(`[data-o="${k}"]`);
      i.value = get(); o.textContent = fmt(get());
      i.addEventListener('input', () => { o.textContent = fmt(+i.value); if (k !== 'dens') set(+i.value); });
      if (k === 'dens') i.addEventListener('change', () => set(+i.value));
      return i;
    };
    if (e.sky) {
      bind('ts', () => e.clock.timeScale, v => e.clock.timeScale = v, v => v + '×');
      /** @internal */ this.tod = bind('tod', () => e.sky.timeOfDay, v => e.sky.timeOfDay = v, () => e.sky.clock);
    }
    const ws = q('[data-s="weather"]');
    if (e.weather) {   // options come from the game's weather table (its own types show up here automatically)
      // weather names come from the weather module's string table (weather.<name>); do not duplicate them here
      ws.innerHTML = Object.keys(e.weather.types).map(k => `<option value="${esc(k)}">${esc(e.weather.label(k))}</option>`).join('') + `<option value="auto">${esc(e.weather.label('auto'))}</option>`;
      ws.value = e.weather.name;
    }
    ws.onchange = () => { if (ws.value === 'auto') e.weather.setAuto(true); else { e.weather.setAuto(false); e.weather.set(ws.value, 8); } };
    q('[data-b="bench"]').onclick = () => this.startBench();
    engine.i18n.add({ 'zh-CN': { 'debug.toggle': '调试面板' }, en: { 'debug.toggle': 'Debug panel' } });   // the settings menu's rebind page shows this name
    engine.input.define('debugPanel', ['F3'], 'debug.toggle');
  }

  /**
   * Start the stress test (seconds, default 20): the character auto-runs fast, continuously loading new chunks, and a report is shown in the panel at the end
   * @param {number} [seconds]
   * @returns {void}
   */
  startBench(seconds = 20) {
    if (this.bench) return;
    this.bench = { t: 0, dur: seconds, dts: [], built: 0 };
    this.out.bench.textContent = 'Testing: character runs straight at 32 m/s, continuously loading new chunks...';
    this.benchmarking = true; this.engine.input.autopilot = { x: 0, y: 1, speed: 32 }; this.engine.adaptive.paused = true;
  }

  /** @internal */
  frame(dt, built) {
    if (!this.bench) return;
    const b = this.bench; b.t += dt; b.dts.push(dt); b.built += built;
    if (b.t < b.dur) return;
    this.benchmarking = false; this.bench = null; this.engine.input.autopilot = null; this.engine.adaptive.paused = false;
    const d = b.dts.slice().sort((x, y) => y - x), sum = b.dts.reduce((x, y) => x + y, 0);
    const n1 = Math.max(1, Math.floor(d.length * 0.01)), worst = d.slice(0, n1).reduce((x, y) => x + y, 0) / n1;
    const avg = b.dts.length / sum, low = 1 / worst, L = this.limits();
    const cls = (v, lim) => lim == null ? '' : v >= lim ? 'ok' : v >= lim * 0.6 ? 'mid' : 'bad';
    const w = this.engine.terrain;
    this.out.bench.innerHTML = `${w ? `View distance ${w.viewChunks * w.CHUNK}m · Density ${w.density}×` : ''}\nAvg FPS <b class="${cls(avg, L.fps)}">${avg.toFixed(1)}</b>\n1% low FPS <b class="${cls(low, L.low1)}">${low.toFixed(1)}</b>\nLongest frame ${(d[0] * 1000).toFixed(1)} ms\nChunks built: ${b.built}`;
  }

  /** Budget limits (empty object if budget is off: numbers are not colored) @internal */
  limits() { const b = this.engine.budget; return b.enabled ? { ...Object.fromEntries([...b.metrics].map(([k, m]) => [k, m.limit])), ...b.limits } : {}; }

  /** @internal */
  stats(s) {
    const o = this.out, fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n), L = this.limits();
    // colors: green = within limit, yellow = slightly off (within 1.5x of an upper limit / above 0.6x of a lower limit), red = worse; no limit = no color
    const atMost = (v, lim) => lim == null ? '' : v <= lim ? 'ok' : v <= lim * 1.5 ? 'mid' : 'bad';
    const atLeast = (v, lim) => lim == null ? '' : v >= lim ? 'ok' : v >= lim * 0.6 ? 'mid' : 'bad';
    o.fps.textContent = s.fps.toFixed(0); o.fps.className = atLeast(s.fps, L.fps);
    o.ms.textContent = s.cpu.toFixed(1); o.ms.className = atMost(s.cpu, L.cpuMs);
    o.calls.textContent = s.calls; o.calls.className = atMost(s.calls, L.drawCalls);
    o.tris.textContent = fmt(s.tris); o.tris.className = atMost(s.tris, L.triangles);
    o.apply.className = atMost(s.apply, L.chunkApplyMs);
    const r = this.engine.budget.report();
    o.budget.hidden = !r;
    if (r) o.budget.innerHTML = r.ok ? '<span class="ok">Budget OK</span>' : r.over.map(x => `<span class="bad">${x.category} ${x.value}/${x.limit}</span>`).join(' ') + (r.over[0].top.length ? '<br>' + r.over[0].top.map(t => `${t.tag} ${t.drawCalls}`).join(' · ') : '');
    const st = this.engine.startup;
    o.startup.hidden = !st;
    if (st) {
      const slow = Object.entries(st.modules).map(([k, v]) => [k, (v.init ?? 0) + (v.ready ?? 0)]).sort((a, b) => b[1] - a[1])[0];
      o.startup.textContent = `Startup ${st.totalMs} ms` + (slow ? ` · slowest ${slow[0]} ${slow[1]} ms` : '');
    }
    o.chunks.textContent = s.visible + '/' + s.loaded;
    o.inst.textContent = fmt(s.instances);
    o.apply.textContent = s.apply.toFixed(1);
    o.queue.textContent = s.queued;
    o.clock.textContent = this.engine.sky?.clock ?? '--';
    if (this.tod && document.activeElement !== this.tod) this.tod.value = this.engine.sky.timeOfDay;
  }
}

/**
 * F3 F3 debug panel -> engine.debug: performance panel, settings, stress test. Collapsed by default; F3 shows/hides it; open: true shows it at start. Just do not install it in a release
 * @param {{ open?: boolean }} [opts]
 * @returns {ModuleDef<DebugPanel>}
 */
export function debug(opts = {}) {
  let d = null; const prof = { n: 0, t: 0, cpu: 0 };
  return {
    name: 'debug', label: 'Debug panel', optional: ['sky', 'weather', 'terrain'], presentation: true,
    install(e) { checkOptions('debug()', opts, ['open']); d = new DebugPanel(e, opts); return d; },
    frame(dt, e) { if (e.input.pressedRaw('debugPanel')) d.el.hidden = !d.el.hidden; },
    afterRender(dt, e) {
      d.frame(dt, e.terrain?.stats.builtThisFrame || 0);
      prof.n++; prof.t += dt; prof.cpu += e.cpuMs || 0;
      if (prof.t < 0.5) return;
      const s = e.terrain?.stats || {}, info = e.renderer.info.render;
      d.stats({ fps: prof.n / prof.t, cpu: prof.cpu / prof.n, calls: info.calls, tris: info.triangles, visible: s.visible ?? 0, loaded: s.loaded ?? 0, instances: s.instances ?? 0, apply: s.applyMs ?? 0, queued: s.queued ?? 0 });
      prof.n = prof.t = prof.cpu = 0;
    },
  };
}

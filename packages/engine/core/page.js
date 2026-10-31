// engine.page: the one place that listens to the browser window and device (focus, tab visibility, mouse lock, WebGL context). Modules never add their own
// blur / visibilitychange / pointerlockchange / webglcontextlost listeners; they read engine.page or listen to the page:* events.
//   createEngine({ pauseOnBlur: false })     // keep playing while the window is in the background (default: gameplay waits)
//   engine.page.pauseOnBlur = false;         // same, at runtime (e.g. a settings toggle)
//   engine.events.on('page:blur', () => engine.flow?.go('paused'));   // show the pause menu as well, if the game wants one
// While the page is away (window lost focus or tab hidden) with pauseOnBlur, the real-time loop runs no fixed steps: movement, timers, the game clock and
// background results all wait, rendering and UI go on. Coming back resumes from where it stopped, with no catch-up burst (the loop drops the time spent away).
// engine.step() is explicit (tests, the dev bridge) and still advances while away. Held keys are released by Input when it hears page:blur.
// WebGL context lost (driver reset, GPU memory pressure): gameplay waits and the player sees a message; three.js restores the context itself and play resumes.
import { coded } from './errorHints.js';
import { toast } from '../ui/UI.js';

const STRINGS = {
  'zh-CN': { 'page.gpuLost': '图形设备暂时不可用，正在恢复……如果画面一直不恢复，请刷新页面', 'page.gpuBack': '画面已恢复' },
  en: { 'page.gpuLost': 'The graphics device was lost; trying to recover... If the picture does not come back, reload the page', 'page.gpuBack': 'Graphics restored' },
};
const DEV = { lost: '[page] WebGL context lost: gameplay waits until the browser restores it (three.js rebuilds GPU resources). If it never comes back, the page must be reloaded.' };

/** engine.page: window focus, tab visibility, mouse lock and WebGL context, all handled here. */
export class Page {
  /** @internal */
  constructor(engine, { pauseOnBlur = true } = {}) {
    /** @internal */ this.engine = engine;
    /** Wait (no fixed steps) while the page is away; default true. Settable at runtime @type {boolean} */
    this.pauseOnBlur = pauseOnBlur;
    /** The window has keyboard focus @type {boolean} */
    this.focused = true;   // a page that starts unfocused (opened behind devtools, driven by the dev bridge) still plays until the window is left once
    /** The tab is visible @type {boolean} */
    this.visible = document.visibilityState !== 'hidden';
    /** The mouse is locked to the canvas (first-person / shoulder cameras lock on click) @type {boolean} */
    this.pointerLocked = false;
    /** The WebGL context is lost and not yet restored @type {boolean} */
    this.contextLost = false;
    /** @internal the real-time loop drops the time accumulated so far (set when the page comes back) */ this._resync = false;
    engine.i18n.add(STRINGS);
    if (engine.headless) return;   // headless advances only through step(); there is no real-time play to hold
    const signal = engine.signal, canvas = engine.renderer.domElement;
    addEventListener('blur', () => this._set('focused', false), { signal });
    addEventListener('focus', () => this._set('focused', true), { signal });
    document.addEventListener('visibilitychange', () => this._set('visible', document.visibilityState !== 'hidden'), { signal });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      engine.events.emit('page:pointerlock', { locked: this.pointerLocked });   // the camera locks again on the next click (camera/common.js)
    }, { signal });
    canvas.addEventListener('webglcontextlost', ev => {
      ev.preventDefault();   // tells the browser we want the context back
      this.contextLost = true;
      console.error(coded('webgl-lost', DEV.lost));
      toast(engine, engine.t('page.gpuLost'), { kind: 'error', ms: 8000 });
      engine.events.emit('page:contextlost');
    }, { signal });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false; this._resync = true;
      toast(engine, engine.t('page.gpuBack'));
      engine.events.emit('page:contextrestored');
    }, { signal });
  }

  /** The page is away: the window lost focus or the tab is hidden @type {boolean} */
  get away() { return !this.focused || !this.visible; }
  /** The real-time loop holds gameplay now (away with pauseOnBlur, or the WebGL context is lost) @type {boolean} */
  get held() { return (this.pauseOnBlur && this.away) || this.contextLost; }

  /** @internal For the real-time loop: true once after the page came back (drop the time accumulated while away), then false @returns {boolean} */
  consumeResync() { const r = this._resync; this._resync = false; return r; }

  /** @internal one focus / visibility change: emit page:blur / page:focus only when "away" actually flips */
  _set(key, v) {
    const was = this.away;
    this[key] = v;
    if (was === this.away) return;
    if (!this.away) this._resync = true;   // the time spent away must not be replayed as a burst of fixed steps
    this.engine.events.emit(this.away ? 'page:blur' : 'page:focus', { focused: this.focused, visible: this.visible });
  }

  /** @internal for describe */
  describe() { return { away: this.away, held: this.held, pointerLocked: this.pointerLocked, contextLost: this.contextLost }; }
}

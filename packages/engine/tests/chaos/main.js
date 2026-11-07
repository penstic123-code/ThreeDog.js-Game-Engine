// Chaos test page (tests/specs/chaos.mjs): window.engine is the bare engine the test runner waits for; the driver builds its own games.
import { createEngine } from '../../index.js';

// DOM listeners live now, counted from before any engine exists: engine.counts() sees only its own bus, and a listener left on window outlives the engine
const live = new Map();
const { addEventListener: add, removeEventListener: remove } = EventTarget.prototype;
EventTarget.prototype.addEventListener = function (type, fn, o) {
  if (fn && !o?.once && !o?.signal && (this === window || this === document)) { const k = live.get(this) ?? live.set(this, new Set()).get(this); k.add(`${type}`.concat('\0')); (k.fns ??= new Set()).add(fn); }
  return add.call(this, type, fn, o);
};
EventTarget.prototype.removeEventListener = function (type, fn, o) { live.get(this)?.fns?.delete(fn); return remove.call(this, type, fn, o); };
window.threedogChaosListeners = () => [...live.values()].reduce((n, k) => n + (k.fns?.size ?? 0), 0);

const engine = window.engine = createEngine({ canvas: document.getElementById('view'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'chaos-page' });
engine.start();
window.threedogChaos = await import('./driver.js');

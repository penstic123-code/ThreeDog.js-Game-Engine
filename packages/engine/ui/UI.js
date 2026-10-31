// UI base. The engine provides only structure and behavior (windows open/close, toasts pop up); the look is fully replaceable:
//   1. Colors, fonts, radii: variables in the style pack's style.ui (bg, fg, accent...), turned into CSS variables --threedog-* on engine.uiRoot
//   2. Layout details: style.ui.css is placed after every engine and module default, so it overrides the .threedog-* classes
//   3. Whole window content: style.ui.templates.<window name>(data, helpers) returns HTML and replaces the default layout
//
// Every window and component uses classes (no inline styles), so option 2 always takes effect.
import * as THREE from 'three';
import { vec3 } from '../core/math.js';
import { uiFocus } from './Focus.js';
import { injectUICSS } from './theme.js';
/** @import { Engine } from '../types/core' */
/** @import { PositionLike, Object3D } from '../types/common' */
/** @import { UIWindow, WindowOptions, ScreenPoint } from '../types/gameplay' */
export { uiFocus, injectUICSS };

/** @internal */
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
/** Icon: def.iconUrl is an image, def.icon is text/emoji */
const iconHTML = def => def?.iconUrl ? `<img src="${esc(def.iconUrl)}" alt="">` : esc(def?.icon ?? '·');

/**
 * Show a short message through the 'toast' UI part (default: top of the screen, gone after ms). A game restyles it, filters it by kind
 * or turns it off with createEngine({ ui: { toast: false } }). kind says where it came from: 'info' (default), 'quest', 'item', 'save', 'error'.
 * @param {Engine} engine
 * @param {string} text
 * @param {{ kind?: string, ms?: number }} [opts]  ms default 2600
 * @returns {void}
 * @example toast(engine, 'Saved', { kind: 'save' })
 */
export function toast(engine, text, { kind = 'info', ms = 2600 } = {}) {
  if (!engine?.ui) throw new Error(`toast(engine, text): the engine comes first, e.g. toast(engine, ${JSON.stringify(String(engine ?? ''))}).`);
  engine.ui.get('toast')?.show({ text, kind, ms });
}

/**
 * Default 'toast' UI part: show({ text, kind, ms })
 * @param {Engine} engine
 * @returns {import('../types/core').UIPart}
 * @internal
 */
export function toastPart(engine) {
  injectUICSS();
  let box = null;
  return {
    show({ text, ms = 2600 }) {
      if (!box) { box = document.createElement('div'); box.className = 'threedog-ui threedog-toasts'; engine.uiRoot.appendChild(box); }
      const t = document.createElement('div'); t.className = 'threedog-toast'; t.textContent = text; box.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, ms);   // wall-clock: a message stays readable while gameplay is paused
    },
    dispose() { box?.remove(); box = null; },
  };
}

// When the style pack has style.ui.templates[id](data, { esc, t, icon }), it replaces the default content.
// Opening pushes onto the UI focus stack (uiFocus): Esc goes only to the top window / dialogue / cutscene, see Focus.js.
/**
 * A toggleable window
 * @param {Engine} engine
 * @param {WindowOptions} opts
 * @returns {UIWindow}
 */
export function makeWindow(engine, opts) {
  const { id, title, hintAction, render, data = () => ({}), onCancel = null } = opts;
  injectUICSS();
  const w = document.createElement('div'); w.className = `threedog-ui threedog-win threedog-win-${id}`; w.hidden = true; engine.uiRoot.appendChild(w);
  const tools = { esc, t: (k, p) => engine.t(k, p), icon: iconHTML };
  let focus = null, ctx = null;   // handles on the UI focus stack and the input context stack while open
  const api = {
    el: w,
    get open() { return !w.hidden; },
    refresh() {
      if (w.hidden) return;
      const tpl = engine.style.ui?.templates?.[id];
      const body = tpl ? tpl(data(), tools) : render(data(), tools);
      const hint = hintAction ? `<span class="threedog-win-hint">${esc(engine.input.label(hintAction))}</span>` : '';
      w.innerHTML = `<div class="threedog-win-head"><span>${esc(title())}</span><span>${hint} <button class="threedog-btn threedog-close" type="button">${esc(engine.t('common.close'))}</button></span></div>${body}`;
      w.querySelector('.threedog-close').onclick = () => api.toggle(false);
    },
    toggle(on = w.hidden) {
      if (on === !w.hidden) return;
      w.hidden = !on;
      if (on) { ctx = engine.input.push('menu'); focus = uiFocus(engine).push('win-' + id, { cancel: onCancel || (() => api.toggle(false)) }); }
      else { ctx?.remove(); ctx = null; focus?.remove(); focus = null; }
      api.refresh();
      engine.events.emit(on ? 'ui:open' : 'ui:close', id);
    },
  };
  engine.events.on('i18n:change', () => api.refresh());
  engine.events.on('input:rebind', () => api.refresh());
  return api;
}

// e.g. inventory I, quests J. While closed the action opens it (ignored when input is locked by someone else); while open pressing again closes it (the window locks input itself, hence pressedRaw). The back key is handled by the UI focus stack.
/**
 * Window toggle key: call once per frame in a frame hook; opens on the action when closed, closes on another press when open
 * @param {Engine} engine
 * @param {{ open: boolean, toggle(on?: boolean): void }} win  a makeWindow window or any handle with open / toggle
 * @param {string} action
 * @returns {void}
 */
export function toggleOnKey(engine, win, action) {
  const inp = engine.input;
  if (win.open ? inp.pressedRaw(action) : inp.pressed(action)) win.toggle(!win.open);
}

// ---------- screen projection, fades ----------
const _v = new THREE.Vector3();
// behind: behind the camera
/**
 * World coordinates (position or object) -> screen pixels { x, y, onScreen, behind }
 * @param {Engine} engine
 * @param {PositionLike} pos
 * @returns {ScreenPoint}
 */
export function worldToScreen(engine, pos) {
  const obj = /** @type {Object3D} */ (pos);   // isObject3D is three's own duck-type flag; the cast only lets the check read it
  (obj.isObject3D ? obj.getWorldPosition(_v) : vec3(pos, _v)).project(engine.camera);
  const behind = _v.z > 1;
  return { x: (_v.x + 1) / 2 * innerWidth, y: (1 - _v.y) / 2 * innerHeight, behind, onScreen: !behind && Math.abs(_v.x) <= 1 && Math.abs(_v.y) <= 1 };
}

/**
 * Move a screen-anchored element (prompt, marker) to pixel x, y, writing the DOM only when the rounded position changed (called every frame: fewer reflows)
 * @param {HTMLElement} el
 * @param {number} x
 * @param {number} y
 * @returns {void}
 * @internal
 */
export function placeAt(el, x, y) {
  const left = Math.round(x) + 'px', top = Math.round(y) + 'px';
  if (el.style.left !== left) el.style.left = left;
  if (el.style.top !== top) el.style.top = top;
}

const fades = new WeakMap();   // engine → { el, value, from, to, t, d, done }
// color --threedog-fade-bg. Follows engine frames (step() advances it too; stops while pause()d). A new fade interrupts the old (the old Promise resolves at once).
// Scene transitions use engine.flow.transition and cutscenes use the timeline's { fade: seconds, to } step; both go through here.
/**
 * Fade the whole screen to `to` (0 clear ... 1 fully covered) over `seconds` (default 0.5); the Promise resolves when the fade ends
 * @param {Engine} engine
 * @param {number} to  0 clear ... 1 fully covered
 * @param {number} [seconds]  default 0.5
 * @returns {Promise<void>}
 */
export function fadeScreen(engine, to, seconds = 0.5) {
  injectUICSS();
  let f = fades.get(engine);
  if (!f) {
    const el = document.createElement('div'); el.className = 'threedog-fade'; engine.uiRoot.appendChild(el);
    f = { el, value: 0, from: 0, to: 0, t: 0, d: 0, done: null };
    fades.set(engine, f);
    engine.onFrame(dt => { if (f.done) { f.t += dt; set(f, f.t >= f.d ? 1 : f.t / f.d); } });
  }
  f.done?.();
  Object.assign(f, { from: f.value, to, t: 0, d: seconds, done: null });
  const p = new Promise(res => { f.done = () => { f.done = null; res(); }; });
  if (seconds <= 0) set(f, 1);
  return p;
}
function set(f, k) {
  f.value = f.from + (f.to - f.from) * k;
  f.el.style.setProperty('--threedog-fade', f.value);
  f.el.classList.toggle('is-on', f.value > 0.01);
  if (k >= 1) f.done?.();
}

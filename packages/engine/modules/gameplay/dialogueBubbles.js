// Dialogue's second channel (split out of Dialogue.js): bubble lines. The main dialogue locks input and is one conversation at a time; bubbles are lines
// several speakers say at once while the player keeps playing (shop chatter, a crowd, a squad calling out, a radio), each attached to its speaker.
// Why a separate channel instead of a non-locking main dialogue: a bark must never wait for, cut into or be cut by the conversation the player is reading,
// and two NPCs talking over each other is two lines on screen, not a queue in one box.
//   per speaker: one line shows, later ones queue behind it (queue: false replaces the current line instead); seconds = how long it stays
//   at: an Object3D (the line follows it), a position { x, y, z }, an actor / world record id (engine.actorPosition), or null = a screen line (radio)
// Timing runs on game time (frame dt), so engine.step advances it like the typewriter. Drawing: the multi UI part 'dialogue.bubble' (one per speaker,
// default below; replace it with engine.ui.set('dialogue.bubble', ...)). Events: dialogue:bubble { speaker, text, at } when a line shows.
import * as THREE from 'three';
import { injectUICSS, worldToScreen, placeAt, esc } from '../../ui/UI.js';
/** @import { Engine, UIPart } from '../../types/core' */

const CSS = `
.threedog-bubble{position:absolute;left:0;top:0;transform:translate(-50%,-100%);max-width:240px;padding:6px 10px;border-radius:10px;background:var(--threedog-bg);color:var(--threedog-fg);font:14px/1.35 var(--threedog-font);pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.threedog-bubble b{display:block;font-size:12px;opacity:.75}
.threedog-bubbles-screen{position:absolute;left:50%;bottom:22%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none}
.threedog-bubbles-screen .threedog-bubble{position:static;transform:none}
`;
const _v = new THREE.Vector3();

/**
 * Default 'dialogue.bubble' part (one per speaker): update({ speaker, text, x, y, onScreen, screen }) places and draws it; hide() hides it.
 * @param {Engine} e
 * @returns {UIPart}
 * @internal
 */
export function bubblePart(e) {
  injectUICSS(CSS);
  const el = document.createElement('div'); el.className = 'threedog-ui threedog-bubble'; el.hidden = true;
  let html = null, parent = null;
  return {
    el,
    update(d) {
      const want = d.screen ? screenStack(e) : e.uiRoot;
      if (parent !== want) { parent = want; want.appendChild(el); }
      el.hidden = !d.onScreen;
      if (!d.screen) placeAt(el, d.x, d.y);
      const h = `${d.speaker ? `<b>${esc(d.speaker)}</b>` : ''}${esc(d.text)}`;
      if (h !== html) { html = h; el.innerHTML = h; }   // called every frame: rebuild only when the line changed
    },
    hide() { el.hidden = true; },
    dispose() { el.remove(); },
  };
}
const stacksOf = new WeakMap();
function screenStack(e) {
  let s = stacksOf.get(e);
  if (!s) { s = document.createElement('div'); s.className = 'threedog-ui threedog-bubbles-screen'; e.uiRoot.appendChild(s); stacksOf.set(e, s); }
  return s;
}

/** The bubble channel of one Dialogue @internal */
export class Bubbles {
  /** @param {any} d the Dialogue */
  constructor(d) {
    this.d = d; this.engine = d.engine;
    /** key (the at object / id, or 'screen:' + speaker) -> { at, part, cur, queue } */ this.lines = new Map();
  }
  /** Where a line sits on screen: { x, y, onScreen, screen } @internal */
  _place(at, height) {
    const e = this.engine;
    if (at == null) return { x: 0, y: 0, onScreen: true, screen: true };
    let p;
    if (at.isObject3D) p = at.getWorldPosition(_v);
    else if (typeof at === 'string') { const q = e.actorPosition?.(at); if (!q) return { x: 0, y: 0, onScreen: false, screen: false }; p = _v.set(q.x, q.y ?? 0, q.z); }
    else p = _v.set(at.x, at.y ?? 0, at.z);
    _v.y += height;
    const s = worldToScreen(e, _v);
    return { x: s.x, y: s.y, onScreen: s.onScreen, screen: false };
  }
  /**
   * Queue one line on a speaker. Returns a Promise (resolves when the line has been shown for its seconds) with stop() (drop it now; resolves too).
   * @param {any} at @param {string} text @param {{ speaker?: string, seconds?: number, queue?: boolean, height?: number }} o
   */
  say(at, text, { speaker = '', seconds, queue = true, height = 2.2 } = {}) {
    const key = at ?? 'screen:' + speaker;
    let s = this.lines.get(key);
    if (!s) { s = { at, part: this.engine.ui.create('dialogue.bubble'), cur: null, queue: [] }; this.lines.set(key, s); }
    let line;
    const p = new Promise(res => {
      // reading time: holdSeconds plus about 15 characters a second, so a long line stays longer than a shout
      line = { speaker, text: String(text ?? ''), left: seconds ?? this.d.holdSeconds + String(text ?? '').length / 15, height, done: res };
    });
    p.stop = () => this._drop(key, line);
    if (!queue && s.cur) { s.cur.done(); s.cur = null; s.queue.forEach(l => l.done()); s.queue = []; }
    if (s.cur) s.queue.push(line); else this._show(key, s, line);
    return p;
  }
  _show(key, s, line) {
    s.cur = line;
    this.engine.events.emit('dialogue:bubble', { speaker: line.speaker, text: line.text, at: s.at ?? null });
  }
  _drop(key, line) {
    const s = this.lines.get(key); if (!s) return;
    if (s.cur === line) this._next(key, s); else { const i = s.queue.indexOf(line); if (i >= 0) s.queue.splice(i, 1); }
    line.done();
  }
  _next(key, s) {
    s.cur?.done(); s.cur = null;
    const n = s.queue.shift();
    if (n) this._show(key, s, n);
    else { s.part?.dispose?.(); this.lines.delete(key); }
  }
  /** Per frame: count down, place each speaker's line @internal */
  frame(dt) {
    for (const [key, s] of this.lines) {
      if (!s.cur) continue;
      if ((s.cur.left -= dt) <= 0) { this._next(key, s); if (!this.lines.has(key)) continue; }
      s.part?.update?.({ speaker: s.cur.speaker, text: s.cur.text, ...this._place(s.at, s.cur.height) });
    }
  }
  /** Lines showing now: [{ speaker, text, queued }] */
  list() { return [...this.lines.values()].filter(s => s.cur).map(s => ({ speaker: s.cur.speaker, text: s.cur.text, queued: s.queue.length })); }
  /** session:end: drop every line without resolving (awaiting code belonged to the old playthrough) @internal */
  clear() { for (const s of this.lines.values()) s.part?.dispose?.(); this.lines.clear(); }
}

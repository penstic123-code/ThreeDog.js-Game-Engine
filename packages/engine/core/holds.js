// Who holds the engine still: pause, freeze (each ends with its handle's remove()), runState, and the camera takeover (takeCamera / cameraOverride).
// Each is a named stack (core/stacks.js: 'pause' and 'freeze' kind any, 'camera' kind top), so they follow the same owner rules as every shared quantity:
// engine.freeze('menu') is engine.mod('freeze', { owner: 'menu' }) with the loop's side effects added (ending the last pause restarts the loop).
// One entry per mechanism: the handle's remove() ends a pause / freeze (there is no engine.resume / engine.unfreeze).
import { warnOnce, renamedFields } from './validate.js';
import { coded } from './errorHints.js';
import { ownerArgs } from './stacks.js';

// The pause / freeze handle is { owner, remove() } only: no chaining, so a pause is ended in exactly one way.
function handle(owner, remove) { return { owner, remove }; }

/**
 * The three hold stacks: 'freeze' and 'pause' (kind any), 'camera' (kind top). services.js and the test engines call this, so both get the same stacks.
 * The pause stack does the loop side effect itself (onChange), not engine.pause(): engine.mod('pause', { owner }), engine.pause(owner), the handle's
 * remove() and _resume(owner) are then one behavior. Making mod('pause') throw instead would leave a quantity that engine.mod names in describe
 * but refuses to change, a special case to remember; with onChange there is no path that holds the stack without stopping the loop.
 * @param {any} engine
 */
export function defineHoldStacks(engine) {
  engine.stacks.define('freeze', { kind: 'any', save: false });   // who froze gameplay
  engine.stacks.define('pause', { kind: 'any', save: false, onChange: () => {   // who paused the loop; it resumes only when empty
    if (engine.stacks.get('pause').size()) engine.paused = true;
    else if (!engine.disposed) { engine.paused = false; engine._loop(); }
  } });
  engine.stacks.define('camera', { kind: 'top', save: false });   // who holds the camera; the latest is in charge (cameraOverride)
}

export const holdMethods = {
  /**
   * Pause the real-time loop (the picture stops and the game stops advancing). owner names who paused (default 'game'; pause({ owner }) works too): the loop
   * stays paused until every owner has resumed, and _resume(owner) by someone who did not pause does not undo another owner's pause.
   * kind tells engine.runState what the pause means: 'test' (a test or the dev bridge holds it: 'test-paused'); any other pause reads as 'paused'.
   * Returns a handle: remove() resumes this owner.
   * @param {string | { owner?: string, kind?: 'test' }} [owner] @param {{ kind?: 'test' }} [opts]
   * @returns {{ owner: string, remove(): void }}
   * @example const p = engine.pause('perf-test'); ... p.remove();
   */
  pause(owner, opts) {
    const a = ownerArgs(owner, opts);
    const P = this.stacks.get('pause');
    P.take({ owner: a.owner, value: { kind: a.opts.kind ?? null } });   // the stack's onChange sets this.paused (defineHoldStacks), same as engine.mod('pause')
    return handle(a.owner, () => { if (P.has(a.owner)) this._resume(a.owner); });
  },
  /**
   * @internal The dev bridge and tests: end owner's pause (the handle's remove() calls this); with no pause held (a headless engine) it starts live running.
   * A call by a non-owner while others hold a pause is ignored with a dev warning (a pause that silently stays stops even rendering).
   * @param {string | { owner?: string }} [owner]
   */
  _resume(owner) {
    const { owner: o } = ownerArgs(owner);
    const P = this.stacks.get('pause');
    if (P.size() && !P.has(o)) { warnOnce(coded('pause-owner', `ending the pause of '${o}': paused by ${P.names().map(n => `'${n}'`).join(', ')}, not by '${o}'. End a pause with the handle pause() returned (p.remove()), or the pause stays`)); return this; }
    // with holders the stack's onChange restarts the loop; with none (headless start) resume itself starts it
    if (!P.release(o) && !P.size() && !this.disposed) { this.paused = false; this._loop(); }
    return this;
  },
  // Gameplay freeze (menus, flow 'paused'): no fixed steps (movement, timers, game clock and engine.elapsed all stop) while frame hooks
  // and rendering go on, so the picture and UI stay alive.
  // Gameplay logic (quest checks, cutscene waits) belongs in fixed, or check engine.frozen first in frame (see the top of this file).
  // Unlike pause(), which stops rendering too and is for tests and step(). owner is the freezer's name; play resumes only when all
  // have unfrozen. step() obeys freezes as well. Same owner rules as every stack (core/stacks.js).
  /**
   * Freeze gameplay for owner (default 'game'; freeze({ owner, kind }) works too). kind 'title' marks a title screen waiting for start (runState 'title-frozen').
   * Ambient animation (uniforms.uTime: wind, water, clouds) keeps moving behind the freeze; ambient: true stops it too (a photo / cutscene still).
   * Returns a handle whose remove() releases this owner's freeze. Same as engine.mod('freeze', { owner }) plus the kind.
   * @param {string | { owner?: string, kind?: 'title', ambient?: boolean }} [owner] @param {{ kind?: 'title', ambient?: boolean }} [opts]
   * @returns {{ owner: string, remove(): void }}
   */
  freeze(owner, opts) {
    const a = ownerArgs(owner, opts);
    const h = this.stacks.get('freeze').take({ owner: a.owner, value: { kind: a.opts.kind ?? null, ambient: !!a.opts.ambient } });
    return handle(a.owner, h.remove);
  },
  /** True while someone has frozen gameplay */
  get frozen() { return this.stacks.get('freeze').value(); },
  /**
   * The one answer to "why is the page (not) advancing"; the dev bridge and the MCP tools copy it as-is.
   * state: 'loading' | 'title-frozen' (a freeze of kind 'title' is up, waiting for start) | 'test-paused' (only pauses of kind 'test': the bridge or a test)
   *   | 'paused' (paused or frozen by owners, listed in `owners`) | 'running';
   * owners: every pause and freeze owner, so closing one part's pause can be told from a player's;
   * blockedBy: what keeps the player's input from driving the game: each opaque input context ('win-settings', 'ui-title', 'dialogue', 'cutscene'...),
   *   'error' (a gameplay error froze the game) and 'loading' (the loading screen blocks).
   * @returns {{ state: 'loading' | 'title-frozen' | 'test-paused' | 'paused' | 'running', owners: string[], blockedBy: string[] }}
   */
  get runState() {
    const P = this.stacks.get('pause'), F = this.stacks.get('freeze'), owners = [...P.names(), ...F.names()];
    const lv = this.loading?.view();
    const onlyTest = owners.length > 0 && !F.size() && !P.entries().some(d => d.value.kind !== 'test');
    const state = !this.ready || !lv?.done ? 'loading' : F.entries().some(d => d.value.kind === 'title') ? 'title-frozen'
      : !owners.length && !this.paused ? 'running' : !owners.length || onlyTest ? 'test-paused' : 'paused';
    const blockedBy = (this.input?.holders ?? []).filter(h => !h.pass).map(h => h.context);
    if (F.has('error')) blockedBy.push('error');
    if (lv?.blocked) blockedBy.push('loading');
    return renamedFields({ state, owners, blockedBy }, { by: '.owners (and .blockedBy)' }, 'runState');   // 0.2 的 runState.by 读旧名报错
  },

  // ---------- camera takeover ----------
  // While anyone holds the camera, no camera module moves it (camera/common.js reads cameraOverride). The 'camera' stack is kind top: the latest holder
  // is in charge, and releasing it hands the camera back to the previous holder (or to the rig when none is left), never to nobody.
  /**
   * Take the camera over: camera modules leave engine.camera alone until every holder has released it. The latest holder is in charge; its focus
   * (optional) is where the world loads around. Returns { remove() } (only this owner's claim). engine.cameraOverride shows the holder in charge.
   * @param {string | { owner: string, focus?: import('three').Vector3 }} owner @param {{ focus?: import('three').Vector3, [k: string]: any }} [opts] extra fields stay readable on cameraOverride
   * @returns {{ owner: string, remove(): void }}
   * @example const cam = engine.takeCamera('photo-mode', { focus: engine.player.position }); ... cam.remove();
   */
  takeCamera(owner, opts) {
    const a = ownerArgs(owner, opts, undefined);
    const h = this.stacks.get('camera').take({ owner: a.owner, value: { ...a.opts, owner: a.owner } });
    return { owner: a.owner, remove: h.remove };
  },
  /**
   * The camera holder in charge ({ owner, focus? }), or null. Read-only: take the camera with engine.takeCamera(owner).
   * @type {{ owner: string, focus?: import('three').Vector3, [k: string]: any } | null}
   */
  get cameraOverride() { return this.stacks?.get('camera').value() ?? null; },
};

const HOLD_STACKS = { pause: 'pause', freeze: 'freeze', camera: 'camera', debugView: 'debug.view' };
/**
 * Everyone who holds something, in one place (empty parts left out): pause / freeze / camera / debugView [{ owner, at }]; input [{ context, owner,
 * pass }] (pushed input contexts); gates { action: [owners] } (input.gate); stacks { name: holders } (every other engine.mod quantity with entries).
 * Lives here, next to the hold stacks it reads, so describe() and the input-holds test use the same function (no second copy).
 * "Why can't I move / why is time slow" is answered here without knowing which module did it.
 */
export function describeHolds(e) {
  const out = {};
  for (const [k, n] of Object.entries(HOLD_STACKS)) { const h = e.stacks.has(n) ? e.stacks.get(n).holders() : []; if (h.length) out[k] = h; }
  const inp = e.input.holders; if (inp.length) out.input = inp;
  const g = e.stacks.has('input.gate') ? e.stacks.get('input.gate') : null, gates = {};
  for (const id of g?.ids() ?? []) if (g.size(id)) gates[id] = g.names(id);
  if (Object.keys(gates).length) out.gates = gates;
  const st = e.stacks.describe(); for (const n of [...Object.values(HOLD_STACKS), 'input.gate']) delete st[n];
  if (Object.keys(st).length) out.stacks = st;
  return out;
}

// Who holds the engine still: pause / resume, freeze / unfreeze, runState, and the camera takeover (takeCamera / cameraOverride).
// Split out of loop.js (which keeps the loop itself) so each owner-based hold uses the same claims() rules (core/claims.js) in one file.
import { warnOnce } from './validate.js';
import { coded, renamed } from './errorHints.js';
import { ownerArgs } from './claims.js';

// pause / freeze return a claim handle, but they used to return the engine for chaining (engine.pause('x').step(1)); the handle forwards those
// calls so old code keeps working. release (optional) replaces the bare claim removal when releasing has side effects (resume restarts the loop).
const CHAIN = ['pause', 'resume', 'freeze', 'unfreeze', 'step'];
function chained(e, h, release) {
  const out = { owner: h.owner, remove: release ? () => { if (e._pausers.has(h.owner)) release(); } : h.remove };
  for (const k of CHAIN) out[k] = (...a) => e[k](...a);
  return out;
}

export const holdMethods = {
  /**
   * Pause the real-time loop (the picture stops and the game stops advancing). owner names who paused (default 'game'; pause({ owner }) works too): the loop
   * stays paused until every owner has resumed, and resume(owner) by someone who did not pause does not undo another owner's pause.
   * kind tells engine.runState what the pause means: 'test' (a test or the dev bridge holds it: 'test-paused'); any other pause reads as 'paused'.
   * Returns a handle: remove() resumes this owner (same as resume(owner)); pause / resume / freeze / unfreeze / step on it still chain to the engine.
   * @param {string | { owner?: string, kind?: 'test' }} [owner] @param {{ kind?: 'test' }} [opts]
   * @returns {{ owner: string, remove(): void, [k: string]: any }}
   * @example const p = engine.pause('perf-test'); ... p.remove();   // or engine.resume('perf-test')
   */
  pause(owner, opts) {
    const a = ownerArgs(owner, opts);
    const h = this._pausers.take(a.owner, { kind: a.opts.kind ?? null });
    this.paused = true;
    return chained(this, h, () => this.resume(a.owner));
  },
  /**
   * Resume the real-time loop (in headless mode this starts live running). With owners: removes this owner's pause and resumes only when none remain;
   * a resume by a non-owner while others hold a pause is ignored with a dev warning (a pause that silently stays stops even rendering, so it warns;
   * an unfreeze by a non-owner is the same no-op but quiet, because UI parts release their freeze on every close whether or not they froze).
   * @param {string | { owner?: string }} [owner]
   */
  resume(owner) {
    const { owner: o } = ownerArgs(owner);
    if (this._pausers.size && !this._pausers.has(o)) { warnOnce(coded('pause-owner', `engine.resume('${o}'): paused by ${this._pausers.names().map(n => `'${n}'`).join(', ')}, not by '${o}'. Pass the same owner to pause() and resume(), or the pause stays`)); return this; }
    this._pausers.release(o);
    if (!this._pausers.size && !this.disposed) { this.paused = false; this._loop(); }
    return this;
  },
  // Gameplay freeze (menus, flow 'paused'): no fixed steps (movement, timers, game clock and engine.elapsed all stop) while frame hooks
  // and rendering go on, so the picture and UI stay alive.
  // Gameplay logic (quest checks, cutscene waits) belongs in fixed, or check engine.frozen first in frame (see the top of this file).
  // Unlike pause(), which stops rendering too and is for tests and step(). owner is the freezer's name; play resumes only when all
  // have unfrozen. step() obeys freezes as well. Same claim rules as pause (core/claims.js).
  /**
   * Freeze gameplay for owner (default 'game'; freeze({ owner, kind }) works too). kind 'title' marks a title screen waiting for start (runState 'title-frozen').
   * Returns a handle whose remove() unfreezes this owner; chains to the engine like before.
   * @param {string | { owner?: string, kind?: 'title' }} [owner] @param {{ kind?: 'title' }} [opts]
   * @returns {{ owner: string, remove(): void, [k: string]: any }}
   */
  freeze(owner, opts) {
    const a = ownerArgs(owner, opts);
    return chained(this, this._freezers.take(a.owner, { kind: a.opts.kind ?? null }));
  },
  /** Release owner's freeze (only that owner's) @param {string | { owner?: string }} [owner] */
  unfreeze(owner) { this._freezers.release(ownerArgs(owner).owner); return this; },
  /** True while someone has frozen gameplay */
  get frozen() { return this._freezers.size > 0; },
  /**
   * The one answer to "why is the page (not) advancing"; the dev bridge and the MCP tools copy it as-is.
   * state: 'loading' | 'title-frozen' (a freeze of kind 'title' is up, waiting for start) | 'test-paused' (only pauses of kind 'test': the bridge or a test)
   *   | 'paused' (paused or frozen by owners, listed in `by`) | 'running';
   * by: every pause and freeze owner, so closing one part's pause can be told from a player's;
   * blockedBy: what keeps the player's input from driving the game: each opaque input context ('win-settings', 'ui-title', 'dialogue', 'cutscene'...),
   *   'error' (a gameplay error froze the game) and 'loading' (the loading screen blocks).
   * @returns {{ state: 'loading' | 'title-frozen' | 'test-paused' | 'paused' | 'running', by: string[], blockedBy: string[] }}
   */
  get runState() {
    const P = this._pausers, F = this._freezers, by = [...P.names(), ...F.names()];
    const lv = this.loading?.view();
    const onlyTest = by.length > 0 && !F.size && !P.some(d => d.kind !== 'test');
    const state = !this.ready || !lv?.done ? 'loading' : F.some(d => d.kind === 'title') ? 'title-frozen'
      : !by.length && !this.paused ? 'running' : !by.length || onlyTest ? 'test-paused' : 'paused';
    const blockedBy = (this.input?.contexts ?? []).filter((n, i) => !this.input._stack[i].pass);
    if (F.has('error')) blockedBy.push('error');
    if (lv?.blocked) blockedBy.push('loading');
    return { state, by, blockedBy };
  },

  // ---------- camera takeover ----------
  // While anyone holds the camera, no camera module moves it (camera/common.js reads cameraOverride). Before this was a bare field: a named view
  // overwrote a running cutscene's takeover and release() then handed the camera to nobody. Now each holder has a claim; the latest holder is in charge,
  // and releasing it hands the camera back to the previous holder (or to the rig when none is left).
  /**
   * Take the camera over: camera modules leave engine.camera alone until every holder has released it. The latest holder is in charge; its focus
   * (optional) is where the world loads around. Returns { remove() } (only this owner's claim). engine.cameraOverride shows the holder in charge.
   * @param {string | { owner: string, focus?: import('three').Vector3 }} owner @param {{ focus?: import('three').Vector3, [k: string]: any }} [opts] extra fields stay readable on cameraOverride
   * @returns {{ owner: string, remove(): void }}
   * @example const cam = engine.takeCamera('photo-mode', { focus: engine.player.position }); ... cam.remove();
   */
  takeCamera(owner, opts) {
    const a = ownerArgs(owner, opts, undefined);
    return this._cameraClaims.take(a.owner, { ...a.opts, owner: a.owner });
  },
  /**
   * The camera holder in charge ({ owner, focus? }), or null. Read-only: assigning throws renamed-api and names engine.takeCamera(owner).
   * @type {{ owner: string, focus?: import('three').Vector3, [k: string]: any } | null}
   */
  get cameraOverride() { return this._cameraClaims?.top()?.data ?? null; },
  set cameraOverride(_v) { renamed('cameraOverride'); },
};

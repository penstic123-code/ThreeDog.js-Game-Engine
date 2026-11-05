// Engine lifecycle: dispose() and counts() for leak hunting.
//
// Part of Engine (mixed into Engine.prototype).
//
// Who cleans up what:
//   - DOM listeners: attach to engine.signal (an AbortController); dispose aborts them all at once. Modules and games adding their own window / document listeners do the same:
//       addEventListener('resize', fn, { signal: engine.signal })
//   - UI elements: the engine and modules build UI under engine.uiRoot, removed as a whole on dispose; do not attach to document.body directly.
//   - Events, onFixed / onFrame, clock timers, jobs, stream, ray registrations: core clears them all here. A module registers its own through
//     ctx.track (modules.js), so they also leave when its install rolls back or its init fails, and go before its dispose hook runs.
//   - Things core does not know about (Worker, physics world, Audio nodes, real-time timers): clean up in the module's dispose(e) hook, called in reverse install order.
//   - GPU memory: every geometry, material and texture in the scene, the assets cache, the post composer, then renderer.dispose().
// Level changes do not come through here: things inside a level register with level.track(handle), and the level removes them itself on change.

import { coded, codedError } from './errorHints.js';
import { dropOwned } from './owned.js';
import { reportError } from './errors.js';
import { releaseContext, memory } from '../render/backend.js';

/** The per-step / per-frame callback lists (onFixed, onFrame, animators, onRender, module hooks), empty: the constructor's starting state and what dispose leaves */
export function clearHooks(e) {
  e._fixed = []; e._fixedLate = []; e._frame = []; e._animate = []; e._onRender = { before: [], after: [] }; e._hooks = { fixed: [], frame: [], afterRender: [], skip: [] };
}

const STRINGS = { failed: '[engine] dispose hook of module {name} threw (the rest are still cleaned up)',
  released: 'createEngine(): this canvas lost its WebGL context in an earlier engine.dispose(), so a new engine cannot draw on it; use a new canvas, or dispose the old engine with dispose({ keepContext: true })',
  opts: 'engine.dispose(opts): opts is { keepContext?: boolean }; got {v}' };

// Canvases whose context dispose() released: a lost context cannot host a new renderer, so createEngine on one fails loudly instead of drawing black
const released = new WeakSet();
/** createEngine calls it before building its renderer on a canvas */
export function checkCanvasUsable(canvas) { if (canvas && released.has(canvas)) throw codedError('canvas-released', STRINGS.released); }

/** Dispose the geometry, materials and material textures used by an object */
function disposeObject(o) {
  o.geometry?.dispose();
  for (const m of [].concat(o.material || [])) {
    for (const k in m) if (m[k]?.isTexture) m[k].dispose();
    m.dispose();
  }
}

export const lifecycleMethods = {
  /**
   * Destroy the engine: stop the main loop, call each module's dispose(e) in reverse install order, then clean up core (listeners, timers, sound, UI, GPU memory).
   * No callbacks fire afterwards and engine.disposed becomes true. Safe to call repeatedly.
   * The engine's own renderer also gives its WebGL context back (renderer.forceContextLoss): browsers keep only about 16 live contexts, so a page that
   * creates and disposes engines (level editor, tests, restart) would otherwise lose the oldest one. That canvas cannot host a new engine afterwards;
   * keepContext: true keeps the context for a new engine on the same canvas. A renderer the game passed in (createEngine({ renderer })) is never released.
   * @param {{ keepContext?: boolean }} [opts]
   */
  dispose(opts = {}) {
    if (opts === null || typeof opts !== 'object' || Object.keys(opts).some(k => k !== 'keepContext')) throw codedError('dispose-options', STRINGS.opts.replace('{v}', JSON.stringify(opts)));
    if (this.disposed) return;
    this.phase = 'disposed'; this.halted = true;
    cancelAnimationFrame(this._raf);
    dropOwned(this, [...(this._owned?.values() ?? [])]);   // owned.js keeps a page-wide list for allowOwned
    for (const m of [...this.modules.values()].reverse()) {
      this._modState.set(m.name, 'disposed');
      this._dropTracked(m.name);   // its listeners / timers go first, so nothing calls into the module while its dispose tears it down
      if (!m.dispose) continue;
      try { m.dispose(this); } catch (err) { reportError(this, err, coded('module-dispose', STRINGS.failed.replace('{name}', m.name)), { soft: true }); }
    }
    this._abort.abort();
    this._untrackValidate();
    this._wraps?.dispose();   // engine.wrap: every wrapped method back on its object (a game object or api may outlive the engine)
    this.debug.dispose();   // before the scene is disposed: undoes every diagnostic override and view (puts swapped materials back)
    for (const part of [this.saves, this.audio, this.time, this.commits, this.jobs, this.threads, this.stream, this.batching, this.rays, this.events]) part.dispose();
    clearHooks(this); this._afterTick = null;
    this.scene.traverse(disposeObject);
    // scene.environment is never disposed here: the engine's own maps (sky PMREM targets, the baseline room map) were freed above by their
    // owners, and anything else is the game's texture (a direct scene.environment write), which stays the game's to free
    this.scene.environment = null;
    if (this.scene.background?.isTexture) this.scene.background.dispose();
    this.assets.dispose();
    this.occlusion.dispose();
    this.post.dispose();
    this._webglOnlyView?.remove(); this._webglOnlyView = null;
    this._gpu?.dispose();
    this.renderer.dispose();
    if (this._ownsRenderer && !opts.keepContext) { releaseContext(this.renderer); released.add(this.renderer.domElement); }
    this.ui._dispose();
    this._materials.remove();
    this._uiStyle.remove();
    this.uiRoot.remove();
  },

  /**
   * Counts for leak hunting: after repeatedly entering and leaving levels or opening and closing windows, these should not keep growing.
   * geometries / textures come from three.js renderer.info.memory (counted only once rendered).
   * Each installed module with a counts(e) hook adds its own field under its name, e.g. world { records, views }, rigid (body count), particles { alive, emitters }, sky { timers }.
   */
  counts() {
    const mem = memory(this.renderer);
    const c = {
      listeners: this.events.size, fixed: this._fixed.length + this._fixedLate.length, frame: this._frame.length + this._animate.length, timers: this.time.size,
      statics: this.rays.statics.size, streamEntries: this.stream.entries.size, jobs: this.jobs.pending, commits: this.commits.pending,
      geometries: mem.geometries, textures: mem.textures,
    };
    for (const m of this.modules.values()) if (m.counts) c[m.name] = m.counts(this);
    return c;
  },
};

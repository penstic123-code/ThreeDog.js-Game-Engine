// Engine lifecycle (part of Engine, mixed into Engine.prototype): dispose() and counts() for leak hunting.
//
// Who cleans up what:
//   - DOM listeners: attach to engine.signal (an AbortController); dispose aborts them all at once. Modules and games adding their own window / document listeners do the same:
//       addEventListener('resize', fn, { signal: engine.signal })
//   - UI elements: the engine and modules build UI under engine.uiRoot, removed as a whole on dispose; do not attach to document.body directly.
//   - Events, onFixed / onFrame, clock timers, jobs, stream, ray registrations: core clears them all, modules need not.
//   - Things core does not know about (Worker, physics world, Audio nodes, real-time timers): clean up in the module's dispose(e) hook, called in reverse install order.
//   - GPU memory: every geometry, material and texture in the scene, the assets cache, the post composer, then renderer.dispose().
// Level changes do not come through here: things inside a level register with level.track(handle), and the level removes them itself on change.

import { coded } from './errorHints.js';

const STRINGS = { failed: '[engine] dispose hook of module {name} threw (the rest are still cleaned up)' };

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
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.ready = false; this.paused = true;
    cancelAnimationFrame(this._raf);
    for (const m of [...this.modules.values()].reverse()) {
      if (!m.dispose) continue;
      try { m.dispose(this); } catch (err) { console.error(coded('module-dispose', STRINGS.failed.replace('{name}', m.name)), err); }
    }
    this._abort.abort();
    for (const part of [this.saves, this.audio, this.clock, this.commits, this.jobs, this.threads, this.stream, this.batching, this.rays, this.events]) part.dispose();
    this._fixed = []; this._frame = []; this._hooks = { fixed: [], frame: [], afterRender: [], skip: [] }; this._afterTick = null;
    this.scene.traverse(disposeObject);
    for (const t of [this.scene.background, this.scene.environment]) if (t?.isTexture) t.dispose();
    this.assets.dispose();
    this.post.dispose();
    this.renderer.dispose();
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
    const mem = this.renderer.info.memory;
    const c = {
      listeners: this.events.size, fixed: this._fixed.length, frame: this._frame.length, timers: this.clock.size,
      statics: this.rays.statics.size, streamEntries: this.stream.entries.size, jobs: this.jobs.pending, commits: this.commits.pending,
      geometries: mem.geometries, textures: mem.textures,
    };
    for (const m of this.modules.values()) if (m.counts) c[m.name] = m.counts(this);
    return c;
  },
};

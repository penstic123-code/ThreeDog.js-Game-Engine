// WebGPURenderer keeps one RenderObject per drawn mesh in a strong Set and frees it only on a 'dispose' event of the object, its material or the lights node. A plain three.js
// game writes scene.remove(mesh) and keeps the material, so nothing ever sends that event: the record holds the mesh, its geometry arrays and its GPU buffers until the renderer
// dies (three 0.187; about 66 KB per terrain chunk). geometry.dispose() does not free it and a plain Mesh has no dispose() of its own. WebGLRenderer keeps no such record.
// This sweep closes that whole class for every caller, engine or game, without wrapping three.js: every few seconds it looks through the records for objects no longer under a
// Scene and sends the event itself. A record is a cache, so a re-added object just rebuilds.
// It reads a private three.js field, so the shape is checked on every sweep: a three upgrade that moves it turns the sweep off with one coded warning, never a crash
// (tests/specs/webgpu-release.mjs fails on the same change).
// Plain three.js equivalent: mesh.dispatchEvent({ type: 'dispose' }) after removing a mesh for good.
import { warnOnce } from '../core/base/validate.js';
import { coded } from '../core/base/errorHints.js';
import { notePatch, patchOn } from '../core/scene/threePatches.js';
import { isWebGPU } from './backend.js';

// Why 4: long enough that a pooled mesh out for a moment is left alone, short enough that the records of a fast flight stay a small constant. Costs nothing between sweeps
const EVERY = 4;
// Records looked at per frame. Why a count and not one pass: 20k records in one frame would be the hitch this must never cause (numbers: docs/testing/field/2026-11-05-stress)
const LOOK = 2000;
// Objects released per frame: a release is much dearer than a look (three drops pipelines, bindings and vertex state; about 16 µs each, so 1 ms a frame), and a level unload can drop thousands at once
const FREE = 64;
// three.js Background.js draws the scene's background through this mesh, pushed straight into the render list: never parented, yet in use every frame. No flag marks it, only
// the name; a rename shows as a red check in tests/specs/webgpu-release.mjs, because this mesh would then rebuild every sweep
const BACKGROUND_MESH = 'Background.mesh';

const DISPOSE = { type: 'dispose' };
const SWITCH = 'webgpu-record-sweep';
notePatch(SWITCH, "'dispose' events sent to objects no longer under a Scene, found through WebGPURenderer's private record list, so a mesh dropped with scene.remove frees its record (render/recordSweep.js)", () => {},
  { scope: 'engine renderer', lost: 'on WebGPU: a mesh removed while its material stays in use keeps its memory and GPU buffers until the renderer is disposed, unless the game sends the event itself' });

/** @param {any} o */
const inScene = o => { while (o.parent) o = o.parent; return !!o.isScene; };

/**
 * Drawn on purpose with no Scene above it, every frame or again later: freeing it would rebuild it over and over (and drop its pipeline, a shader compile, when it was the only user).
 * - QuadMesh: every full-screen pass (three's output pass and RenderPipeline, RTT, VSM shadow blur, the engine's post chain and post-effects). Stated even though the next rule
 *   covers renderer.render(quad): renderer.compileAsync(quad, camera, scene) records the game's scene instead.
 * - An empty Scene as the record's scene: renderer.render(notAScene, camera) records three's internal empty fallback Scene, which covers a game's render(mesh | group, camera) and
 *   PMREMGenerator's box mesh. The fallback is module-private, so "empty" stands in for it. A real Scene that was emptied looks the same; its records stay until the Scene holds
 *   anything again, which a growing leak always does.
 * - The background mesh (BACKGROUND_MESH).
 * @param {any} ro
 */
const drawnWithoutScene = ro => ro.object.isQuadMesh === true || ro.scene.children.length === 0 || ro.object.name === BACKGROUND_MESH;

/** Whether a record's object has left every Scene. A live render bundle replays its records whatever its children did, so the bundle decides for them. @param {any} ro */
const detached = ro => !drawnWithoutScene(ro) && !inScene(ro.bundle ?? ro.object);

/** core/engine/Engine.js builds one per WebGPURenderer; core/engine/loop.js steps it after each draw; tests read it */
class RecordSweep {
  /** @param {any} renderer */
  constructor(renderer) {
    this.r = renderer;
    this.off = false;
    this.sweeps = 0;          // finished sweeps, for tests
    this._wait = 0;
    /** @type {any[] | null} the sweep under way: a copy, so three adding and deleting in the Set never meets a walk spread over frames */
    this._list = null;
    this._at = 0;
    this._seen = new Set();   // detached in this sweep
    this._last = new Set();   // detached in the sweep before: only what is in both is released, so a mesh toggled in and out of the scene (a pool) stays
    /** @type {any[]} */
    this._due = [];
  }

  /** @param {number} dt seconds since the last call */
  step(dt) {
    if (this.off) return;
    try {
      if (this._due.length) this._release();
      else if (this._list) this._look();
      else if ((this._wait += dt) >= EVERY) { this._wait = 0; if (patchOn(SWITCH)) this._begin(); }
    } catch (err) { this._stop(String(/** @type {any} */ (err)?.message ?? err)); }
  }

  /** @internal tests and the cost measure: one whole sweep now, slices and all */
  sweepNow() {
    this._wait = EVERY;
    do this.step(0); while (!this.off && (this._list || this._due.length));
  }

  _begin() {
    const objects = this.r._objects;
    if (objects === null) return;   // before renderer.init(): three fills the field there
    const set = objects?._renderObjects;
    if (!(set instanceof Set)) { this._stop('renderer._objects._renderObjects is no longer a Set'); return; }
    if (!set.size) return;
    const first = set.values().next().value;
    if (!first.object?.isObject3D || !first.scene?.isObject3D || !('bundle' in first)) { this._stop('a RenderObject no longer has .object, .scene and .bundle'); return; }
    this._list = Array.from(set);
    this._at = 0;
  }

  _look() {
    const list = /** @type {any[]} */ (this._list), end = Math.min(this._at + LOOK, list.length);
    for (let i = this._at; i < end; i++) if (detached(list[i])) this._seen.add(list[i].object);
    this._at = end;
    if (end < list.length) return;
    const again = new Set();
    for (const o of this._seen) { if (this._last.has(o)) this._due.push(o); else again.add(o); }
    this._last = again; this._seen = new Set(); this._list = null; this.sweeps++;
  }

  _release() {
    for (let n = 0; n < FREE && this._due.length; n++) {
      const o = this._due.pop();
      if (!inScene(o)) o.dispatchEvent(DISPOSE);   // back in a scene since it was collected: leave it
    }
  }

  /** @param {string} why */
  _stop(why) {
    this.off = true; this._list = null; this._due.length = 0; this._seen.clear(); this._last.clear();
    warnOnce(coded('webgpu-records-unread', `WebGPURenderer record sweep turned off: ${why}. Meshes removed while their material stays in use now keep their memory until the renderer is disposed`));
  }
}

/** @internal @param {any} r @returns {RecordSweep | null} */
export const recordSweep = r => isWebGPU(r) ? new RecordSweep(r) : null;

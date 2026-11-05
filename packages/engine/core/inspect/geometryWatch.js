// Dev-only check (called from loop.js after each render once the engine is ready): warn when geometries keep piling up on the renderer that nothing in the scene uses.
// Why: scene.remove(mesh) without geometry.dispose() leaves the geometry counted by the renderer (and, on WebGLRenderer, its GPU buffers allocated) for good. The WebGPU record
// sweep (render/recordSweep.js) cannot close this: a geometry off the scene may be parked for reuse, and only the game knows it will not come back.
// What it compares: renderer.info.memory.geometries minus the distinct geometries reachable in engine.scene. Why not the mesh count: the renderer counts a geometry at its first
// draw, so a big static world counts up as the camera moves while its meshes stay flat, which is not a leak. Clamped at 0 for the same reason (meshes not drawn yet).
// False alarms are worse than none, so it speaks only after a sustained rise with no fall: a streaming game that disposes what it unloads stays flat, a load burst is one step.
// Silent on purpose: leaks slower than MIN_RISE per window. Not told apart: a game that keeps adding to a geometry cache off the scene, or streams through its own second Scene
// without engine.scene, looks like this too once it passes those limits.
// Cost: one scene walk every EVERY seconds, in dev only.
import { warnOnce } from '../base/validate.js';
import { coded } from '../base/errorHints.js';
import { memory } from '../../render/backend.js';

const EVERY = 10;      // seconds between samples
const WINDOW = 12;     // steps looked at together: two minutes
const RISES = 9;       // of those steps, at least this many went up: a steady climb, not a few loads
const MIN_RISE = 100;  // geometries gained over the window

/** @param {any} e the engine (dev and ready only: the caller checks) @param {number} dt seconds since the last call */
export function watchGeometries(e, dt) {
  const w = e._geometryWatch ??= { wait: 0, unused: /** @type {number[]} */ ([]) };
  if ((w.wait += dt) < EVERY) return;
  w.wait = 0;
  const used = new Set();
  e.scene.traverse(/** @param {any} o */ o => { if (o.geometry) used.add(o.geometry); });
  const n = Math.max(0, memory(e.renderer).geometries - used.size), h = w.unused;
  if (h.length && n < h[h.length - 1]) h.length = 0;   // the game is disposing: what came before is not this pattern
  h.push(n);
  if (h.length > WINDOW + 1) h.shift();
  if (h.length <= WINDOW) return;
  let rises = 0;
  for (let i = 1; i < h.length; i++) if (h[i] > h[i - 1]) rises++;
  const gained = h[h.length - 1] - h[0];
  if (rises >= RISES && gained >= MIN_RISE) {
    warnOnce(coded('geometry-undisposed', `${gained} geometries that nothing in the scene uses joined the renderer in the last ${WINDOW * EVERY} s (${n} in all). ` +
      'When a mesh is gone for good, call mesh.geometry.dispose() after removing it (engine.remove does it for you)'), 'geometry-undisposed');
  }
}

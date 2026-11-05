// Spawn search and the camera-relative move input (split out of index.js; the characters API calls these with its engine)
import * as THREE from 'three';
import { xzOf } from '../../core/base/math.js';
import { readParams, keysSchema } from '../../core/base/params.js';

const REQ = { x: 0, z: 0, run: false };   // moveInput() result, reused every step (no allocation)

/** Spiral outward from position for walkable dry ground (characters.findSpawn) */
export function findSpawn(e, position, opts) {
  const [x, z] = xzOf(position);
  readParams('characters.findSpawn()', keysSchema(['minH', 'maxH', 'maxSlope', 'waterMargin']), opts);
  const { minH = -Infinity, maxH = Infinity, maxSlope = 0.3, waterMargin = 0.5 } = opts;   // 0.3: a spawn wants gentler ground than walkableAt, which still applies
  for (let r = 0; r < 4000; r += 6) {
    const a = r * 0.37, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, h = e.surface(px, pz);
    const dry = h > e.waterAt(px, pz) + waterMargin, walk = !e.collision || e.collision.walkableAt(px, pz);
    if (dry && h > minH && h < maxH && e.slope(px, pz) < maxSlope && walk) return new THREE.Vector3(px, h, pz);
  }
  return new THREE.Vector3(x, e.surface(x, z), z);
}

/**
 * Index of the path point to head for from (x, z), starting at i: skips points within reach and points already passed (a later point is closer), so the walker
 * never turns back. Never skips the last point: arriving is the caller's. One rule for walkTo and NPCs; their stuck tests stay apart (walkTo's window has a public
 * option, an NPC's would have to go in its save)
 */
export function nextPoint(path, i, x, z, reach) {
  const dist = p => Math.hypot(p.x - x, p.z - z);
  while (i < path.length - 1 && (dist(path[i]) < reach || dist(path[i + 1]) < dist(path[i]))) i++;
  return i;
}

/** The 'camera' player control as a value (characters.moveInput); returns the reused REQ */
export function moveInput(e) {
  const inp = e.input, a = inp.autopilot || inp.axis;   // autopilot (stress tests, recordings): input.autopilot = { x, y, speed? } (speed: the player hook mods move.speed)
  const f = e.cameraRig ? e.cameraRig.forward() : { x: 0, z: -1 }, rt = e.cameraRig ? e.cameraRig.right() : { x: 1, z: 0 };
  // run is the game's key, not a core default
  REQ.x = f.x * a.y + rt.x * a.x; REQ.z = f.z * a.y + rt.z * a.x; REQ.run = inp.actions.has('run') && inp.down('run');
  return REQ;
}

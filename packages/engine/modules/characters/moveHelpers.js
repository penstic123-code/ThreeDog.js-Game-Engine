// Spawn search and the camera-relative move input (split out of index.js; the characters API calls these with its engine)
import * as THREE from 'three';
import { xzOf } from '../../core/math.js';
import { checkOptionsArg } from '../../core/validate.js';

const REQ = { x: 0, z: 0, run: false, speed: undefined };   // moveInput() result, reused every step (no allocation)

/** Spiral outward from position for walkable dry ground (characters.findSpawn) */
export function findSpawn(e, position, opts) {
  const [x, z] = xzOf(position);
  checkOptionsArg('characters.findSpawn()', opts, ['minH', 'maxH', 'maxSlope', 'waterMargin']);
  const { minH = -Infinity, maxH = Infinity, maxSlope = 0.3, waterMargin = 0.5 } = opts;
  for (let r = 0; r < 4000; r += 6) {
    const a = r * 0.37, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, h = e.surface(px, pz);
    const dry = h > e.waterAt(px, pz) + waterMargin, walk = !e.collision || e.collision.walkableAt(px, pz);
    if (dry && h > minH && h < maxH && e.slope(px, pz) < maxSlope && walk) return new THREE.Vector3(px, h, pz);
  }
  return new THREE.Vector3(x, e.surface(x, z), z);
}

/** The 'camera' player control as a value (characters.moveInput); returns the reused REQ */
export function moveInput(e) {
  const inp = e.input, auto = inp.autopilot, a = auto || inp.axis;   // autopilot (stress tests, recordings): input.autopilot = { x, y, speed }
  const f = e.cameraRig ? e.cameraRig.forward() : { x: 0, z: -1 }, rt = e.cameraRig ? e.cameraRig.right() : { x: 1, z: 0 };
  // run is the game's key, not a core default
  REQ.x = f.x * a.y + rt.x * a.x; REQ.z = f.z * a.y + rt.z * a.x; REQ.run = inp.actions.has('run') && inp.down('run');
  REQ.speed = auto?.speed;   // autopilot can set a speed; without autopilot undefined = the character's own speed
  return REQ;
}

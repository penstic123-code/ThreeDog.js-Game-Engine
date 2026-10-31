// Timeline camera and path steps (helper of Timeline.js): a shot takes the camera over through engine.cameraOverride and gives it back when the run ends;
// a path moves any object (a character, the camera) along a spline. Each function takes the Timeline as `t`.
import * as THREE from 'three';
import { vec3 as v3 } from '../../core/math.js';

/** Camera: { from?, to: { position, lookAt }, duration, ease, fov } or { release: true } */
export function cameraStep(t, c, run) {
  const e = t.engine, cam = e.camera;
  if (c.release) { releaseCamera(t, run); return Promise.resolve(); }
  const st = takeCamera(t, run);
  let fromP, fromL, fromFov, toP, toL;
  const lookOf = l => l?.isObject3D ? l.position : l;          // may look at a moving object
  return t._timed(run, {
    duration: c.duration ?? 1, ease: c.ease ?? 'inOutCubic',
    start: () => {
      fromP = c.from?.position ? v3(c.from.position) : cam.position.clone();
      toP = c.to?.position ? v3(c.to.position) : fromP.clone();
      // start look-at: use it if given, otherwise keep the current view direction at the same distance as the target
      if (c.from?.lookAt) fromL = v3(lookOf(c.from.lookAt));
      else { const d = c.to?.lookAt ? Math.max(1, cam.position.distanceTo(v3(lookOf(c.to.lookAt)))) : 10; fromL = cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(d).add(cam.position); }
      toL = c.to?.lookAt ? v3(lookOf(c.to.lookAt)) : fromL.clone();
      fromFov = c.from?.fov ?? cam.fov;
    },
    step: k => {
      if (c.to?.lookAt?.isObject3D) toL.copy(c.to.lookAt.position);
      cam.position.lerpVectors(fromP, toP, k);
      st.look.lerpVectors(fromL, toL, k);
      cam.lookAt(st.look);
      if (c.fov != null) { cam.fov = fromFov + (c.fov - fromFov) * k; cam.updateProjectionMatrix(); }
      st.override.focus.copy(st.look);
    },
  });
}
/** */
function takeCamera(t, run) {
  const e = t.engine;
  if (!run.cam) {
    run.cam = { prev: e.cameraOverride ?? null, fov: e.camera.fov, look: new THREE.Vector3(), override: { owner: 'timeline', id: run.id, focus: e.focus.clone() } };
    e.cameraOverride = run.cam.override;
  }
  return run.cam;
}
/** */
export function releaseCamera(t, run) {
  const st = run.cam; if (!st) return;
  run.cam = null;
  const e = t.engine;
  if (e.cameraOverride === st.override) e.cameraOverride = st.prev;
  if (e.camera.fov !== st.fov) { e.camera.fov = st.fov; e.camera.updateProjectionMatrix(); }
}

/** Path: { object, points, duration, ease, lookAhead, ground, closed, curve: 'catmullrom'|'centripetal'|'chordal', tension } */
export function pathStep(t, p, run) {
  // a character (Character) can be passed directly
  const e = t.engine, chr = p.object?.root?.isObject3D ? p.object : null, obj = chr ? chr.root : p.object;
  if (!obj || !p.points?.length) return Promise.resolve();
  const pts = p.points.map(x => v3(x));
  if (pts.length === 1) pts.unshift(obj.position.clone());
  const curve = new THREE.CatmullRomCurve3(pts, !!p.closed, p.curve ?? 'centripetal', p.tension ?? 0.5);
  const isCam = obj === e.camera;
  const st = isCam ? takeCamera(t, run) : null;
  const pos = new THREE.Vector3(), ahead = new THREE.Vector3();
  return t._timed(run, {
    duration: p.duration ?? 2, ease: p.ease ?? 'inOutSine',
    step: k => {
      curve.getPointAt(Math.min(1, Math.max(0, k)), pos);
      if (p.ground) pos.y = e.surface(pos.x, pos.z) + (typeof p.ground === 'number' ? p.ground : 0);
      obj.position.copy(pos);
      if (p.lookAhead) {
        const k2 = Math.min(1, k + p.lookAhead);
        if (k2 - k > 1e-4) {
          curve.getPointAt(k2, ahead);
          if (p.upright !== false && !isCam) ahead.y = pos.y;           // keep the character upright, only turn the horizontal heading
          obj.lookAt(ahead);
          if (chr && 'facing' in chr) chr.facing = obj.rotation.y;     // sync the character's own facing too, so it does not turn back after the walk
          if (isCam) st.look.copy(ahead);
        }
      }
      if (isCam) st.override.focus.copy(pos);
    },
  }).then(r => {
    // the path moved the model, not the mover: the character's world record (the player's) catches up once, so a save right after the cutscene has the new
    // place
    if (chr?.recordId && chr.syncRecord) e.ops.allow(() => chr.syncRecord());
    return r;
  });
}

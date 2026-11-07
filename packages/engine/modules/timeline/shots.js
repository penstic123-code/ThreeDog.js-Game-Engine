// Timeline camera and path steps (helper of Timeline.js): a shot takes the camera over with engine.takeCamera (core/ops/holds.js) and gives it back when the run ends;
// a path moves any object (a character, the camera) along a spline. Each function takes the Timeline as `t`.
// One writer: a step writes what it drives only while it is the holder in charge (written). Out of charge its clock runs on and it writes nothing; back in charge it writes where its
// clock is. So a shot under a newer holder of the camera, or a path on a character something above the cutscene has, ends on time and leaves the real owner's values alone.
import * as THREE from 'three';
import { vec3 as v3 } from '../../core/base/math.js';
import { surfaceOr } from '../../core/scene/ground.js';
import { holdFov } from '../../core/scene/view.js';

/** The one check: a timed step whose step(k) runs only while mine() says it is in charge */
const written = (t, run, mine, o) => t._timed(run, { ...o, step: k => { if (mine()) o.step(k); } });
/** Holds the camera now: compared by owner, because engine.cameraOverride is a copy of what takeCamera got */
const onCamera = (t, st) => t.engine.cameraOverride?.owner === st.override.owner;

/** Camera: { from?, to: { position, lookAt }, duration, ease, fov } or { release: true } */
export function cameraStep(t, c, run) {
  const e = t.engine;
  if (c.release) { releaseCamera(t, run); return Promise.resolve(); }
  const st = takeCamera(t, run);
  let fromP, fromL, fromFov, toP, toL;
  const lookOf = l => l?.isObject3D ? l.position : l;          // may look at a moving object
  return written(t, run, () => onCamera(t, st), {
    duration: c.duration ?? 1, ease: c.ease ?? 'inOutCubic',
    start: () => {
      const cam = e.camera;
      fromP = c.from?.position ? v3(c.from.position) : cam.position.clone();
      toP = c.to?.position ? v3(c.to.position) : fromP.clone();
      // start look-at: use it if given, otherwise keep the current view direction at the same distance as the target
      if (c.from?.lookAt) fromL = v3(lookOf(c.from.lookAt));
      else { const d = c.to?.lookAt ? Math.max(1, cam.position.distanceTo(v3(lookOf(c.to.lookAt)))) : 10; fromL = cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(d).add(cam.position); }
      toL = c.to?.lookAt ? v3(lookOf(c.to.lookAt)) : fromL.clone();
      fromFov = c.from?.fov ?? cam.fov;
    },
    step: k => {
      const cam = e.camera;   // read here: a game may assign engine.camera during the shot
      if (c.to?.lookAt?.isObject3D) toL.copy(c.to.lookAt.position);
      cam.position.lerpVectors(fromP, toP, k);
      st.look.lerpVectors(fromL, toL, k);
      cam.lookAt(st.look);
      if (c.fov != null && cam.fov !== undefined) { fromFov ??= cam.fov; holdFov(e, fromFov + (c.fov - fromFov) * k); }   // a real orthographic camera has none
      st.override.focus.copy(st.look);
    },
  });
}
function takeCamera(t, run) {
  const e = t.engine;
  if (!run.cam) {
    // a claim of its own (engine.takeCamera): a named view or a game holding the camera keeps its claim and gets the camera back afterwards.
    // The owner carries the run id so two overlapping runs are two holders, not one overwriting the other.
    const override = { owner: 'timeline:' + run.id, id: run.id, focus: e.focus.clone() };
    run.cam = { look: new THREE.Vector3(), override, hold: e.takeCamera(override.owner, override) };
  }
  return run.cam;
}
export function releaseCamera(t, run) {
  const st = run.cam; if (!st) return;
  run.cam = null;
  st.hold.remove();   // the view comes back with the last holder (core/scene/view.js viewHold)
}

/** Path: { object, points, duration, ease, lookAhead, ground, closed, curve: 'catmullrom'|'centripetal'|'chordal', tension } */
export function pathStep(t, p, run) {
  // a character (Character) can be passed directly
  const e = t.engine, chr = p.object?.root?.isObject3D ? p.object : null, obj = chr ? chr.root : p.object;
  if (!obj || !p.points?.length) return Promise.resolve();
  const pts = p.points.map(x => v3(x));   // before the character is marked: a bad point throws, and nothing would unmark it
  // a character on a path is the cutscene's to drive until the run ends (core/ops/control.js): its keys / walk / behavior pause meanwhile
  if (chr) { t._take(run, chr); t._pathing.set(chr.id, (t._pathing.get(chr.id) ?? 0) + 1); }
  const unpath = () => { if (!chr) return; const n = (t._pathing.get(chr.id) ?? 1) - 1; if (n > 0) t._pathing.set(chr.id, n); else t._pathing.delete(chr.id); };
  if (pts.length === 1) pts.unshift(obj.position.clone());
  const curve = new THREE.CatmullRomCurve3(pts, !!p.closed, p.curve ?? 'centripetal', p.tension ?? 0.5);
  const isCam = obj === e.camera;
  const st = isCam ? takeCamera(t, run) : null;
  const pos = new THREE.Vector3(), ahead = new THREE.Vector3();
  const mine = isCam ? () => onCamera(t, st) : chr ? () => !!t._held.get(chr.id)?.h.placing : () => true;
  return written(t, run, mine, {
    duration: p.duration ?? 2, ease: p.ease ?? 'inOutSine',
    step: k => {
      curve.getPointAt(Math.min(1, Math.max(0, k)), pos);
      if (p.ground) pos.y = surfaceOr(e, pos.x, pos.z, undefined, pos.y) + (typeof p.ground === 'number' ? p.ground : 0);
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
    // place. Not while another owner has it: the path wrote nothing on its last step, and the record is that owner's
    unpath();
    if (chr?.recordId && chr.syncRecord && mine()) e.ops.allow(() => chr.syncRecord());
    return r;
  }, err => { unpath(); throw err; });
}

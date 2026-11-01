// Third-person follow camera: drag (or pointer lock) to rotate, wheel to zoom, stays out of the terrain, smooth follow,
// optional shoulder offset and lock-on framing.
// yaw is which side of the focus the camera sits on: camera = focus + (sin yaw, cos yaw) * distance, so it looks along forward() = -(sin yaw, cos yaw).
// To see a character facing angle f from behind, yaw = f + PI.
// Cutscene takeover: when engine.cameraOverride is set the camera is left alone (see common.js).
// Other cameras: firstPersonCamera, fixedCamera, rtsCamera (top-down strategy); all are engine.cameraRig; switch at runtime with engine.setCamera('firstPerson').
import * as THREE from 'three';
import { rigModule, defineRig, YAW_RIG, clickToLock, releaseLock } from './common.js';
import { setProjection } from './projection.js';
import { checkOptions } from '../../core/validate.js';

export class FollowCamera {
  /** yaw/pitch initial angles (yaw: see the top of this file); distance (min/max zoom range); height how high on the character to look; smoothing follow smoothness;
   *  sensitivity drag sensitivity; minPitch/maxPitch pitch range; zoomStep zoom ratio per wheel notch; groundClearance lowest camera height above the ground;
   *  shoulder meters to the right of the target the camera aims (over-the-shoulder; negative = left shoulder, 0 = centered);
   *  pointerLock click locks the mouse (no dragging; the press that locks is swallowed, swallowLockClick: false delivers it) */
  constructor(engine, { yaw = 0.8, pitch = 0.42, distance = 13, minDistance = 4, maxDistance = 45, height = 1.4, smoothing = 10,
    sensitivity = 1, minPitch = 0.05, maxPitch = 1.35, zoomStep = 0.1, groundClearance = 1.2, invertY = false, shoulder = 0, pointerLock = false, swallowLockClick = true, projection = 'perspective', size = 20 } = {}) {
    this.projection = projection; this.size = size;   // 'orthographic': size = world units of view height (the wheel changes size there, clamped to the min/max distance ratio)
    this.size0 = size; this.distance0 = distance;
    Object.assign(this, { engine, yaw, pitch, distance, minDistance, maxDistance, height, smoothing, sensitivity, minPitch, maxPitch, zoomStep, groundClearance });
    Object.assign(this, { invertY, shoulder, pointerLock, swallowLockClick });
    this.target = null;
    /** Lock-on framing set by frame(): { target, strength } or null */
    this.framing = null;
    this.focus = new THREE.Vector3();
  }
  /** Follow obj; opts { distance, height } temporarily override distance/height (for driving), restored on the next follow */
  follow(obj, opts) {
    if (this._saved) { Object.assign(this, this._saved); this._saved = null; }
    if (opts) { this._saved = { distance: this.distance, height: this.height }; if (opts.distance != null) this.distance = opts.distance; if (opts.height != null) this.height = opts.height; }
    this.target = obj; if (obj) this.focus.copy(obj.position);
  }

  /**
   * Lock-on framing: each frame turn yaw toward "behind the followed object, looking at target" (forward() turns with it, so camera-relative movement strafes around the target).
   * Mouse / stick yaw is ignored while framing; frame(null) hands yaw back. strength: how fast it turns (1/s). Set it once when the lock starts, not every frame
   * @example engine.cameraRig.frame(enemy.object); player.faceMode = 'target'; player.faceTarget = enemy.object;
   */
  frame(target, { strength = 6 } = {}) { this.framing = target ? { target, strength } : null; }
  onEnter(switched) { clickToLock(this, switched); setProjection(this.engine.camera, this.projection, this.size); }
  onExit() { releaseLock(this); }
  onOverride(on) { if (on) releaseLock(this, true); }

  update(dt, input) {
    const cam = this.engine.camera, fr = this.framing;
    if (fr && this.target) {
      const t = fr.target.position ?? fr.target, p = this.target.position;
      const want = Math.atan2(p.x - t.x, p.z - t.z), d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
      this.yaw += d * Math.min(1, dt * fr.strength);
    }
    if (input.enabled) {
      if (!fr) this.yaw -= input.look.dx * 0.005 * this.sensitivity;
      if (!this.lockPitch) this.pitch = Math.min(this.maxPitch, Math.max(this.minPitch, this.pitch + input.look.dy * 0.004 * this.sensitivity * (this.invertY ? -1 : 1)));
      if (input.look.zoom && this.projection === 'orthographic') {
        // distance shows nothing in an orthographic view: zoom `size`, clamped to the same min/max ratio as distance, same wheel feel
        const lo = this.size0 * this.minDistance / this.distance0, hi = this.size0 * this.maxDistance / this.distance0;
        this.size = Math.min(hi, Math.max(lo, this.size * (1 + input.look.zoom * this.zoomStep)));
        cam.orthoSize = this.size; cam.updateProjectionMatrix();
      } else if (input.look.zoom) this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, this.distance * (1 + input.look.zoom * this.zoomStep)));
    }
    if (!this.target) return;
    const want = this.target.position;
    this.focus.lerp(want, 1 - Math.exp(-this.smoothing * dt));
    // shoulder: shift the aim point (and so the camera) sideways along right()
    const sh = this.shoulder, fx = this.focus.x + Math.cos(this.yaw) * sh, fy = this.focus.y + this.height, fz = this.focus.z - Math.sin(this.yaw) * sh, cp = Math.cos(this.pitch);
    const place = d => cam.position.set(fx + Math.sin(this.yaw) * cp * d, fy + Math.sin(this.pitch) * d, fz + Math.cos(this.yaw) * cp * d);
    place(this.distance);
    // Occlusion: pull in when a trunk or house blocks the view (at once); ease back out when clear
    const allowed = this.engine.collision && this.avoidOcclusion !== false ? this.engine.collision.cameraDistance({ x: fx, y: fy, z: fz }, cam.position, this.distance) : this.distance;
    this._d = this._d ?? this.distance;
    this._d = allowed < this._d ? allowed : this._d + (allowed - this._d) * (1 - Math.exp(-3 * dt));
    place(this._d);
    const ground = this.engine.surface(cam.position.x, cam.position.z) + this.groundClearance;
    if (cam.position.y < ground) cam.position.y = ground;
    cam.lookAt(fx, fy, fz);
  }
}

// Forward/right directions relative to the camera heading (for character movement), and the focus point: shared YAW_RIG
Object.assign(FollowCamera.prototype, YAW_RIG);

/**
 * Third-person follow camera module. Installs engine.cameraRig; engine.cameraRig.follow(object).
 * Over the shoulder: followCamera({ distance: 3, shoulder: 0.7, pitch: 0.15, pointerLock: true }); lock-on: engine.cameraRig.frame(target)
 * Top-down game: followCamera({ pitch: 1.1, distance: 30, minDistance: 15, lockPitch: true })
 */
export function followCamera(opts = {}) { return rigModule('follow', opts); }
defineRig('follow', (e, opts) => {
  checkOptions('followCamera()', opts, ['yaw', 'pitch', 'distance', 'minDistance', 'maxDistance', 'height', 'smoothing', 'sensitivity', 'minPitch', 'maxPitch',
    'zoomStep', 'groundClearance', 'invertY', 'lockPitch', 'shoulder', 'pointerLock', 'swallowLockClick', 'projection', 'size']);
  const c = new FollowCamera(e, opts); if (opts.lockPitch) c.lockPitch = true; return c;
});

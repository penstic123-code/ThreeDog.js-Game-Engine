// Particles module: dust, falling leaves, splashes, chimney smoke, sparks... one effect = one THREE.Points (one draw call).
// Particles live in a ring buffer (the oldest are overwritten when full), updated on the CPU every frame with fixed-length arrays; no object per particle.
// Particles are affected by fog and do not write depth (they do not hide translucent objects behind); an effect with no live particles is not drawn at all.
//
//   engine.use(particles());
//   engine.particles.define('dust', { max: 300, lifetime: [0.6, 1.2], speed: [0.5, 1.5], direction: [0, 1, 0], spread: 1.2,
//                                     gravity: -1, drag: 1.5, size: [0.3, 0.8], color: [0xbbbbbb, 0xdddddd], opacity: [0.6, 0] });
//   engine.particles.emit('dust', { x, y, z }, { count: 20 });                                  // burst of 20 at once
//   engine.particles.emit('dust', pos, { count: 10, overrides: { color: [0xff8800, 0x552200] } }); // temporary param overrides (this batch only)
//   const h = engine.particles.attach('smoke', chimney, { rate: 8, offset: [0, 2, 0] });  // keep emitting while following an object
//   h.remove();   h.rate = 3;   h.active = false;
//   engine.particles.count('dust')   // live particle count; no name = all
//
// Params (all optional; below are the neutral fallback values):
//   max 120         max particles alive at once (halved when engine.tier is 'low')
//   lifetime [1,2]  seconds each particle lives (random range)
//   rate 10         particles per second by default for attach
//   speed [0.5,1.5] initial speed (m/s); direction [0,1,0] emit direction; spread 0.5 max angle off the direction (radians, pi = all directions)
//   area 0          radius the spawn point is randomly spread over (meters); a box [x,y,z] also works
//   gravity -2      vertical acceleration (negative falls, positive rises, e.g. smoke)
//   drag 0.5        air drag (fraction of speed lost per second)
//   wind 0          how much wind pushes it (follows engine.uniforms.uWind strength, direction windDir); windDir [1,0,0.3]
//   size [0.3,0.3]  size (meters) at birth / at death
//   color [0xcccccc,0xcccccc]  color at birth / at death
//   opacity [0.8,0] opacity at birth / at death
//   texture         asset name (a texture registered in engine.assets) or URL; default is a soft round dot
//   blending 'normal' | 'additive' (use additive for sparks and magic motes)
//   spin 0          texture rotation speed (radians/s, random sign) - for falling leaves
//   worldSpace true with attach, particles stay in the world after birth (smoke trails behind); false = emit direction rotates with the object (e.g. exhaust, muzzle).
//                   after birth particles always move in world coordinates and are not dragged along by the object
//   fog true        affected by fog
//   maxPixels 512   largest on-screen size of one particle (pixels), so smoke drifting past the camera does not fill the screen
//
// Style pack: style.particles[name] = {...same params...} sits under the define() params (what define sets wins).
//         so a game can write only engine.particles.define('leaves', { max: 200 }) and leave color and texture to the style pack.
//         style.particles.default = {...} is the fallback for all effects.
//   The style pack can also define effects directly: a name in style.particles that the game never define()d is defined from the style pack on the first emit/attach.
import * as THREE from 'three';
import { vec3 } from '../../core/math.js';
import { Effect, NEUTRAL, KEYS } from './effect.js';
import { checkOptions, checkOptionsArg, warnMissing } from '../../core/validate.js';
const _vs = new THREE.Vector2();   // canvas CSS size (particle point scale follows the canvas height, not the window)
/** @import { ModuleDef } from '../../types/core' */
/** @import { Object3D, PositionLike } from '../../types/common' */
/** @import { ParticleEffect, ParticleEmitter, ParticleOptions } from '../../types/gameplay' */

/** engine.particles */
export class Particles {
  /** @internal */
  constructor(engine) {
    /** @internal */ this.engine = engine;
    /** Defined effects @type {Map<string, ParticleEffect>} */
    this.effects = new Map();
    /** @internal */ this.emitters = new Set();
    /** @internal */ this._dir = new THREE.Vector3(); this._up = new THREE.Vector3(); this._t1 = new THREE.Vector3(); this._t2 = new THREE.Vector3();
    /** @internal */ this._q = new THREE.Quaternion();
    /** @internal */ this._o = new THREE.Vector3();
    /** @internal */ this._e = new THREE.Vector3();
  }

  /** @internal */
  _styleFor(name) { const s = this.engine.style.particles || {}; return { ...(s.default || {}), ...(s[name] || {}) }; }

  /**
   * Define an effect (same name replaces it, and emitters attached to it move to the new definition); params sit on top of the style
   * pack preset. Returns the effect object: .points is its THREE.Points, .material is the shader material
   * @param {string} name
   * @param {ParticleOptions} [opts]
   * @returns {ParticleEffect}
   */
  define(name, opts = {}) {
    checkOptions(`particles.define('${name}')`, opts, KEYS);
    const old = this.effects.get(name);
    const o = { ...NEUTRAL, ...this._styleFor(name), ...opts };
    const fx = new Effect(this, name, o);
    this.effects.set(name, fx);
    // emitters attached to the old effect keep running on the new one (redefining tunes an effect, it does not stop it)
    if (old) { for (const h of this.emitters) if (h.fx === old) h.fx = fx; old.dispose(); }
    return fx;
  }
  /**
   * Whether this effect has been defined
   * @param {string} name
   * @returns {boolean}
   */
  has(name) { return this.effects.has(name); }
  /** @internal */
  _get(name) {
    let fx = this.effects.get(name);
    if (!fx && this.engine.style.particles?.[name]) fx = this.define(name);
    if (!fx) warnMissing('particle', name, [...this.effects.keys(), ...Object.keys(this.engine.style.particles || {}).filter(k => k !== 'default' && !this.effects.has(k))]);
    return fx;
  }

  /**
   * Burst: emit count particles at once (default 10) at position (Vector3 / Object3D / [x, y, z] / {x, y, z}). overrides affect this batch only (color, speed, direction...; max/texture/blending cannot be changed temporarily)
   * @param {string} name
   * @param {PositionLike} position
   * @param {{ count?: number, overrides?: ParticleOptions | null }} [opts]
   * @returns {void}
   */
  emit(name, position, opts = {}) {
    checkOptionsArg(`particles.emit('${name}')`, opts, ['count', 'overrides']);
    const { count = 10, overrides = null } = typeof opts === 'object' && opts ? opts : {};
    const fx = this._get(name); if (!fx) return;
    if (overrides) checkOptions(`particles.emit('${name}') overrides`, overrides, KEYS);
    fx.spawn(vec3(position, this._e), count, overrides ? { ...fx.o, ...overrides } : fx.o, null);
  }

  /**
   * Keep emitting while following an object: rate per second, offset in the object's local coordinates [x, y, z] (meters). Returns a handle { remove(), rate, active } (active = false pauses)
   * @param {string} name
   * @param {Object3D} object3d
   * @param {{ rate?: number, offset?: number[], overrides?: ParticleOptions | null }} [opts]
   * @returns {ParticleEmitter}
   */
  attach(name, object3d, opts = {}) {
    checkOptions(`particles.attach('${name}')`, opts, ['rate', 'offset', 'overrides']);
    const { rate, offset = [0, 0, 0], overrides = null } = opts;
    if (overrides) checkOptions(`particles.attach('${name}') overrides`, overrides, KEYS);
    const fx = this._get(name); if (!fx) return { remove() {}, rate: 0, active: false };
    const h = { fx, object: object3d, rate: rate ?? fx.o.rate, offset, overrides, active: true, acc: 0, remove: () => { h.active = false; this.emitters.delete(h); } };
    this.emitters.add(h);
    return h;
  }

  /**
   * Live particle count (no name = all)
   * @param {string} [name]
   * @returns {number}
   */
  count(name) {
    if (name) return this.effects.get(name)?.alive ?? 0;
    let n = 0; for (const fx of this.effects.values()) n += fx.alive; return n;
  }

  /**
   * Clear one effect's (or all) particles
   * @param {string} [name]
   * @returns {void}
   */
  clear(name) { for (const fx of name ? [this.effects.get(name)].filter(Boolean) : this.effects.values()) { fx.life.fill(0); fx.aAlpha.array.fill(0); fx.alive = 0; fx.points.visible = false; } }

  /**
   * Update all effects every frame (called by the module each frame)
   * @param {number} dt
   * @returns {void}
   * @internal
   */
  update(dt) {
    const cam = this.engine.camera, pr = this.engine.renderer.getPixelRatio(), scale = this.engine.renderer.getSize(_vs).y * pr / (cam.orthoSize ? cam.orthoSize / cam.zoom : 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));   // orthographic: pixels per world unit
    for (const h of this.emitters) {
      if (!h.active) continue;
      if (!h.object.parent) { h.remove(); continue; }   // object removed from the scene: stop automatically
      h.acc += dt * h.rate;
      const n = Math.floor(h.acc);
      if (n <= 0) continue;
      h.acc -= n;
      // merged params are cached on the handle (re-merged only when overrides is a new object), not spread every frame
      if (h._ov !== h.overrides || h._base !== h.fx.o) { h._ov = h.overrides; h._base = h.fx.o; h._merged = h.overrides ? { ...h.fx.o, ...h.overrides } : h.fx.o; }
      const o = h._merged;
      h.object.updateWorldMatrix(true, false);
      const p = this._o.set(h.offset[0], h.offset[1], h.offset[2]).applyMatrix4(h.object.matrixWorld);
      h.object.getWorldQuaternion(this._q);
      h.fx.spawn(p, n, o, o.worldSpace === false ? this._q : null);
    }
    for (const fx of this.effects.values()) { fx.material.uniforms.uScale.value = scale; fx.update(dt); }
  }
}

/**
 * Particles -> engine.particles
 * @returns {ModuleDef<Particles>}
 */
export function particles() {
  let p = null;
  return { name: 'particles', label: 'Particles', stage: 'presentation', presentation: true, install(e) { p = new Particles(e); return p; }, frame(dt) { p.update(dt); },
    counts() { return { alive: p.count(), emitters: p.emitters.size }; } };   // engine.counts().particles
}

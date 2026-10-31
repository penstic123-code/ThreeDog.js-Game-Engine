// Character: procedural rig (from the style pack, gray capsule without one) or glTF model + procedural animation (walk, run, swim, idle breathing) + movement control (ground snap, collision, slope limit, swimming).
// Used by both player and NPCs. To switch to a skeletal glTF model later, pass model + clips (or an animation state machine config); control logic stays the same.
// The mover owns position: only the mover (movers/) changes a character's position inside move(); other systems (pathfinding, triggers, vehicles, loading) request movement via placeAt (teleport), move (direction), enter / exit (vehicles).
// Characters backed by a world record (the player, recordId = 'player') write position and motion state back to the record after every move / placeAt / enter / exit; the record is saved, world splits near/far by it, the model is just its look.
// Radius and step height default to engine.movement (the single source of "can walk through" parameters); passing radius / stepHeight overrides it for this character only.
// How to walk is decided by the mover (movers/: 'simple' default, 'rapier' character controller); feel parameters are identical for both.
import * as THREE from 'three';
import { makeMaterial } from '../../render/materials.js';
import { xzOf } from '../../core/math.js';
import { warnOnce, warnMissing } from '../../core/validate.js';
import { findClip } from '../../core/Animator.js';
import { simpleMover } from './movers/simple.js';
import { rapierMover } from './movers/rapier.js';
import { loadAssetModel } from './assetModel.js';

const STRINGS = { noClip: 'character has no skeletal animation; playAction(\'{name}\') skipped (the model needs this action)' };
const MOVERS = { simple: simpleMover, rapier: rapierMover };
// Default action names for the clips shorthand (character state -> glTF action name)
const DEFAULT_CLIPS = { idle: 'Idle', walk: 'Walk', run: 'Run', swim: 'Swim', jump: 'Jump', fall: 'Fall', drive: 'Drive' };

// Options Character understands (shared by player and NPC)
export const CHARACTER_KEYS = ['colors', 'speed', 'runSpeed', 'radius', 'canSwim', 'swimDepth', 'swimSpeed', 'turnSpeed', 'acceleration', 'gravity',
  'jumpSpeed', 'stepHeight', 'airControl', 'coyoteTime', 'canJump', 'model', 'clips', 'animation', 'mover', 'faceMode', 'faceTarget'];
const FACE_MODES = ['move', 'camera', 'target', 'manual'];

// Neutral placeholder when the style pack draws no character: one gray capsule, no limbs (the shape belongs to style packs)
function capsule(color) {
  const body = new THREE.Group(); body.position.y = 0.85;
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 12).translate(0, -0.05, 0), makeMaterial('character', { color }));
  m.castShadow = true; body.add(m);
  const root = new THREE.Group(); root.add(body);
  return { root, body };
}

export class Character {
  /**
   * @param engine
   * @param o  colors: { body, skin, legs, hair } (default from style pack style.character.colors)
   *           speed walk speed, runSpeed run speed (m/s), radius collision radius
   *           canSwim whether it can swim (false: never enters water), swimDepth water depth at which swimming starts, swimSpeed swim speed multiplier
   *           turnSpeed how fast it turns, acceleration how fast it starts/stops
   *           jump and gravity: gravity (negative), jumpSpeed takeoff speed, stepHeight step height it can climb directly, airControl air steering 0-1,
   *                      coyoteTime how long after leaving a ledge a jump is still allowed, canJump
   *           model + clips: optional glTF model and action-name map { idle, walk, run, swim, jump, fall, drive } (shorthand for animation)
   *           animation: animation state machine config (see core/Animator.js), state names are character state names; without walk/run, move (blend tree, param speed) is used
   *           mover: 'simple' (default) | 'rapier' (Rapier character controller, needs the rigid module)
   *           faceMode which way it turns each move: 'move' (default, toward its velocity) | 'camera' (along cameraRig.forward(), over-the-shoulder aiming)
   *                    | 'target' (toward faceTarget: Object3D / Vector3 / { x, z }, lock-on strafing) | 'manual' (only face() turns it); both are plain properties, change them at any time
   *           model may be a registered asset name (default style.character.model): placeholder body until it loads, then swapped in (assetModel.js)
   *           without model: style pack style.character.create(engine, colors) may return a custom procedural character (rig format below), else a gray capsule
   */
  constructor(engine, { colors = {}, speed = 4.5, runSpeed = 7, radius = engine.movement.radius, canSwim = true, swimDepth = 1.0, swimSpeed = 0.45,
    turnSpeed = 10, acceleration = 12, gravity = -24, jumpSpeed = 8, stepHeight = engine.movement.stepHeight, airControl = 0.35, coyoteTime = 0.12, canJump = true,
    model = null, clips = null, animation = null, mover = 'simple', faceMode = 'move', faceTarget = null } = {}) {
    this.engine = engine;
    Object.assign(this, { speed, runSpeed, radius, canSwim, swimDepth, swimSpeedFactor: swimSpeed, turnSpeed, acceleration, gravity, jumpSpeed, stepHeight, airControl, coyoteTime, canJump });
    if (!FACE_MODES.includes(faceMode)) warnMissing('faceMode', faceMode, FACE_MODES);
    this.faceMode = faceMode; this.faceTarget = faceTarget;
    this.vy = 0; this.grounded = true; this._coyote = 0; this._jumpBuffer = 0; this._push = 0;
    this.onStep = null; this.onLand = null;
    this.root = new THREE.Group();
    this.velocity = new THREE.Vector2();
    this.facing = 0; this.phase = 0; this.moveAmount = 0;
    this.swimming = false; this.state = 'idle';
    this.vehicle = null; this.anim = null;
    /** false while a model named by asset loads (placeholder shows); await whenReady */
    this.ready = true;
    /** id of the world record ('player' for the player); once set, position, facing and motion state are written back to it. Do not world.move this record directly; use placeAt @type {string | null} */
    this.recordId = null;
    if (!MOVERS[mover]) warnMissing('mover', mover, Object.keys(MOVERS));
    const simple = simpleMover(this);
    this.mover = mover === 'rapier' ? rapierMover(this, simple) : simple;
    // default look comes from style pack style.character.colors; neutral gray without a style pack
    const c = { body: 0x8a8a8a, skin: 0xc8bfb5, legs: 0x5a5a5a, hair: 0x4a4a4a, ...(engine.style.character?.colors || {}), ...colors };

    model ??= engine.style.character?.model ?? null;
    if (model && typeof model !== 'string') { this._useModel(model, clips, animation); return; }
    // style-pack procedural character: rig = { root, body?, head?, joints?: { name: Group }, limbs: [{ joint, offset: 0 | Math.PI, amp, kind: 'arm'|'leg', side? }] }
    this._useRig(engine.style.character?.create?.(engine, c) || capsule(c.body));
    if (model) this._whenReady = loadAssetModel(this, model, m => this._useModel(m, clips, animation));
  }
  _useModel(model, clips, animation) {
    const engine = this.engine; this.root.add(model);
    const states = {};
    // default names only where the model has the clip (a model without Swim is fine); names the game wrote are always kept so a typo is reported
    const have = model.userData.animations || [];
    for (const [st, clip] of Object.entries(DEFAULT_CLIPS)) if (findClip(have, clip)) states[st] = { clip };
    for (const [st, clip] of Object.entries(clips || {})) states[st] = { clip };
    this.anim = engine.assets.animate(model, { ...engine.style.character?.animation, states, ...(animation || {}) });
  }
  _useRig(rig) {
    this.root.add(rig.root); this._rig = rig;
    this.hips = rig.body || rig.root; this.head = rig.head || null;
    this.bodyBase = this.hips.position.y;
    this.limbs = rig.limbs || [];
    // named joints (lowpoly humanoid: armL armR legL legR) become properties so game poses can grab them; never shadow a Character field
    for (const k in rig.joints || {}) if (!(k in this)) this[k] = rig.joints[k];
  }

  /** Request a jump (call when the jump key is pressed; has a jump buffer, so pressing slightly before landing counts) */
  jump() { if (this.canJump) this._jumpBuffer = 0.12; }

  /**
   * Move at a fixed velocity (m/s, world x/z) for `seconds`, ignoring the direction passed to move() and without turning: knockback, dodge-roll displacement, lunges.
   * Gravity, collision and ground snap still apply; move() must still be called every fixed step (the default player control does)
   * @example player.push(-toEnemy.x * 6, -toEnemy.z * 6, 0.15)   // knocked back, still facing the attacker
   */
  push(vx, vz, seconds) { this._pushX = vx; this._pushZ = vz; this._push = seconds; }

  /** Settles (never rejects) once a model named by asset is swapped in or failed; already settled otherwise */
  get whenReady() { return this._whenReady ?? Promise.resolve(); }
  get position() { return this.root.position; }
  /** The character's three.js root object (= root): add children, set visible, scale on it */
  get object() { return this.root; }
  addTo(scene = this.engine.scene) { scene.add(this.root); return this; }
  /** Place on the ground at a position (Vector3 / Object3D / [x, y, z] / { x, z }) */
  placeAt(position) { const [x, z] = xzOf(position); this.root.position.set(x, this.engine.surface(x, z), z); this._store(); return this; }
  /** Write position and motion state back to the world record (only if recordId is set; saveMotion writes into the record without allocating) @internal */
  _store() { const id = this.recordId; if (id) { const W = this.engine.world; this.saveMotion(W.get(id)); W.move(id, this.root.position); } }
  /** After moving root yourself (a cutscene path, a scripted pose): write position and motion back to the world record, so a save right after has it. Returns this */
  syncRecord() { this._store(); return this; }

  /**
   * Move along a direction (call once per fixed step). dirX/dirZ is a world-space direction (length 0-1), run toggles running.
   * How it walks is decided by this.mover ('simple' default / 'rapier'); while driving it follows the seat.
   */
  move(dirX, dirZ, run, dt, speedOverride) {
    if (this.vehicle) { this.root.position.copy(this.vehicle.seatPosition()); this.moveAmount = Math.abs(this.vehicle.speed); this.state = 'drive'; }
    else this.mover.move(dirX, dirZ, run, dt, speedOverride);
    this._store();
  }

  /** Enter a vehicle (returned by rigid.addVehicle): hides the character and stops movement; the player's camera follows the car. No-op if the vehicle already has a driver */
  enter(vehicle) {
    if (this.vehicle || vehicle.driver) return;
    const e = this.engine;
    this.vehicle = vehicle; vehicle.driver = this;
    if (e.player === this) this._driveCtx = e.input.push('vehicle', { pass: true });   // driving: brake lives in this context, walking-only keys are shadowed
    this.root.visible = false; this.velocity.set(0, 0); this.vy = 0; this.swimming = false; this.state = 'drive'; this._store();
    if (e.player === this) e.cameraRig?.follow(vehicle.object, vehicle.camera);   // driving: forward/back keys throttle, left/right steer, brake key (action brake)
    e.events.emit('vehicle:enter', { character: this, vehicle });
  }
  /** Exit: step out beside the door, camera returns to the character */
  exit() {
    const v = this.vehicle, e = this.engine;
    if (!v) return;
    v.drive(0, 0, 1); v.driver = null; this.vehicle = null;
    this._driveCtx?.remove(); this._driveCtx = null;
    this.placeAt(v.exitPosition()); this.root.visible = true; this.grounded = true; this.state = 'idle';
    if (e.player === this) e.cameraRig?.follow(this.root);
    e.events.emit('vehicle:exit', { character: this, vehicle: v });
  }
  /** Dispose this character completely: exit the vehicle first, release animation and mover, remove from the scene and dispose geometries and materials (engine.remove) */
  dispose() {
    this._disposed = true;   // a model still loading by asset name is dropped on arrival
    this.exit();
    this.anim?.dispose();
    this.mover.dispose?.();
    this.engine.remove(this.root);
  }
  /**
   * Copy motion state into a plain object (written into out, in place, no allocation): velocity, vertical speed, facing, move amount, grounded, swimming (animation state is stored by the caller).
   * Why: the model is only a presentation of world data, torn down when far and rebuilt on load; keeping these in data lets loadMotion continue after a rebuild,
   * so running continuously and "save -> load -> continue" give the same result (NPCs, future enemies and zombies all use it).
   */
  saveMotion(out = {}) {
    out.vx = this.velocity.x; out.vz = this.velocity.y; out.vy = this.vy; out.facing = this.facing; out.amount = this.moveAmount;
    out.grounded = this.grounded; out.swimming = this.swimming; out.coyote = this._coyote;
    return out;
  }
  /** Restore motion state from a saveMotion plain object (call after building the model / loading; missing fields keep defaults) */
  loadMotion(m) {
    if (!m) return this;
    this.velocity.set(m.vx ?? 0, m.vz ?? 0); this.vy = m.vy ?? 0; this.facing = m.facing ?? 0; this.root.rotation.y = this.facing;
    this.moveAmount = m.amount ?? 0; this.grounded = m.grounded ?? true; this.swimming = !!m.swimming; this._coyote = m.coyote ?? 0;
    return this;
  }
  /** Play a one-shot action (e.g. 'wave', returns to the previous state when done); procedural characters have no actions, warn once and skip */
  playAction(name) {
    if (this.anim) this.anim.action(name);
    else warnOnce(STRINGS.noClip.replace('{name}', name));
  }

  /** Ground type under the feet (from the ground API, mapped via the style pack footstepMap; 'water' while swimming) */
  groundType() {
    if (this.swimming) return this.engine.style.footstepMap?.water ?? 'water';
    const p = this.root.position, t = this.engine.groundType(p.x, p.z);
    const map = this.engine.style.footstepMap || {};
    return map[t] ?? t;
  }

  /**
   * Turn at once to face a point (Object3D / Vector3 / { x, z }) or an angle in radians (0 = +Z, PI / 2 = +X). With faceMode 'manual' this is the only thing that turns the character
   * @example npc.face(engine.player); player.face(Math.PI)
   */
  face(target) {
    if (typeof target === 'number') this.facing = target;
    else { const [x, z] = xzOf(target); this.facing = Math.atan2(x - this.root.position.x, z - this.root.position.z); }
    this.root.rotation.y = this.facing;
  }

  /** Call every frame: play animation */
  animate(dt) {
    const sp = this.moveAmount, t = this.engine.elapsed, st = this.state;
    this.phase += dt * (2.2 + sp * 1.25);
    const s = Math.sin(this.phase);
    // footstep event: fires once per foot landing (swing direction flips); model and procedural animation share this rhythm
    if (this.onStep && this.grounded && sp > 0.4 && Math.sign(s) !== Math.sign(this._lastS ?? s)) this.onStep(this.groundType());
    this._lastS = s;
    if (this.anim) {
      const a = this.anim;
      a.set('speed', sp);
      // state missing in the model: walk/run fall back to move (blend tree), then to idle
      a.go(a.states[st] ? st : (st === 'walk' || st === 'run') && a.states.move ? 'move' : 'idle');
      return;
    }
    if (st === 'drive') return;
    const amp = Math.min(1, sp / this.runSpeed + 0.35);
    let bob = 0, lean = 0;
    for (const L of this.limbs) {
      let rx = 0, rz = 0;
      if (st === 'swim') { rx = Math.sin(this.phase * (L.kind === 'arm' ? 0.9 : 1.4) + L.offset) * (L.kind === 'arm' ? 1.6 : 0.5); rz = L.kind === 'arm' ? 0.4 * (L.side || 0) : 0; }
      else if (st === 'jump' || st === 'fall') { rx = L.kind === 'leg' ? (L.offset ? -0.5 : 0.7) : -0.6; rz = L.kind === 'arm' ? 0.5 * (L.side || 0) : 0; }
      else if (sp > 0.4) rx = Math.sin(this.phase + L.offset) * L.amp * amp;
      else rx = L.kind === 'arm' ? Math.sin(t * 1.5) * 0.04 : 0;
      L.joint.rotation.x = rx; if (L.kind === 'arm') L.joint.rotation.z = rz || 0.05 * (L.side || 0);
    }
    if (st === 'swim') lean = 1.0;
    else if (sp > 0.4 && this.grounded) { bob = Math.abs(Math.cos(this.phase)) * 0.08 * amp; lean = sp / this.runSpeed * 0.25; }
    else if (this.grounded) bob = Math.sin(t * 2) * 0.01;
    this.hips.position.y = this.bodyBase + bob;
    this.hips.rotation.x = lean;
    if (this.head) this.head.rotation.x = -lean * 0.6;
  }
}

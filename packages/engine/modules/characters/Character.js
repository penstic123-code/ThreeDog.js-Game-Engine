// Character: a body from a model asset (procedural rig from an asset pack, or a glTF model; gray capsule without one) + procedural animation (walk, run, swim, idle breathing)
// + movement control (ground snap, collision, slope limit, swimming).
// Used by both player and NPCs; a skeletal glTF body takes model + clips (or an animation state machine config), control logic stays the same.
// The mover owns position: only the mover (movers/) changes a character's position inside move(); other systems (pathfinding, triggers, vehicles, loading)
// request movement via placeAt (teleport), move (direction), enter / exit (vehicles).
// Characters backed by a world record (the player, recordId = 'player') write position and motion state back to the record after every move / placeAt / enter / exit;
// the record is saved, world splits near/far by it, the model is just its look.
// Radius and step height default to engine.movement (the single source of "can walk through" parameters); passing radius / stepHeight overrides it for this character only.
// How to walk is decided by the mover (movers/: 'simple' default, 'rapier' character controller); feel parameters are identical for both.
// The procedural body (capsule, rig read from a model asset, limb swing) is in proceduralRig.js; loading a body by asset name in assetModel.js.
import * as THREE from 'three';
import { xzOf } from '../../core/math.js';
import { placeY } from '../../core/ground.js';
import { warnOnce, warnMissing } from '../../core/validate.js';
import { reportError } from '../../core/errors.js';
import { simpleMover } from './movers/simple.js';
import { rapierMover } from './movers/rapier.js';
import { manualMover } from './movers/manual.js';
import { moveStacks, stat, jumpOf, WATER_MODES } from './movers/common.js';
import { stateOf, detach, registry } from './movers/support.js';
import { loadAssetModel, buildNow } from './assetModel.js';
import { NO_CHARACTER, capsule, useRig, animateRig, rigFromObject, tintParts } from './proceduralRig.js';
import { walkTo } from './walkTo.js';
import { useModel } from './useModel.js';
import { codedError } from '../../core/errorHints.js';

const STRINGS = { noClip: 'character has no skeletal animation; playAction(\'{name}\') skipped (the model needs this action)' };
const MOVERS = { simple: simpleMover, rapier: rapierMover, manual: manualMover };

// Options Character understands (shared by player and NPC)
export const CHARACTER_KEYS = ['colors', 'speed', 'runSpeed', 'radius', 'water', 'states', 'swimDepth', 'swimSpeed', 'turnSpeed', 'acceleration', 'gravity',
  'jumpSpeed', 'stepHeight', 'airControl', 'coyoteTime', 'canJump', 'maxJumps', 'airJumpSpeed', 'jumpBuffer', 'fall', 'channel', 'model', 'clips', 'animation', 'mover', 'faceMode', 'faceTarget', 'rig', 'id'];
const FACE_MODES = ['move', 'camera', 'target', 'manual'];

export class Character {
  /**
   * @param engine
   * @param o  model: the body, one path for all: a model asset name (a procedural builder from an asset pack, or a GLB name), or what
   *                  engine.assets.model() returned; without model and rig a gray capsule (warned once). rig: a ready body (proceduralRig.js format)
   *           colors: { body, skin, legs, hair } per-character part colors (meshes marked userData.part); the style tints parts by material role
   *           speed walk speed, runSpeed run speed (m/s), radius collision radius
   *           water what water deeper than swimDepth does: 'swim' (default, floats, state 'swim') | 'block' (never enters it) | 'wade' (walks the
   *                 bottom) | (character, { depth, x, z }) => one of those (per spot: a swim skill, a boat, depth); character:water fires on each change.
   *                 swimDepth water depth at which it counts as deep, swimSpeed swim speed multiplier
   *           states (character, facts) => state name | null, run after the mover's own state each step: the game's own states (crouch, climb,
   *                  glide, dash, roll) on top of idle / walk / run / jump / fall / swim; facts { base, speed, grounded, swimming, vy, water }; null keeps
   *                  base. The state picks the clip like any other (clips: { crouch: 'Crouch' }); speed changes stay engine.mod('move.speed')
   *           turnSpeed how fast it turns, acceleration how fast it starts/stops
   *           jump and gravity: gravity (negative), jumpSpeed takeoff speed, stepHeight step height it can climb directly, airControl air steering 0-1,
   *                      coyoteTime how long after leaving a ledge a jump is still allowed, canJump, jumpBuffer how long a jump() pressed early
   *                      waits for the ground (s), maxJumps jumps before landing again (2 = double jump), airJumpSpeed takeoff speed of an air jump
   *                      (default jumpSpeed). These are the base values and belong to the game; modules change them with engine.mod('move.<stat>').
   *           fall: { belowY } a height (or (character) => boolean): below it character:fall fires and, unless a listener calls preventDefault(),
   *                 the character goes back to safeGround. false (default) = off
   *           channel: the time channel its movement and animation follow when the engine drives it (player 'player', others 'world')
   *           model + clips: optional glTF model and action-name map { idle, walk, run, swim, jump, fall, drive } (shorthand for animation)
   *           animation: animation state machine config (see core/Animator.js), state names are character state names;
   *                      without walk/run, move (blend tree, param speed) is used
   *           mover: 'simple' (default) | 'rapier' (Rapier character controller, needs the rigid module) | 'manual' (the game writes the position;
   *                  move() only updates grounded / support / safeGround / fall, movers/manual.js); assign at any time: player.mover = 'manual'
   *           faceMode which way it turns each move: 'move' (default, toward its velocity) | 'camera' (along cameraRig.forward(), over-the-shoulder aiming)
   *                    | 'target' (toward faceTarget: Object3D / Vector3 / { x, z }, lock-on strafing) | 'manual' (only face() turns it);
   *                    both are plain properties, change them at any time
   *           a file model name shows the capsule until it loads, then is swapped in (assetModel.js)
   */
  constructor(engine, { colors = {}, speed = 4.5, runSpeed = 7, radius = engine.movement.radius, water = 'swim', states = null, swimDepth = 1.0, swimSpeed = 0.45,
    turnSpeed = 10, acceleration = 12, gravity = -24, jumpSpeed = 8, stepHeight = engine.movement.stepHeight, airControl = 0.35, coyoteTime = 0.12,
    canJump = true, maxJumps = 1, airJumpSpeed = null, jumpBuffer = 0.12, fall = false, channel = 'world',
    model = null, clips = null, animation = null, mover = 'simple', faceMode = 'move', faceTarget = null, rig = null, id = null } = {}) {
    /** @internal the id option (a character without a world record); the getter id below is the one public form */ this._ownId = id;
    this.engine = engine;
    if (typeof water !== 'function' && !WATER_MODES.includes(water)) throw codedError('character-option', `character option water: 'swim' | 'block' | 'wade' or (character, { depth }) => one of them; got ${JSON.stringify(water)}`, TypeError);
    if (states != null && typeof states !== 'function') throw codedError('character-option', 'character option states: (character, facts) => state name | null', TypeError);
    /** What deep water does ('swim' | 'block' | 'wade' | function); states: the game's state hook. Both plain, change them at any time */
    this.water = water; this.states = states;
    Object.assign(this, { speed, runSpeed, radius, swimDepth, swimSpeedFactor: swimSpeed, turnSpeed, acceleration, gravity, jumpSpeed, stepHeight,
      airControl, coyoteTime, canJump, maxJumps, airJumpSpeed, jumpBuffer, channel });
    if (fall && !(typeof fall.belowY === 'number' || typeof fall.belowY === 'function')) throw codedError('character-option', `character option fall: { belowY: -20 } (a height, or (character) => boolean), or false; got ${JSON.stringify(fall)}`, TypeError);
    this.fall = fall || false;
    /** Last spot it stood still on safe ground (Vector3), where a fall returns it; null until it first stands. Saved with the motion */
    this.safeGround = null;
    moveStacks(engine);
    if (!FACE_MODES.includes(faceMode)) warnMissing('faceMode', faceMode, FACE_MODES);
    this.faceMode = faceMode; this.faceTarget = faceTarget;
    // velocity (x / z, m/s) and vy are plain and writable: a write is an impulse the mover integrates from next step (velocity is then steered back
    // toward the input, vy falls with gravity). Nobody owns them and nothing auto-yields: a knockback that should last is push(), a jump pad is
    // launch(), full control is mover 'manual'.
    this.vy = 0; this.grounded = true; this._push = 0;
    this.onStep = null; this.onLand = null;
    this.root = new THREE.Group();
    this.velocity = new THREE.Vector2();
    this.facing = 0; this.phase = 0; this.moveAmount = 0;
    this.swimming = false;
    /** Action state the animation plays: 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'swim' | 'drive', or what the states option returned. Read it freely;
     *  the engine mover recomputes it every step, so a direct write warns once (states option for own states, character.playAction(name) for one-shot
     *  actions, mover 'manual' to own it). _stateMark: the engine's last write @type {string} */
    this.state = this._stateMark = 'idle';
    /** The vehicle it sits in (null on foot) and its seat there (0 = driver, null on foot) */
    this.vehicle = null; this.seat = null; this.anim = null;
    /** false while a model named by asset loads (placeholder shows); await whenReady */
    this.ready = true;
    /**
     * id of the world record ('player' for the player); once set, position, facing and motion state are written back to it.
     * Do not world.move this record directly; use placeAt
     * @type {string | null}
     */
    this.recordId = null;
    /** @internal each mover built once, kept while switching (rapier keeps its native body) */ this._movers = { simple: simpleMover(this) };
    this.mover = mover;
    this._colors = colors;
    // one path for every body: an object, a procedural builder built now (joints exist at once), or a file asset loaded behind a capsule
    const now = typeof model === 'string' ? buildNow(engine, model) : model;
    if (now) { this._useModel(now, clips, animation); return; }
    if (!rig && !model) warnOnce(NO_CHARACTER);
    useRig(this, rig || capsule(colors.body ?? 0x8a8a8a, engine));
    if (model) this._whenReady = loadAssetModel(this, model, m => this._useModel(m, clips, animation));
  }
  /** A model object with userData.rig is a procedural body (limb swing); anything else animates by its clips */
  _useModel(model, clips, animation) {
    const r = rigFromObject(model);
    if (r) useRig(this, r); else useModel(this, model, clips, animation);
    tintParts(model, this._colors);
  }

  /**
   * Walk to a point along characters.findPath on fixed steps (turn rate, skips passed points, re-plans when stuck). Returns a promise of
   * { status: 'arrived' | 'noPath' | 'stuck' | 'cancelled' } (never rejects) with remove() to cancel; a new walkTo, dispose() or a save load cancels it (not saved). speed m/s, arrive metres, turnRate rad/s
   * @example await guard.walkTo(player.position, { arrive: 1.5 })
   */
  walkTo(target, opts) { return walkTo(this, target, opts); }

  /**
   * The character's id, the one form engine.mod / time.local take for its entries: its world record id ('player' for the player, an NPC's
   * record id), else the id option you gave it (new Character(e, { id: 'knight-1' })), else a fixed generated one.
   * Why one form: the same character had three spellings (player.modId, 'player', the record id) and a typo'd one silently modded nobody.
   * @example engine.mod('move.speed', { owner: 'haste', id: 'player', mul: 1.2, for: 5 })
   * @readonly @type {string}
   */
  get id() { return this.recordId ?? this._ownId ?? (this._modId ??= `character#${++registry(this.engine).n}`); }
  /** @internal the engine's own spelling of id (movers, walkTo, time channels) */
  get modId() { return this.id; }
  /**
   * A movement stat as the mover uses it now: the base field with every engine.mod('move.<name>') entry applied (speed / runSpeed / gravity /
   * jumpSpeed / canJump (1 or 0)). Read-only; the base is the plain field (player.speed = 6), modifiers go through engine.mod.
   * @param {'speed' | 'runSpeed' | 'gravity' | 'jumpSpeed' | 'canJump'} name
   */
  stat(name) { return stat(this, name); }

  /**
   * Request a jump (call when the jump key is pressed). It waits jumpBuffer seconds for the ground, so pressing slightly before landing counts;
   * on the ground or in coyote time it is the ground jump, otherwise an air jump while maxJumps allows. air: false = only a ground jump.
   * @example createPlayer({ ..., maxJumps: 2 });   // double jump: the same jump key twice
   */
  jump({ air = true } = {}) { const j = jumpOf(this); j.buffer = this.jumpBuffer; j.air = air; return this; }
  /** Give back n jumps for this airtime (a pickup, a wall touch) @param {number} [n] */
  addJumps(n = 1) { const j = jumpOf(this); j.used = Math.max(0, j.used - n); return this; }
  /** All jumps back, as if it had landed */
  resetJumps() { jumpOf(this).used = 0; return this; }
  /**
   * Throw it upward at speed m/s (jump pad, spring, geyser): leaves the ground, ends coyote time, counts as having used the ground jump
   * (air jumps stay). Emits character:launch { character, speed, owner }.
   * @example engine.events.on('trigger:enter', ({ id }) => { if (id === 'pad') player.launch(19, { owner: 'pad' }); })
   */
  launch(speed, { owner = 'game' } = {}) {
    const j = jumpOf(this);
    this.vy = speed; this.grounded = false; j.coyote = 0; j.buffer = 0; j.used = Math.max(1, j.used);
    this.engine.events.emit('character:launch', { character: this, speed, owner });
    return this;
  }
  /**
   * Jump state now, read-only: { grounded, coyoteLeft, bufferLeft, jumpsUsed, jumpsLeft, vy }
   * @returns {{ grounded: boolean, coyoteLeft: number, bufferLeft: number, jumpsUsed: number, jumpsLeft: number, vy: number }}
   */
  jumpState() {
    const j = jumpOf(this);
    return { grounded: this.grounded, coyoteLeft: Math.max(0, j.coyote), bufferLeft: Math.max(0, j.buffer), jumpsUsed: j.used,
      jumpsLeft: Math.max(0, this.maxJumps - j.used), vy: this.vy };
  }
  /**
   * What it stands on, read-only (reused object): { kind: 'ground' | 'platform' | 'collider' | 'water' | null, object, id, safe, velocity: { x, y, z } }.
   * platform = a registered support (engine.characters.support), which carries it; velocity is that platform's.
   */
  get support() { return stateOf(this).view; }

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
  placeAt(position) {
    const [x, z] = xzOf(position);
    this.root.position.set(x, placeY(this.engine, 'character.placeAt()', x, z, undefined, this.root.position.y), z);
    detach(this); (this.safeGround ??= new THREE.Vector3()).copy(this.root.position);   // a deliberate placement on the ground is a safe spot
    this._store(); return this;
  }
  /** Write position and motion state back to the world record (only if recordId is set; saveMotion writes into the record without allocating) @internal */
  /** How it walks now: the mover object ({ name, move, controller? }). Assign a name to switch at any time: c.mover = 'manual' ... c.mover = 'simple' */
  get mover() { return this._mover; }
  set mover(name) {
    if (!MOVERS[name]) { warnMissing('mover', name, Object.keys(MOVERS)); name = 'simple'; }
    this._mover = this._movers[name] ??= MOVERS[name](this, this._movers.simple);
  }
  _store() { const id = this.recordId; if (id) { const W = this.engine.world; this.saveMotion(W.get(id)); W.move(id, this.root.position); } }
  /** After moving root yourself (a cutscene path, a scripted pose): write position and motion back to the world record, so a save right after has it */
  syncRecord() { this._store(); return this; }

  /**
   * Move along a direction (call once per fixed step). dirX/dirZ is a world-space direction (length 0-1), run toggles running.
   * How it walks is decided by this.mover ('simple' default / 'rapier'); while driving it follows the seat. dt is used as given (the engine's own
   * drivers pass the character's channel dt); speed comes from the stats (character.stat, engine.mod('move.speed')), the direction's length scales it.
   */
  move(dirX, dirZ, run, dt) {
    if (this.vehicle) {
      const v = this.vehicle;
      this.root.position.copy(v.seatPosition(this.seat));
      // a visible rider turns with the vehicle (a hidden one only needs the position: saves, interactions, trigger zones measure from it)
      if (this.root.visible) { v.object.getWorldQuaternion(this.root.quaternion); this.facing = this.root.rotation.y; }
      this.moveAmount = Math.abs(v.speed); this.state = this._stateMark = 'drive';
    }
    else this.mover.move(dirX, dirZ, run, dt);
    this._store();
  }

  /**
   * Enter a vehicle: rigid.addWheeled's car or any object with the vehicle contract (vehicle.contract.js: seatPosition / exitPosition / speed / drive /
   * driver / object, optional seats / hideDriver), so a game's own boat or mount needs no rigid module. Takes the driver seat when free, else a free
   * passenger seat (vehicle.seats, default 1; this.seat says which, 0 = driver). Stops walking; hidden unless vehicle.hideDriver is false; the camera
   * follows vehicle.object. No-op when every seat is taken
   */
  enter(vehicle) {
    if (this.vehicle) return;
    const e = this.engine, ride = vehicle.passengers ??= [];
    let seat = 0;
    if (vehicle.driver) {
      const taken = new Set(ride.map(c => c.seat));
      for (seat = 1; seat < (vehicle.seats ?? 1) && taken.has(seat); seat++);
      if (seat >= (vehicle.seats ?? 1)) return;
    }
    this.vehicle = vehicle; this.seat = seat;
    if (seat === 0) vehicle.driver = this; else ride.push(this);
    if (e.player === this) this._driveCtx = e.input.push('vehicle', { pass: true });   // driving: brake lives in this context, walking-only keys are shadowed
    if (e.player === this && !e.input.actions.has('brake')) warnOnce("[input-keys] the player drives without a brake key: no module binds one by itself. characters({ ...presets.keys.brake }) (B / gamepad LT) or characters({ brakeKeys: ['KeyX'], brakePad: ['PadLT'] })");
    this.root.visible = vehicle.hideDriver === false; this.velocity.set(0, 0); this.vy = 0; this.swimming = false; this.state = this._stateMark = 'drive'; this._store();
    // only when the game asked the camera to follow the player (createPlayer({ cameraFollow }))
    if (e.player === this && this.cameraFollow) e.cameraRig?.follow(vehicle.object, vehicle.camera);
    e.events.emit('vehicle:enter', { character: this, vehicle });
  }
  /** Exit: step out beside the door, camera returns to the character */
  exit() {
    const v = this.vehicle, e = this.engine;
    if (!v) return;
    const seat = this.seat;
    if (seat === 0) { v.drive(0, 0, 1); v.driver = null; } else v.passengers.splice(v.passengers.indexOf(this), 1);
    this.vehicle = null; this.seat = null;
    this._driveCtx?.remove(); this._driveCtx = null;
    this.root.quaternion.identity(); this.root.rotation.y = this.facing;
    this.placeAt(v.exitPosition(seat)); this.root.visible = true; this.grounded = true; this.state = this._stateMark = 'idle';
    if (e.player === this && this.cameraFollow) e.cameraRig?.follow(this.root);
    e.events.emit('vehicle:exit', { character: this, vehicle: v });
  }
  /** Dispose this character completely: exit the vehicle first, release animation and mover, remove from the scene and dispose geometries and materials */
  dispose() {
    this._disposed = true;   // a model still loading by asset name is dropped on arrival
    this._walk?.remove();    // a walk in progress ends 'cancelled' (walkTo.js)
    this.exit();
    this.anim?.dispose();
    for (const m of Object.values(this._movers)) m.dispose?.();
    this.engine.remove(this.root);
  }
  /**
   * Copy motion state into a plain object (written into out, in place, no allocation): velocity, vertical speed, facing, move amount, grounded, swimming
   * (animation state is stored by the caller).
   * Why: the model is only a presentation of world data, torn down when far and rebuilt on load; keeping these in data lets loadMotion continue after a rebuild,
   * so running continuously and "save -> load -> continue" give the same result (NPCs, future enemies and zombies all use it).
   */
  saveMotion(out = {}) {
    out.vx = this.velocity.x; out.vz = this.velocity.y; out.vy = this.vy; out.facing = this.facing; out.amount = this.moveAmount;
    out.grounded = this.grounded; out.swimming = this.swimming;
    // motion format 2 (world part version 4): jump state nested, safe spot and the support's id; written in place so a per-step store allocates nothing
    const j = jumpOf(this), jo = out.jump ??= {}; jo.coyote = j.coyote; jo.used = j.used;
    const g = this.safeGround; if (g) { const a = out.safe ??= [0, 0, 0]; a[0] = g.x; a[1] = g.y; a[2] = g.z; } else out.safe = null;
    out.support = stateOf(this).on?.id ?? null;
    return out;
  }
  /** Restore motion state from a saveMotion plain object (call after building the model / loading; missing fields keep defaults) */
  loadMotion(m) {
    if (!m) return this;
    this.velocity.set(m.vx ?? 0, m.vz ?? 0); this.vy = m.vy ?? 0; this.facing = m.facing ?? 0; this.root.rotation.y = this.facing;
    this.moveAmount = m.amount ?? 0; this.grounded = m.grounded ?? true; this.swimming = !!m.swimming;
    const j = jumpOf(this); j.coyote = m.jump?.coyote ?? 0; j.used = m.jump?.used ?? 0; j.buffer = 0;
    this.safeGround = m.safe ? new THREE.Vector3(m.safe[0], m.safe[1], m.safe[2]) : this.safeGround;
    // ride the saved support again (found by id) from its current matrix; no support id = rides nothing
    detach(this);
    const en = m.support != null ? registry(this.engine).list.get(m.support) : null;
    if (en) { const s = stateOf(this); s.on = en; en.object.updateWorldMatrix(true, false); s.m.copy(en.object.matrixWorld); registry(this.engine).riders.add(this); }
    return this;
  }
  /** Play a one-shot action (e.g. 'wave', returns to the previous state when done); procedural characters have no actions, warn once and skip */
  playAction(name) {
    if (this.anim) this.anim.action(name);
    else warnOnce(STRINGS.noClip.replace('{name}', name));
  }

  /** Ground type under the feet (terrain groundType or level material name); 'water' while swimming. Footstep sounds map it via audio.footsteps */
  groundType() {
    if (this.swimming) return 'water';
    const p = this.root.position;
    return this.engine.groundType(p.x, p.z);
  }

  /**
   * Turn at once to face a point (Object3D / Vector3 / { x, z }) or an angle in radians (0 = +Z, PI / 2 = +X).
   * With faceMode 'manual' this is the only thing that turns the character
   * @example npc.face(engine.player); player.face(Math.PI)
   */
  face(target) {
    if (typeof target === 'number') this.facing = target;
    else { const [x, z] = xzOf(target); this.facing = Math.atan2(x - this.root.position.x, z - this.root.position.z); }
    this.root.rotation.y = this.facing;
  }

  /**
   * Run fn(character, dt) every frame right after this character's animation pose is applied (model clips or procedural rig), so a game can attach things to bones
   * or adjust bones on top of the pose. Returns a handle; h.remove() stops it. Presentation only: never read it for gameplay timing.
   * @param {(character: Character, dt: number) => void} fn
   * @returns {{ remove(): void }}
   * @example const h = player.onPose(() => sword.position.copy(player.object.getObjectByName('Hand_R').getWorldPosition(v)));
   */
  onPose(fn) { (this._poseFns ??= new Set()).add(fn); return { remove: () => this._poseFns.delete(fn) }; }
  /** @internal */
  _firePose(dt) { if (this._poseFns?.size) for (const f of [...this._poseFns]) { try { f(this, dt); } catch (err) { reportError(this.engine, err, 'character.onPose callback'); } } }
  /** @internal Call every frame: play animation, at the speed of the character's time channel (bullet time on 'enemies' slows their walk cycle too) */
  animate(dt) {
    if (this.engine.time) dt *= this.engine.time.scale(this.channel, this.modId);
    this._animate(dt); if (!this.anim) this._firePose(dt);
  }
  /** @internal */
  _animate(dt) {
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
    animateRig(this, sp, t, st);
  }
}

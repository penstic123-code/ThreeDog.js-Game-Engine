// Shared by all movers: horizontal velocity smoothing, swim check, jumps (buffer, coyote time, air jumps), landing, facing and action state.
// Used by simple.js (built-in) and rapier.js (Rapier character controller), so feel parameters (acceleration, air control, jump) match.
// Movement stats go through the one entry for shared quantities, engine.mod (core/stacks.js), never by writing the character's fields from a module:
//   engine.mod('move.speed', { owner: 'haste', id: 'player', mul: 1.2, for: 5 });   // haste on the player; without id: every character (mud, wind)
// The character's own field is the base and belongs to the game (player.speed = 6 is always fine); stacks hold only the modifiers, so stamina's
// "run speed = walk speed", haste x1.2 and mud x0.6 combine and end in any order (stacks.js rules).
import { xzOf } from '../../../core/math.js';
import { groundAt, stateOf } from './support.js';
import { warnOnce } from '../../../core/validate.js';

const STATE_WRITTEN = "character.state was written directly, but the engine mover recomputes it every step (idle / walk / run / jump / fall / swim), " +
  "so your value was replaced at once. Own states on top (crouch, climb, glide): the states option, (character, facts) => name | null. " +
  "One-shot animation: character.playAction(name). To set state yourself: character.mover = 'manual' (the game drives it)";

/** The movement stats engine.mod can change, as stacks 'move.<name>' (per character id, or without id for every character) */
const MOVE_STATS = ['speed', 'runSpeed', 'gravity', 'jumpSpeed', 'canJump'];
/** 'speed' -> 'move.speed', built once: stat runs several times per character per step, so no string is joined there */
const STACK_OF = Object.fromEntries(MOVE_STATS.map(k => [k, 'move.' + k]));

/** @internal define the move.* stacks once per engine: the characters module install does it (so engine.mod works in setup); the Character constructor calls it too for a character made without the module */
export function moveStacks(e) {
  if (!e.stacks || e.stacks.has('move.speed')) return;
  for (const k of MOVE_STATS) e.stacks.define(STACK_OF[k], { per: 'optional', ...(k === 'gravity' ? {} : { min: 0 }) });
}

/**
 * The value a mover uses now: the character's own field (the base) with every engine.mod entry on 'move.<name>' applied. canJump reads 1 / 0.
 * @param {any} c @param {string} name @param {number} [base] a different base on the same stack (airJumpSpeed rides on move.jumpSpeed)
 */
export function stat(c, name, base) {
  const b = base ?? (name === 'canJump' ? (c.canJump ? 1 : 0) : c[name]);
  const s = c.engine.stacks, key = STACK_OF[name] ?? 'move.' + name;
  if (!s?.has(key)) return b;
  return s.get(key).value(c.modId, b);
}

/** Smooth horizontal velocity toward the target velocity (c.velocity x/y map to world x/z). The direction's length (0-1) scales the speed */
export function steer(c, dirX, dirZ, run, dt) {
  // push() overrides the requested direction for its duration (knockback, dodge displacement)
  if (c._push > 0) { c._push -= dt; c.velocity.set(c._pushX, c._pushZ); return; }
  const len = Math.hypot(dirX, dirZ);
  let speed = stat(c, run ? 'runSpeed' : 'speed');
  if (c.swimming) speed *= c.swimSpeedFactor;
  const tvx = len > 0.01 ? dirX * speed : 0, tvz = len > 0.01 ? dirZ * speed : 0;
  const k = 1 - Math.exp(-dt * c.acceleration * (c.grounded || c.swimming ? 1 : c.airControl));
  c.velocity.x += (tvx - c.velocity.x) * k; c.velocity.y += (tvz - c.velocity.y) * k;
}

export const WATER_MODES = ['swim', 'block', 'wade'];
const WATER_KEY = new WeakMap();   // the water mode the character is in now (null on dry land), so character:water fires on changes only

/**
 * Water: what deep water (deeper than swimDepth) does to the character by its water option: 'swim' floats it (sets c.swimming), 'block' puts it back at
 * (ox, oz), 'wade' lets it walk the bottom; a function (character, { depth, x, z }) => one of those decides per spot (a skill, a boat, depth).
 * Returns { ground: ground height under the feet (registered supports count), swimY: body height when swimming, hit: the support under the feet or null }
 */
export function water(c, ox, oz) {
  const e = c.engine, p = c.root.position;
  let ground = groundAt(c, p.x, p.z, p.y);   // pass the current height: walk the ground under a bridge, the deck on top
  const surface = e.waterAt(p.x, p.z), swimY = surface - c.swimDepth;
  const mode = ground < swimY ? waterMode(c, surface - ground, p) : null;
  if (mode === 'block') { p.x = ox; p.z = oz; c.velocity.set(0, 0); ground = groundAt(c, ox, oz, p.y); }
  c.swimming = mode === 'swim' && p.y <= swimY + 0.3;
  const was = WATER_KEY.get(c) ?? null;
  if (mode !== was) {
    WATER_KEY.set(c, mode);
    e.events.emit('character:water', { character: c, in: mode != null, mode: mode ?? was, depth: Math.max(0, surface - ground) });
  }
  return { ground, swimY, hit: stateOf(c).hit };
}
function waterMode(c, depth, p) {
  const w = c.water, m = typeof w === 'function' ? w(c, { depth, x: p.x, z: p.z }) : w;
  if (WATER_MODES.includes(m)) return m;
  warnOnce(`character water: ${JSON.stringify(m)} is not a water mode; use 'swim' | 'block' | 'wade' (or a function returning one). Swimming instead`);
  return 'swim';
}

/** Float on the water surface when swimming (gentle bob) */
export function float(c, swimY) { c.vy = 0; c.grounded = false; c.root.position.y = swimY + Math.sin(c.engine.time.now('real') * 2) * 0.05; }

// Jump state lives here, out of reach (a WeakMap, not fields on the character): games read character.jumpState() and change it through
// jump() / addJumps() / resetJumps() / launch(), so no game depends on how the buffer or coyote time is kept (the old _coyote / _jumpBuffer).
const JUMP = new WeakMap();
/** @internal { buffer, coyote, used, air } of a character */
export function jumpOf(c) { let j = JUMP.get(c); if (!j) JUMP.set(c, j = { buffer: 0, coyote: 0, used: 0, air: true }); return j; }

/** Count the buffer and coyote time down. Once coyote time runs out in the air the ground jump is spent (only air jumps are left) */
export function tickJump(c, dt) {
  const j = jumpOf(c);
  j.buffer -= dt;
  if (j.coyote > 0 && (j.coyote -= dt) <= 0 && !c.grounded && j.used === 0) j.used = 1;
}

/** Walked off an edge: coyote time starts */
export function leaveGround(c) { c.grounded = false; jumpOf(c).coyote = c.coyoteTime; }

/** A buffered jump: on the ground or in coyote time the ground jump, else an air jump while jumps are left (and the request allowed air) */
export function tryJump(c) {
  const j = jumpOf(c);
  if (j.buffer <= 0 || !(stat(c, 'canJump') > 0)) return;
  let air;
  if (c.grounded || j.coyote > 0) { air = false; c.vy = stat(c, 'jumpSpeed'); j.used = 1; }
  else if (j.air && j.used < c.maxJumps) { air = true; c.vy = stat(c, 'jumpSpeed', c.airJumpSpeed ?? c.jumpSpeed); j.used = Math.max(1, j.used) + 1; }
  else return;
  c.grounded = false; j.buffer = 0; j.coyote = 0;
  c.engine.events.emit('character:jump', { character: c, air, index: j.used });
}

/** Landing: impact is the landing speed; jumps refill */
export function land(c, impact) {
  c.vy = 0; c.grounded = true; jumpOf(c).used = 0;
  c.onLand?.(impact); c.engine.events.emit('character:land', { character: c, impact });
}

/** Extra horizontal speed carried from a platform the character left, as a Vector2 (x, z), until it lands */
export function inherited(c) { return stateOf(c).inherit; }

/** Angle the character wants to face by its faceMode; null = keep the current facing. While pushed it never turns (a knockback must not spin it round) */
function faceAngle(c, sp) {
  if (c._push > 0 || c.faceMode === 'manual') return null;
  if (c.faceMode === 'camera') { const f = c.engine.cameraRig?.forward(); if (f) return Math.atan2(f.x, f.z); }
  else if (c.faceMode === 'target' && c.faceTarget) { const [x, z] = xzOf(c.faceTarget), p = c.root.position; return Math.atan2(x - p.x, z - p.z); }
  return sp > 0.3 ? Math.atan2(c.velocity.x, c.velocity.y) : null;
}

/** Turn by faceMode (default: toward the move direction), update moveAmount and action state */
export function finish(c, dt) {
  const sp = c.velocity.length(), want = faceAngle(c, sp);
  if (want != null) {
    let d = want - c.facing; d = Math.atan2(Math.sin(d), Math.cos(d));
    c.facing += d * Math.min(1, dt * c.turnSpeed);
    c.root.rotation.y = c.facing;
  }
  c.moveAmount = sp;
  // a game write since the last step would vanish here without a word (no-conflict rule): say so once, with the calls that do work
  if (c.state !== c._stateMark) warnOnce(STATE_WRITTEN);
  const base = c.swimming ? 'swim' : !c.grounded ? (c.vy > 0 ? 'jump' : 'fall') : sp > stat(c, 'speed') * 1.3 ? 'run' : sp > 0.4 ? 'walk' : 'idle';
  // the game's states hook adds its own (crouch, climb, glide, dash...) on top of the built-in ones without taking the mover over; null keeps base
  ownState(c, base, sp);
}

/** @internal the state after a mover's step: the game's states hook, or base when it returns null */
export function ownState(c, base, speed) {
  c.state = c._stateMark = (c.states && c.states(c, { base, speed, grounded: c.grounded, swimming: c.swimming, vy: c.vy, water: WATER_KEY.get(c) ?? null })) || base;
}

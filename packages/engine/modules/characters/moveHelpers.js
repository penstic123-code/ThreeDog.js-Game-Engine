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
 * never turns back. Never skips the last point (arriving is the caller's) or a link's start (a link is crossed, not cut past). One rule for walkTo and NPCs; their stuck tests stay apart (walkTo's window has a public
 * option, an NPC's would have to go in its save)
 */
export function nextPoint(path, i, x, z, reach) {
  const dist = p => Math.hypot(p.x - x, p.z - z);
  while (i < path.length - 1 && !path[i].link && (dist(path[i]) < reach || dist(path[i + 1]) < dist(path[i]))) i++;
  return i;
}

// Crossing a link (nav({ links })), one rule for NPCs and walkTo. The walker leaves its mover for the crossing: no gravity, no ground, its place comes from the
// crossing alone, so the plain data { link, from, to, seconds, time } is the whole state and a save taken halfway goes on from the same spot.
// The look is the game's: link:enter is the moment to play a clip and set crossing.seconds, characters.linkPose bends the line. A game doing neither gets a straight
// line at walking speed.

/** How near a link's start a walker must come before it crosses (m): a crossing runs from where the walker stands, so a far one starts a climb off the ladder's foot */
export const LINK_REACH = 0.3;
/** Begin crossing a path point's link from where the character stands; returns the crossing for the caller to keep */
export function startLink(ch, { id, to }) {
  ch.placeAt(ch.root.position);   // off any platform: nothing may carry it during the crossing
  const p = ch.root.position, crossing = { link: id, from: { x: p.x, y: p.y, z: p.z }, to, seconds: Math.hypot(to.x - p.x, to.y - p.y, to.z - p.z) / ch.stat('speed'), time: 0 };
  ch.face(to); ch.velocity.set(0, 0); ch.vy = 0; ch.grounded = false;
  ch.engine.events.emit('link:enter', { id: ch.id, character: ch, crossing });
  if (!(crossing.seconds > 0 && crossing.seconds < Infinity)) crossing.seconds = 0;   // speed 0 (a move.speed mod that roots it) or a game's bad value: a crossing always ends, and Infinity would not survive a save
  return crossing;
}
/** One step of a crossing: true once it has landed */
export function stepLink(ch, c, dt) {
  c.time += dt;
  const t = c.seconds > 0 ? c.time / c.seconds : 1, p = ch.root.position, { from: a, to: b } = c;
  if (t >= 1) return landLink(ch, c);
  p.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  ch.engine.characters.linkPose?.(t, p, c, ch);
  ch.syncRecord();
  return false;
}
/**
 * Put the character at the far end now: the crossing ran out, its walk was cancelled, or a control holder above took the body. A holder pauses what is below it, but a
 * crossing cannot wait paused: the body would hang over the gap, and picking the crossing up later would snap it back to the line. Returns true, as stepLink does on landing
 */
export function landLink(ch, c) { ch.placeAt(c.to); ch.grounded = true; leaveLink(ch.engine, ch.id, ch, c); return true; }
/** Whether a link is still to cross on the path from point i on. Arriving is judged in x, z, which says nothing about a ladder's height: the walker is not there yet */
export const linkAhead = (path, i = 0) => !!path?.some((p, k) => k >= i && p.link);
/** A crossing is over, landed or cut short. character: null for an NPC that finished it without a model */
export function leaveLink(e, id, character, crossing) { e.events.emit('link:exit', { id, character, crossing }); }

/** The 'camera' player control as a value (characters.moveInput); returns the reused REQ */
export function moveInput(e) {
  const inp = e.input, a = inp.autopilot || inp.axis;   // autopilot (stress tests, recordings): input.autopilot = { x, y, speed? } (speed: the player hook mods move.speed)
  const f = e.cameraRig ? e.cameraRig.forward() : { x: 0, z: -1 }, rt = e.cameraRig ? e.cameraRig.right() : { x: 1, z: 0 };
  // run is the game's key, not a core default
  REQ.x = f.x * a.y + rt.x * a.x; REQ.z = f.z * a.y + rt.z * a.x; REQ.run = inp.actions.has('run') && inp.down('run');
  return REQ;
}

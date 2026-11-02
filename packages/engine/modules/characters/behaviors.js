// Built-in NPC behaviors: schedule (go to each stop by schedule), wander (roam near home).
// Behavior = { near(rec, dt, npc), far(rec, dt) }, registered by engine.npcs.behavior(name, …) and selected by behavior in NPC data (see NPC.js).
// Like npcSim.js it keeps no state of its own: wander target and pause live in rec.mind (plain values), so it continues after model teardown or loading.
import { warnOnce } from '../../core/validate.js';
import { advance, nearStep, goTo, settle } from './npcSim.js';
import { codedError } from '../../core/errorHints.js';

const NO = 'no NPC behavior named "{name}". Registered: {known}. Register a custom behavior first: engine.npcs.behavior("{name}", { near(rec, dt, npc) { … }, far(rec, dt) { … } })';
const noBehavior = (name, map) => NO.replace(/\{name\}/g, name).replace('{known}', [...map.keys()].join(', '));

/** Behavior registry: name -> { near, far } (code, not saved; data only stores the name) */
export class Behaviors extends Map {
  /** Throw if the name is not registered, listing the registered ones */
  check(name) { if (!this.has(name)) throw codedError('npc-behavior', noBehavior(name, this)); }
  /** The behavior this record uses now; if the name is not registered (game has not registered it after loading), warn once and skip */
  of(rec) { const b = this.get(rec.behavior); if (!b) warnOnce(noBehavior(rec.behavior, this)); return b; }
  addBuiltin(e, W) { for (const [n, b] of Object.entries(builtinBehaviors(e, W))) this.set(n, b); }
}

/** Built-in behaviors (e = engine, W = engine.world): { schedule, wander }, registered in npcs.setup */
function builtinBehaviors(e, W) {
  // schedule: near walks to the current stop by pathfinding, far walks in a straight line (details in npcSim.js)
  const scheduleFar = (rec, dt) => advance(e, W, rec, dt);
  const schedule = {
    near: (rec, dt, npc) => { const ch = npc.character; if (ch) nearStep(e, W, rec, ch, dt); else scheduleFar(rec, dt); },
    far: scheduleFar,
  };
  // Wander params (all in rec.mind, can be passed in add / setBehavior): radius max distance from home in meters, pause how long to wait after arriving ([min, max] seconds), home { x, z } (omitted = where it stood when wandering started)
  const radiusOf = m => m.radius ?? 8;
  const pauseOf = (e, m) => { const [a, b] = m.pause ?? [2, 6]; return e.random.range(a, b); };
  const pick = (e, m) => {   // pick a point uniformly in the circle around home (sqrt keeps points from clustering at the center)
    const r = radiusOf(m) * Math.sqrt(e.random.next()), a = e.random.next() * Math.PI * 2;
    return { x: m.home.x + Math.cos(a) * r, z: m.home.z + Math.sin(a) * r };
  };
  const homeOf = (rec, m) => { m.home ??= { x: rec.position.x, z: rec.position.z }; };


  // wander: pick a random point near home, walk there, pause, pick the next. Randomness uses engine.random (same seed, same result, saved)
  const wanderFar = (rec, dt) => {
    const m = rec.mind;
    if (!(dt > 0)) return;
    homeOf(rec, m);
    let x = rec.position.x, z = rec.position.z, left = dt, moving = false, guard = 0;
    for (; left > 1e-9 && guard < 16; guard++) {
      if (m.wait > 0) { const w = Math.min(m.wait, left); m.wait -= w; left -= w; moving = false; continue; }
      if (!m.target) m.target = pick(e, m);
      const dx = m.target.x - x, dz = m.target.z - z, d = Math.hypot(dx, dz), t = d / rec.speed;
      if (t <= left) { x = m.target.x; z = m.target.z; left -= t; m.target = null; m.wait = pauseOf(e, m); moving = false; }
      else { x += dx / d * rec.speed * left; z += dz / d * rec.speed * left; left = 0; moving = true; }
    }
    if (left > 1e-9) { const p = pick(e, m); x = p.x; z = p.z; m.target = null; m.wait = 0; moving = false; }   // owed time too long (many round trips): land directly at some point in the circle
    settle(e, W, rec, x, z, moving);
  };
  const wander = {
    near: (rec, dt, npc) => {
      const ch = npc.character, m = rec.mind;
      if (!ch) return wanderFar(rec, dt);   // model not built yet: walk by data first
      homeOf(rec, m);
      let goal = null;
      if (!rec.busy) {
        if (m.wait > 0) m.wait -= dt;
        else {
          if (!m.target) m.target = pick(e, m);
          if (Math.hypot(m.target.x - ch.root.position.x, m.target.z - ch.root.position.z) < rec.arriveDistance) { m.target = null; m.wait = pauseOf(e, m); }
          else goal = m.target;
        }
      }
      goTo(e, W, rec, ch, goal, dt);
    },
    far: wanderFar,
  };
  return { schedule, wander };
}

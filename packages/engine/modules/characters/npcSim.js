// NPC simulation (gameplay logic, runs in world.simulate('npc')): pick a stop from the schedule; with a model, pathfind + move the model via the mover; without
// a model, walk in a straight line.
// Reads/writes only world data (plain objects) and the passed-in character (presentation), keeps no state of its own, because models are torn down when far and
// load replaces all data:
// state kept elsewhere (path, current stop, velocity) would go out of sync. It all lives in data (rec.nav, rec.motion), so after load the NPC continues exactly
// as if it had kept running.
// See the top of NPC.js for record fields.

/** Fixed steps an NPC waits for a findPathAsync answer before asking again (answers normally land 4 steps later; a long queue adds perStep batches) */
const PATH_WAIT = 300;

/**
 * Which stop to go to now (index): the latest stop at or before time t (0-1); before the first stop counts as the previous day's last stop; null if no schedule
 */
export function stopIndex(schedule, t) {
  if (!schedule.length) return null;
  let cur = schedule.length - 1;
  for (let i = 0; i < schedule.length; i++) if (schedule[i].at <= t) cur = i;
  return cur;
}
/** time of day: always 0 without sky (only the first stop is used) */
export const timeOfDay = e => e.sky ? e.sky.timeOfDay : 0;

/**
 * Walk without a model (far, or near but model not built yet): head in a straight line to the current scheduled stop; stop at the stop if reached, otherwise at
 * the interpolated point on the line.
 * seconds seconds is the world simulation dt (accumulated fixed-step seconds, same scale as the near mover, may be large): distance = speed * seconds;
 * when several stop-change times are crossed, walk in segments, each toward that segment's stop (day progress = seconds * clock.timeScale / dayLength, same as
 * the sky clock).
 */
export function advance(e, W, rec, seconds) {
  const s = rec.schedule;
  if (!s.length || !(seconds > 0)) return;
  const p = rec.position;
  let x = p.x, z = p.z;
  const walk = (i, sec) => {
    const g = s[i], dx = g.x - x, dz = g.z - z, d = Math.hypot(dx, dz), go = Math.min(d, rec.speed * sec);
    if (d > 1e-9) { x += dx / d * go; z += dz / d * go; }
  };
  if (!e.sky) walk(stopIndex(s, 0), seconds);
  else {
    const perDay = e.sky.dayLength / e.clock.timeScale, now = e.sky.timeOfDay;   // seconds for a full day (infinite when time is stopped: far NPCs do not walk)
    let left = Math.min(1, seconds / perDay);   // more than one day counts as one day: every stop is visited once, more would only repeat
    let t = ((now - left) % 1 + 1) % 1;
    for (let guard = 0; left > 1e-9 && guard <= s.length + 1; guard++) {
      let next = Infinity;   // next stop-change time after t (tomorrow's first stop if none left today)
      for (const st of s) { const a = st.at > t ? st.at : st.at + 1; if (a < next) next = a; }
      const seg = Math.min(left, next - t);
      walk(stopIndex(s, t), seg * perDay);
      // when landing exactly on a change time take that value, so float error does not leave it on the previous stop
      left -= seg; t = seg === next - t ? next % 1 : t + seg;
    }
  }
  const idx = stopIndex(s, timeOfDay(e)), g = s[idx];
  rec.nav.stop = idx;
  settle(e, W, rec, x, z, Math.hypot(g.x - x, g.z - z) > rec.arriveDistance);
}

/** Set rec.state; with events.traceSize > 0 a change is noted as an `npc:state` trace entry (from, to), so "why did it stop" has a cause chain */
function noteState(e, rec, next) {
  if (rec.state !== next && e.events.traceSize > 0) e.events.note('npc:state', { obj: rec.id, data: { from: rec.state ?? null, to: next } });
  rec.state = next;
}

/**
 * Settle without a model: write the computed x, z back to data (position, facing, animation state); shared by every behaviour's far. The path is for the model,
 * so it is re-found at the new position after the model is built
 */
export function settle(e, W, rec, x, z, moving) {
  const p = rec.position, nav = rec.nav; nav.path = null; nav.repath = 0;
  const m = rec.motion ??= {};
  const facing = x !== p.x || z !== p.z ? Math.atan2(x - p.x, z - p.z) : m.facing ?? 0;
  Object.assign(m, { vx: 0, vz: 0, vy: 0, amount: 0, facing, grounded: true, swimming: false, coyote: 0 });
  noteState(e, rec, moving ? 'walk' : 'idle');
  // NPC of another level: this level's ground height is meaningless for it, keep its y
  const here = rec.zone == null || W.zone == null || rec.zone === W.zone;
  W.move(rec.id, { x, y: here ? e.surface(x, z) : p.y, z });
}

/**
 * Near step of a schedule behaviour (every fixed step): pick the stop, goTo it, then copy position and motion state back to data.
 */
export function nearStep(e, W, rec, ch, dt) {
  const nav = rec.nav;
  const idx = rec.busy ? nav.stop : stopIndex(rec.schedule, timeOfDay(e));
  if (idx !== nav.stop) { nav.stop = idx; nav.path = null; nav.repath = 0; }
  goTo(e, W, rec, ch, idx == null ? null : rec.schedule[idx], dt);
}

/**
 * With a model, take one step toward goal ({ x, z }, null = stand): pathfind, move the model via the character's mover, then copy position and motion state
 * back to data; shared by every behaviour's near.
 * Standing when in conversation (rec.busy), arrived (distance < arriveDistance) or no goal.
 * Pathfinding goes through the single entry engine.characters.findPath; a goal too far (>120 m) first walks straight 100 m, then pathfinds exactly, to avoid
 * one huge search.
 */
export function goTo(e, W, rec, ch, goal, dt) {
  const nav = rec.nav, p = ch.root.position;
  const dGoal = goal ? Math.hypot(goal.x - p.x, goal.z - p.z) : 0;
  if (rec.busy || !goal || dGoal < rec.arriveDistance) ch.move(0, 0, false, dt);
  else if (e.nav?.crowd) crowdMove(e, ch, goal, dt);
  else {
    nav.repath -= dt;
    // goal changed while waiting, or the answer never came (engine.commits.invalidate dropped it: a partial saves.apply, a level change): ask again
    if (ch._pathReq && (ch._pathReq.goal !== goal || e.tick - ch._pathReq.at > PATH_WAIT)) { ch._pathReq.remove(); ch._pathReq = null; }
    if (!nav.path && nav.repath <= 0 && !ch._pathReq) {
      const far = dGoal > 120, tx = far ? p.x + (goal.x - p.x) / dGoal * 100 : goal.x, tz = far ? p.z + (goal.z - p.z) / dGoal * 100 : goal.z;
      // async: many NPCs repathing in one step cost the main thread almost nothing; the answer lands a few steps later (the NPC waits in place)
      const req = ch._pathReq = e.characters.findPathAsync(p, { x: tx, z: tz }, path => {
        if (ch._pathReq !== req) return;
        ch._pathReq = null; nav.path = path || [{ x: tx, z: tz }];
      }, { step: rec.pathStep });
      req.goal = goal; req.at = e.tick;
      nav.repath = rec.repath;
    }
    if (nav.path?.length) {
      const wp = nav.path[0], dx = wp.x - p.x, dz = wp.z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.8) { nav.path.shift(); if (!nav.path.length) nav.path = null; }
      else {
        const ox = p.x, oz = p.z;
        ch.move(dx / d, dz / d, false, dt);
        if (Math.hypot(p.x - ox, p.z - oz) < 0.002 && ch.moveAmount < 0.2) nav.path = null;   // stuck: re-pathfind
      }
    }
  }
  if (!e.nav?.crowd) e.npcs.avoid.push(rec, ch, dt);   // keep clear of other NPCs and the player (with crowd, the agents handle it)
  // position belongs to the mover: copy the model position back to data here (world also copies at the end of each fixed step; copying now means later
  // simulation and saves this step see the latest)
  rec.motion = ch.saveMotion(rec.motion ?? {});
  noteState(e, rec, ch.state);
  W.move(rec.id, p);
}

// Crowd avoidance (nav({ crowd: true })): Recast agents steer around other NPCs (smarter than the simple push in npcAvoid.js); the NPC reads the agent velocity
// and walks itself.
// The agent belongs to the model (stored on the character) and is deleted with it (dispose in NPC.js); the agent itself does not guarantee identical results
// after load.
function crowdMove(e, ch, goal, dt) {
  const nav = e.nav, crowd = nav.crowd, p = ch.root.position;
  // nav mesh was rebuilt: the old agent was destroyed with the old crowd
  if (ch._agent && ch._navVersion !== nav.version) { ch._agent = null; ch._agentGoal = null; }
  ch._navVersion = nav.version;
  if (!ch._agent) ch._agent = crowd.addAgent({ x: p.x, y: p.y, z: p.z }, { radius: ch.radius, height: e.movement.height, maxSpeed: ch.speed, maxAcceleration: ch.acceleration * ch.speed });
  const a = ch._agent;
  if (ch._agentGoal !== goal) { a.requestMoveTarget({ x: goal.x, y: e.surface(goal.x, goal.z), z: goal.z }); ch._agentGoal = goal; }
  const ap = a.position();
  if (Math.hypot(ap.x - p.x, ap.z - p.z) > 1.5) a.teleport({ x: p.x, y: p.y, z: p.z });   // blocked and drifted too far: pull the agent back
  const v = a.velocity(), sp = Math.hypot(v.x, v.z);
  ch.move(sp > 0.05 ? v.x / ch.speed : 0, sp > 0.05 ? v.z / ch.speed : 0, false, dt);
}

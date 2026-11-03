// character.walkTo(target, opts): follow characters.findPath on fixed steps. Exists so a hand-written guard / pet / follower does not re-implement
// path following (turn rate, skipping passed points, stuck detection) every time. Steering only: the mover still owns position (see Character.js).
// Transient on purpose (like a noSkip timer): a walk is not saved and engine.skip does not fast-forward it. So it never outlives what it steers:
// one walk per character (a new walkTo cancels the old, else two hooks would fight over move()), and character.dispose() or a save load
// ends it with 'cancelled' (the loaded state has its own positions; the old path no longer applies). A game that must resume a walk saves the target.
// Control: a walk holds the character on layer 'script' (core/control.js). So the player's keys pause while it walks and come back when it ends; a
// cutscene above pauses the walk (no progress, no stuck clock) and the walk carries on after; another script owner on the same character is a
// control-conflict error instead of two hooks pushing one body.
import { xzOf } from '../../core/math.js';

const STUCK_PROGRESS = 0.15;   // metres the character must gain on the next point within the stuck window, else it counts as stuck

/**
 * @param {any} ch Character
 * @returns {Promise<{ status: 'arrived' | 'noPath' | 'stuck' | 'cancelled' }> & { remove(): void }}
 */
export function walkTo(ch, target, { speed, arrive = 0.5, turnRate = 8, stuckSeconds = 1.5, maxRepaths = 3, run = false } = {}) {
  const e = ch.engine;
  let done, hook, path = null, i = 0, heading = null, repaths = 0, bestD = Infinity, stuckT = 0;
  const promise = new Promise(res => { done = res; });
  ch._walk?.remove();   // one walk per character: the newer order wins
  let onLoad = null, handle = null, ctl = null;
  // speed is a move.speed entry for the walk (not a speed argument to move): haste / mud modifiers still apply on top, and it ends with the walk
  const sped = speed != null ? e.mod('move.speed', { owner: 'walkTo', id: ch.modId, set: speed }) : null;
  const runMod = sped && run ? e.mod('move.runSpeed', { owner: 'walkTo', id: ch.modId, set: speed }) : null;
  const finish = status => {
    if (!hook) return; hook.remove(); hook = null; onLoad?.remove(); ctl.remove(); if (ch._walk === handle) ch._walk = null;
    finishMods();
    done({ status });
  };
  function finishMods() { sped?.remove(); runMod?.remove(); }
  const dist = (p, x, z) => Math.hypot(p.x - x, p.z - z);
  // points the character is already at or past (a later point is closer) would make it turn back, so drop them
  const skipPassed = (x, z) => {
    while (i < path.length - 1 && (dist(path[i], x, z) < arrive * 0.6 || dist(path[i + 1], x, z) < dist(path[i], x, z))) i++;
  };
  const solve = () => {
    path = e.characters.findPath(ch.root.position, target, { radius: ch.radius });
    i = 0; bestD = Infinity; stuckT = 0;
    if (!path || !path.length) return false;
    const [x, z] = xzOf(ch.root.position);
    skipPassed(x, z);
    return true;
  };
  if (!solve()) { finishMods(); queueMicrotask(() => done({ status: 'noPath' })); return Object.assign(promise, { remove() {} }); }
  try { ctl = e.control.take(ch, { owner: 'walkTo', layer: 'script' }); } catch (err) { finishMods(); throw err; }
  onLoad = e.events.on('save:loaded', () => finish('cancelled'));
  hook = e.onFixed(() => {
    if (!ctl.active) return;   // paused under a cutscene (or another higher holder): keep the path and the stuck clock as they are
    const dt = e.time.dt(ch.channel, ch.modId);   // the character's time channel: bullet time slows a walk too
    const [gx, gz] = xzOf(target), [x, z] = xzOf(ch.root.position);
    if (Math.hypot(gx - x, gz - z) <= arrive) { ctl.move(0, 0, false, dt); return finish('arrived'); }
    skipPassed(x, z);
    const p = path[i], d = dist(p, x, z);
    // stuck: no gain on the next point for stuckSeconds, so replan; give up after maxRepaths
    if (d < bestD - STUCK_PROGRESS) { bestD = d; stuckT = 0; }
    else if ((stuckT += dt) > stuckSeconds) {
      if (++repaths > maxRepaths || !solve()) { ctl.move(0, 0, false, dt); return finish(repaths > maxRepaths ? 'stuck' : 'noPath'); }
      return;
    }
    const want = Math.atan2(p.x - x, p.z - z);
    heading ??= ch.facing;
    let diff = want - heading; diff -= Math.PI * 2 * Math.round(diff / (Math.PI * 2));
    const step = turnRate * dt;
    heading += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    // slow down while the body is still turning toward the point, so it does not overshoot sideways
    const align = Math.max(0.2, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
    ctl.move(Math.sin(heading) * align, Math.cos(heading) * align, run, dt);   // the direction's length scales the speed
  });
  handle = Object.assign(promise, { remove() { finish('cancelled'); } });
  return ch._walk = handle;
}

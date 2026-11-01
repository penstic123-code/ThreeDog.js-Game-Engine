// Tween: smoothly change a value from its current value to a target over time.
// Targets use a dot path: 'position.x', 'material.opacity', 'scale' (whole vector), 'material.color' (color).
//   Supported values: numbers; THREE.Vector2/3/4, Euler (give an array [x,y,z], {x,y,z} or Vector3); THREE.Color (give 0xff8800, '#f80' or Color); Quaternion (slerp)
//   Note: material.opacity only shows when the material has transparent: true
//
//   const tw = new Tweener();  call tw.update(dt) every frame
//   await tw.tween(mesh, { 'position.y': 3, 'material.color': 0xffffff }, 1.5, 'outBack');
//   const p = tw.tween(...); p.finish() jumps to the end; p.cancel() stops where it is
import * as THREE from 'three';
import { ease as easing } from '../../core/easing.js';
import { allowOwned } from '../../core/validate.js';
import { getPath } from '../../core/util.js';

const COMPS = ['x', 'y', 'z', 'w'];

/** 'material.color' → { obj: target.material, key: 'color' } */
function resolve(target, path) {
  const i = path.lastIndexOf('.'), obj = i < 0 ? target : getPath(target, path.slice(0, i));
  return obj == null ? null : { obj, key: path.slice(i + 1) };
}

/** Build an interpolator for a property: returns k => apply progress k (0..1) */
function makeProp(target, path, toValue) {
  const r = resolve(target, path);
  if (!r) { console.warn(`[tween] property not found: ${path}`); return null; }
  const { obj, key } = r, cur = obj[key];
  if (typeof cur === 'number') {
    const from = cur, to = +toValue;
    return k => { obj[key] = from + (to - from) * k; };
  }
  if (cur?.isColor) {
    const from = cur.clone(), to = toValue?.isColor ? toValue.clone() : new THREE.Color(toValue);
    return k => { cur.copy(from).lerp(to, k); };
  }
  if (cur?.isQuaternion) {
    const from = cur.clone(), to = toValue?.isQuaternion ? toValue.clone()
      : toValue?.isEuler ? new THREE.Quaternion().setFromEuler(toValue) : new THREE.Quaternion(...(Array.isArray(toValue) ? toValue : [toValue.x, toValue.y, toValue.z, toValue.w ?? 1]));
    return k => { cur.slerpQuaternions(from, to, k); };
  }
  if (cur && typeof cur === 'object') {
    // vector / Euler: interpolate per component
    const comps = COMPS.filter(c => typeof cur[c] === 'number');
    if (!comps.length) { console.warn(`[tween] unsupported property type: ${path}`); return null; }
    const from = comps.map(c => cur[c]);
    const to = comps.map((c, i) => Array.isArray(toValue) ? (toValue[i] ?? from[i]) : typeof toValue === 'number' ? toValue : (toValue?.[c] ?? from[i]));
    const at = (i, k) => from[i] + (to[i] - from[i]) * k;
    // Euler: one set() so the object's quaternion follows once per step (its public setters keep it in sync)
    if (cur.isEuler) return k => { cur.set(at(0, k), at(1, k), at(2, k), cur.order); };
    return k => { for (let i = 0; i < comps.length; i++) cur[comps[i]] = at(i, k); };
  }
  console.warn(`[tween] unsupported property type: ${path}`);
  return null;
}

let tweenId = 0;   // page-wide on purpose: the owner names go into validate.js allowOwned, whose exemption set is shared by every engine on the page

export class Tweener {
  constructor() { this.list = []; }

  /**
   * General task: calls step(k) every frame, k is the eased progress. duration in seconds; returns a Promise with finish()/cancel().
   * The start value is read on the first update (so a later queued tween starts from where the previous one ended).
   */
  run({ duration = 0, ease = 'linear', start, step, end, group = null }) {
    let res;
    const p = new Promise(r => { res = r; });
    const task = { t: 0, dur: Math.max(0, duration), ease: easing(ease), start, step, end, group, res, started: false, done: false };
    task.finish = () => this._complete(task, 1);
    task.cancel = () => this._complete(task, null);
    p.finish = task.finish; p.cancel = task.cancel; p.task = task;
    this.list.push(task);
    if (task.dur === 0) this._complete(task, 1);
    return p;
  }

  /** Property tween: to = { 'position.x': 3, 'material.color': 0xffffff }. A value may also be a function () => value (evaluated at start) */
  // tweens are exempt from the "per-frame overwritten property" warning (tweening lights and fog is a legitimate takeover)
  tween(target, to, duration = 1, ease = 'inOutCubic', group = null) {
    let props = [];
    const owner = 'tween:' + (++tweenId);
    return this.run({
      duration, ease, group,
      start: () => { allowOwned(owner); props = Object.entries(to).map(([path, v]) => makeProp(target, path, typeof v === 'function' ? v() : v)).filter(Boolean); },
      step: k => { for (const f of props) f(k); },
      end: () => allowOwned(owner, false),
    });
  }

  update(dt) {
    if (!this.list.length) return;
    for (const task of [...this.list]) {
      if (task.done) continue;
      if (!task.started) { task.started = true; task.start?.(); }
      task.t += dt;
      if (task.t >= task.dur) this._complete(task, 1);
      else task.step?.(task.ease(task.t / task.dur));
    }
  }

  /** Jump a group of tasks (or all) to their end */
  finishAll(group) { for (const t of [...this.list]) if (group === undefined || t.group === group) t.finish(); }

  _complete(task, k) {
    if (task.done) return;
    task.done = true;
    if (k !== null) {
      if (!task.started) { task.started = true; task.start?.(); }
      task.step?.(task.ease(1));
    }
    task.end?.(k !== null);
    const i = this.list.indexOf(task); if (i >= 0) this.list.splice(i, 1);
    task.res(k !== null);
  }
}

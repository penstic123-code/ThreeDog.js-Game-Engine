// "Who wrote this picture value": the last file:line that changed a light, the fog, tone, environment, background or a material color, and one warning
// when two places fight over a value inside one frame. Dev server only (npm run dev, threedog snap): see ON below. It observes; every write goes through.
//
// Why accessors and a stack, not per-hook attribution: picture/index.js calls all its parts from one engine.onRender, so "which hook was running" names the
// wiring file for every value. Only the call stack of the write tells parts apart. Why own accessors on r / g / b and x / y / z: Color and Vector3 are
// changed in place (fog.color.lerp(...), light.position.copy(...)), so watching light.color alone would see nothing.
//
// Why not a stack on every write: a stack costs 10-40 us here, and a picture that moves 100 values would pay milliseconds each frame. So a write that
// changes nothing is ignored, and a value written every frame is looked at every EVERY frames (staggered). What still gets a stack at once: the first
// frames, a value that was not written last frame (a one-shot write), and a frame with more writes to a value than its last looked-at frame had (a
// new writer). So `framesAgo` says how old the answer is, and `writtenSince` says the value moved after that, unseen. An answer is never presented as
// fresher than it is.
//
// Why two places in one function are not a fight: fog.color.copy(a) then fog.color.lerp(b, t) is a value computed in steps. A place is a file plus a
// function name, plus the part running it. shortcut: outside parts, two anonymous functions or two same-named methods in one file count as one place, so a fight between them goes unwarned;
// upgrade by comparing function start lines if an agent reports one.
//
// Parts (modules, core/scene/pictureSlots.js): a value in a slot a part holds has a declared owner, so a write from anyone else is reported at once, naming the holder and
// both lines, not only when the two land in one frame (a held value written by a stray in another state would never be a fight). Who wrote it: the module running
// now (install, its hooks: core/engine/moduleTypes.js ownHook), else any frame in a file that part's code ran from (an event listener, a timer). A file two parts share
// cannot say which of them it was, so it counts as the holder: a warning that accuses the owner would teach agents to ignore this one.
// What cannot be seen: a write made before the holder took the slot, and a part added under another object rather than the scene root (see added).
//
// Leftovers: three.js objects have no owner, so ctx.track only removes what it was handed. Each root a picture part adds and each post effect is remembered until it
// leaves; what is still there after the part is gone, and a hook that outlived it, is reported by name. It observes, like the rest: nothing is cleaned up for the part.
import { warnOnce, fmt } from '../base/validate.js';
import { coded } from '../base/errorHints.js';
import { notePatch } from '../scene/threePatches.js';
import { sceneVisitor, onSceneRoot } from '../scene/sceneDelta.js';
import { stackFrames, frameText, callerAt, engineFile } from '../ops/stackFrames.js';
import { slotOfValue, slotHolder } from '../scene/pictureSlots.js';

const EVERY = 30;   // frames between two looks at a value written every frame: a stale answer is at most half a second old
const DEPTH = 10;   // three's own frames above the writer: setter, Color.copy, lerpColors ... always fewer
const NOT = {
  before: 'not tracked: set before it entered the scene',
  start: 'not tracked: three.js default or set before the engine was made',
  own: 'not tracked: this object defines the property with its own accessor',
  none: 'not tracked: never written since tracking began',
  noFile: 'not tracked: the last write had no source file (console, eval or the picture check)',
};
// three.js and pre-bundled libraries are never "the writer": the line that called them is
const SKIP = /\/deps\/|\/node_modules\/|\/three(?:\.[a-z]+)*\.js$/;
const SELF = /core\/inspect\/pictureWriters\.js$/;
const CORE = /\/(?:core|render)\/(?:[^/]+\/)?[^/]+$/;   // with engineFile: core and render (and their folders: core/ops/x.js) write for the engine; modules/ count as parts, they hold slots like any other
const MATERIALS_MAX = 40;   // describe() stays small on a big scene; explain still answers any one of them
const SHARED_FIX = "make it a shared value: the owner defines it with engine.stacks.define(name, { base: 1 }) and reads it where it writes three.js, the others change it with ctx.mod(name, { mul: 0.5 }); for an amount that moves, take it once, const h = ctx.mod(name, { mul: 1 }), and call h.change(x) each frame (recipes/62-picture-code.md)";
const STRINGS = {
  conflict: '{value} was written twice in one frame with different results: {first}, then {second}. The later write is what is drawn. Fix, one of: (1) one place keeps the write, delete the other{claim}; (2) if both need a say, ' + SHARED_FIX,
  claim: ", and that part declares it with provides: ['{slot}']",
  held: "{value} is held by part '{holder}' (provides: ['{slot}'], {place}), but {at} ({who}) wrote it too. The later write is what is drawn, so one of them never shows. Fix, one of: (1) delete the write at {at}; " +
    "(2) if that code should own it, give it provides: ['{slot}'] and install it with engine.use(thatPart(), { replaces: '{slot}' }), which unloads '{holder}'; (3) if both need a say, " + SHARED_FIX,
  leftover: "part '{name}' is gone, but what it added is still there: {list}. Fix: in its install, hand each one to ctx.track, e.g. ctx.track({ remove() { e.scene.remove(obj); obj.geometry.dispose(); } }), or undo it in the part's dispose()",
};

const page = { off: false, nextId: 0 };   // off: threePatches.off('picture-writers'), page-wide like the list

/** The writer of the running write: { at: 'picture/sky.js:12', key } or null when no frame names a source file */
function writerNow() {
  const E = /** @type {ErrorConstructor & { stackTraceLimit?: number }} */ (Error);   // stackTraceLimit is V8's (Chrome), not in the DOM typings
  const lim = E.stackTraceLimit; E.stackTraceLimit = DEPTH;
  const stack = new Error().stack; E.stackTraceLimit = lim;
  const all = stackFrames(stack ?? '').filter(x => !SELF.test(x.file)), i = all.findIndex(x => !SKIP.test(x.file));
  if (i < 0) return null;
  const f = all[i];
  // engine: the engine moved it for its own reasons (a debug view, the renderer fallback): no part's business. A frame skipped above can still be the engine's, in a game that has it in node_modules
  return { at: frameText(f), key: `${f.file}|${f.fn}`, file: f.file, frames: all.slice(i), engine: all.slice(0, i + 1).some(x => CORE.test(x.file) && engineFile(x.file)) };
}

// name: the value's writers name while it can be in a slot (null: a material); ownBy / ownAt: the holder's last write; last: the slot and whether its holder wrote last
const newRec = (why, name = null) => ({ id: page.nextId++, at: null, why, seen: 0, wrote: -1, f: -1, n: 0, usual: 0, next: 0, sample: true, placeKey: null, placeAt: null, placeBy: null, fought: false, name, ownBy: null, ownAt: null, last: null });
const who = name => name ? `part '${name}'` : 'code outside any part';

class Writers {
  constructor(e) {
    this.e = e;
    this.frame = 0;          // 0 = setup: every write gets a stack and nothing can fight yet (a game's setup overrides engine defaults on purpose)
    this.hooksRan = false;
    this.drawing = false;    // during the draw the engine swaps background / tone and puts them back: not a write to the picture
    this.stacks = 0;         // stacks taken, the whole cost of this file: read it to judge a slow dev frame
    this.fights = [];
    this.held = [];          // writes to a value another part holds
    this.leftovers = [];     // what removed parts left behind
    this.files = new Map();  // source file -> Set of the picture parts that ran from it
    this.homes = new Map();  // part -> a 'file:line' of its code once known, before that of the engine.use that installed it
    this.adds = new Map();   // part -> Map(thing -> { kind, name, at }), until the thing leaves
    this.addedBy = new WeakMap();   // thing -> part
    this.top = new Map();    // 'fog.far' -> record (scene, fog and renderer values)
    this.parts = new WeakMap();   // light or material -> { intensity: record, ... }
    this.done = new WeakSet();    // a Color or Vector3 already watched (a color shared by two objects answers for the first)
    const s = e.scene, r = e.renderer;
    this.number(r, 'toneMapping', this.named('renderer.toneMapping', NOT.start));
    this.number(r, 'toneMappingExposure', this.named('renderer.toneMappingExposure', NOT.start));
    for (const k of ['environmentIntensity', 'backgroundIntensity']) this.number(s, k, this.named('scene.' + k, NOT.start));
    this.number(s, 'environment', this.named('scene.environment', NOT.none));
    const bg = this.named('scene.background', NOT.start);
    this.slot(s, 'background', bg, c => { if (c?.isColor) this.watch(c, 'rgb', bg); });
    if (s.background?.isColor) this.watch(s.background, 'rgb', bg);
    const fog = this.named('scene.fog', NOT.none);
    this.slot(s, 'fog', fog, f => this.fog(f, fog));
    if (s.fog) this.fog(s.fog, fog);
    this.roots = onSceneRoot(s, o => this.added(/** @type {any} */ (o).isLight ? 'light' : 'object', o, o.name || o.type), o => this.left(o));
    this.view = sceneVisitor(s, { enter: o => {
      if (/** @type {any} */ (o).isLight) this.light(o);
      const m = /** @type {any} */ (o).material;
      if (m) for (const x of [].concat(m)) this.material(x);
    } });
  }

  named(label, why) { const r = newRec(why, () => label); this.top.set(label, r); return r; }

  /** Own accessor for one plain value; false when the object has none to replace. Reads and writes pass straight through */
  slot(o, key, rec, after) {
    const d = Object.getOwnPropertyDescriptor(o, key);
    if (!d || !('value' in d) || !d.configurable) { if (rec.why !== NOT.none || !d) rec.why = NOT.own; return false; }
    let v = d.value;
    const t = this;
    Object.defineProperty(o, key, { configurable: true, enumerable: d.enumerable, get: () => v,
      set(x) { if (x === v) return; v = x; t.wrote(rec); after?.(x); } });
    return true;
  }
  number(o, key, rec) { this.slot(o, key, rec); }
  /** The components of a Color or Vector3, all reporting to one record: to the game it is one value */
  watch(c, keys, rec) {
    if (this.done.has(c)) return;
    this.done.add(c);
    for (const k of keys) this.slot(c, k, rec);
  }
  /** A color held in a property: the components, and the property itself (light.color = other replaces the object the components were on) */
  color(o, key, rec) {
    if (!o[key]?.isColor) return false;
    this.watch(o[key], 'rgb', rec);
    this.slot(o, key, rec, c => { if (c?.isColor) this.watch(c, 'rgb', rec); });
    return true;
  }

  /** A fog assigned now: its values were set by whoever wrote scene.fog, so they start with that answer, not with "not tracked" */
  fog(f, slotRec) {
    for (const k of ['near', 'far', 'density', 'color']) this.top.delete('fog.' + k);
    if (!f) return;
    const seed = r => { r.at = slotRec.at; r.why = slotRec.why; r.seen = slotRec.seen; return r; };
    for (const k of f.isFogExp2 ? ['density'] : ['near', 'far']) this.number(f, k, seed(this.named('fog.' + k, NOT.before)));
    this.color(f, 'color', seed(this.named('fog.color', NOT.before)));
  }

  light(l) {
    if (this.parts.has(l) || page.off) return;
    const at = this.e._things?.entryOf(l)?.[0]?.at, why = NOT.before + (at ? ` (added at ${at})` : '');
    const rec = k => newRec(why, () => `light:${l.name}.${k}`);   // read at each write: a light can be named after it entered the scene
    const p = { intensity: rec('intensity'), color: rec('color'), position: rec('position') };
    this.parts.set(l, p);
    this.number(l, 'intensity', p.intensity);
    this.color(l, 'color', p.color);
    this.watch(l.position, 'xyz', p.position);
    if (l.groundColor) this.color(l, 'groundColor', p.groundColor = rec('groundColor'));
  }

  material(m) {
    if (this.parts.has(m) || page.off) return;
    const p = {};
    this.parts.set(m, p);
    for (const k of ['color', 'emissive']) if (m[k]?.isColor) this.color(m, k, p[k] = newRec(NOT.before));
    for (const k of ['opacity', 'emissiveIntensity']) if (typeof m[k] === 'number') this.number(m, k, p[k] = newRec(NOT.before));
  }

  /** The hot path: runs on every write that changed a value. No stack unless the header's rules ask for one */
  wrote(rec) {
    if (page.off || this.drawing || this.e._probing) return;
    const fr = this.frame;
    rec.wrote = fr;
    if (rec.f !== fr) {
      const cold = fr - rec.f > 1;
      rec.sample = fr === 0 || cold || fr >= rec.next;
      if (rec.sample) { rec.next = fr + EVERY + (rec.id & 7); rec.usual = 0; }   // & 7: values written together do not all come due in one frame
      rec.f = fr; rec.n = 0; rec.placeKey = null;
    }
    rec.n++;
    if (!rec.sample) {
      if (rec.n <= rec.usual) return;
      rec.sample = true; rec.next = fr + 1;   // more writes than usual: this one may be a new writer; next frame sees all of them from the first
    }
    rec.usual = rec.n;
    this.stacks++;
    const w = writerNow();
    rec.seen = fr;
    if (!w) { rec.at = null; rec.why = NOT.noFile; rec.placeKey = null; return; }
    const by = this.partsOf(w);
    this.claim(rec, w, by);
    const place = `${w.key}|${by[0] ?? ''}`;   // the part too: two parts' anonymous hooks in one file are two places
    if (!w.engine && fr > 0 && rec.placeKey && rec.placeKey !== place && !rec.fought) this.fight(rec, rec.placeAt, rec.placeBy, w.at, by[0]);
    rec.at = w.at; rec.why = null; rec.placeKey = place; rec.placeAt = w.at; rec.placeBy = by[0] ?? null;
  }

  /** The parts this write can be from: the running module alone, else every part that ran from a file on the stack, nearest first */
  partsOf(w) {
    const m = this.e._curModule;
    if (m) { if (m.type === 'picture' && !engineFile(w.file)) this.noteFile(w.file, m.name, w.at); return [m.name]; }
    for (const f of w.frames) { const s = this.files.get(f.file); if (s) return [...s]; }
    return [];
  }
  noteFile(file, part, at) {
    let s = this.files.get(file);
    if (!s) this.files.set(file, s = new Set());
    if (!s.has(part)) this.homes.set(part, at);
    s.add(part);
  }

  /** A value in a slot someone holds: a write by the holder is noted, one by anyone else is reported, once per value and place */
  claim(rec, w, by) {
    const label = rec.name?.(), slot = label ? slotOfValue(label) : null, holder = slot && slotHolder(this.e, slot);
    if (!holder) { rec.last = null; return; }
    if (rec.ownBy !== holder) { rec.ownBy = holder; rec.ownAt = null; }
    if (w.engine) return;
    if (by.includes(holder)) { rec.ownAt = w.at; rec.last = { slot, holder, writer: 'holder' }; return; }
    rec.last = { slot, holder, writer: 'stray', by: by[0] ?? null };
    rec.fought = true;   // this says more than a fight would, and the holder's next write would raise one
    const key = `${w.key}\0${label}`;
    if (this.held.some(h => h.key === key)) return;
    const place = rec.ownAt ? `last written at ${rec.ownAt}` : `it has not changed this value yet; its code is at ${this.homes.get(holder) ?? 'an unknown line'}`;
    this.held.push({ key, value: label, slot, holder, holderAt: rec.ownAt ?? this.homes.get(holder) ?? null, by: by[0] ?? null, at: w.at });
    warnOnce(coded('picture-held', fmt(STRINGS.held, { value: label, holder, slot, place, at: w.at, who: who(by[0]) })), `picture-held\0${key}`);
  }

  /** engine.use is installing m: where, for a report that has no line of the holder's yet */
  installing(m) { if (m.provides?.length) this.homes.set(m.name, callerAt()); }

  /** ctx.track called by m's own code: the caller's file is the part's, which is how a timer or a listener of the part gets attributed later */
  learn(m) {
    if (page.off || m.type !== 'picture') return;
    const E = /** @type {ErrorConstructor & { stackTraceLimit?: number }} */ (Error), lim = E.stackTraceLimit;
    E.stackTraceLimit = DEPTH;
    const stack = new Error().stack; E.stackTraceLimit = lim;
    const f = stackFrames(stack ?? '').find(x => !SELF.test(x.file) && !/core\/engine\/modules\.js$/.test(x.file));
    if (f && !engineFile(f.file)) this.noteFile(f.file, m.name, frameText(f));
  }

  /**
   * A scene root or a post effect just added: which picture part it belongs to, if any.
   * shortcut: only scene roots are seen. A light put under the camera or under another part's group is no root and goes unreported; upgrade through the visitor's
   * pending adds in core/scene/sceneDelta.js if an agent reports one.
   */
  added(kind, thing, name) {
    if (page.off) return;
    const m = this.e._curModule;
    if (m ? m.type !== 'picture' : !this.files.size) return;
    const w = m ? null : writerNow(), part = m?.name ?? (w && this.partsOf(w)[0]);
    if (!part) return;
    let mine = this.adds.get(part);
    if (!mine) this.adds.set(part, mine = new Map());
    mine.set(thing, { kind, name, at: callerAt() });
    this.addedBy.set(thing, part);
  }
  left(thing) { this.adds.get(this.addedBy.get(thing))?.delete(thing); }

  /** A module was unloaded, its tracked handles and dispose already run: name what stayed. swapping: the newcomer takes over the slots' values */
  partGone(m, swapping) {
    const mine = this.adds.get(m.name);
    this.adds.delete(m.name);
    if (page.off || m.type !== 'picture') return;
    const left = [];
    for (const [thing, r] of mine ?? []) if (!thing._removed) left.push(r);   // _removed: a post handle; a scene root that left is already out of the map
    const e = this.e;
    for (const list of [e._onRender.before, e._onRender.after, e._frame, e._animate, e._fixed, e._fixedLate]) for (const f of list) if (f.part === m.name) left.push({ kind: 'hook', name: 'frame callback', at: f.at });
    if (!swapping) for (const [name, on] of [['scene.fog', e.scene], ['scene.environment', e.scene], ['scene.background', e.scene]]) {
      const r = this.top.get(name), key = name.slice(6);
      if (r?.last?.holder === m.name && r.last.writer === 'holder' && on[key] != null) left.push({ kind: 'value', name, at: r.at });
    }
    if (!left.length) return;
    this.leftovers.push({ part: m.name, left });
    const list = left.map(r => `${r.kind} '${r.name}'${r.at ? ` (added at ${r.at})` : ''}`).join(', ');
    warnOnce(coded('picture-leftover', fmt(STRINGS.leftover, { name: m.name, list })), `picture-leftover\0${m.name}\0${list}`);
  }

  fight(rec, first, firstBy, second, secondBy) {
    rec.fought = true;
    const label = this.labelOf(rec) ?? 'a picture value', slot = slotOfValue(label);
    const said = (at, by) => by ? `${at} (part '${by}')` : at;
    this.fights.push({ value: label, first, second, ...(firstBy ? { firstBy } : {}), ...(secondBy ? { secondBy } : {}) });
    warnOnce(coded('picture-conflict', fmt(STRINGS.conflict, { value: label, first: said(first, firstBy), second: said(second, secondBy), claim: slot ? fmt(STRINGS.claim, { slot }) : '' })), `picture-conflict\0${rec.id}`);
  }

  /** Every value with a name, in one pass: lights and materials are found through the scene, so their names are the current ones */
  everyValue() {
    this.view.sync();
    const out = new Map(this.top), seen = new Map();
    const add = (prefix, o, name) => {
      const p = this.parts.get(o);
      if (!p) return;
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      const id = `${prefix}:${name}${n > 1 ? '#' + n : ''}`;
      for (const k in p) out.set(`${id}.${k}`, p[k]);
    };
    const mats = new Set();
    this.e.scene.traverse(o => {
      const x = /** @type {any} */ (o);
      if (x.isLight) add('light', x, x.name || x.type);
      if (x.material) for (const m of [].concat(x.material)) mats.add(m);
    });
    for (const m of mats) add('material', m, m.name || `${m.type}-${m.uuid.slice(0, 6)}`);
    return out;
  }
  labelOf(rec) { for (const [k, r] of this.everyValue()) if (r === rec) return k; return null; }

  answer(r) {
    if (!r.at) return { at: null, note: r.why };
    return { at: r.at, framesAgo: this.frame - r.seen, ...(r.wrote > r.seen ? { writtenSince: true } : {}), ...(r.last ?? {}) };
  }
  /** describe('picture').writers: materials nobody wrote since they entered the scene are left out (each would say the same "not tracked") */
  list() {
    const values = {};
    let mats = 0, more = 0;
    for (const [k, r] of this.everyValue()) {
      if (k.startsWith('material:')) { if (!r.at) continue; if (++mats > MATERIALS_MAX) { more++; continue; } }
      values[k] = this.answer(r);
    }
    return { tracked: true, frame: this.frame, stacks: this.stacks, values, conflicts: this.fights, held: this.held.map(({ key, ...h }) => h), leftovers: this.leftovers, ...(more ? { moreMaterials: more } : {}) };
  }
  /** One value by its describe name @param {string} label */
  why(label) {
    const all = this.everyValue(), r = all.get(label);
    if (!r) return { ok: false, text: `${label}: not tracked. Tracked names (describe('picture').writers): ${[...all.keys()].filter(k => !k.startsWith('material:')).join(', ')}, material:<name>.color / emissive / opacity / emissiveIntensity`, detail: null };
    const a = this.answer(r), fight = this.fights.find(f => f.value === label);
    const owner = !a.slot ? '' : a.writer === 'holder' ? `, by part '${a.holder}', which holds ${a.slot}` : `, by ${who(a.by)}, a stray write: part '${a.holder}' holds ${a.slot}`;
    const age = a.framesAgo ? `, looked at ${a.framesAgo} frames ago${a.writtenSince ? ' (written since, not looked at)' : ''}` : '';
    return { ok: !!a.at, text: `${label}: ${a.at ? `last changed at ${a.at}${owner}${age}` : a.note}${fight ? `. Two writers in one frame: ${fight.first}, then ${fight.second}` : ''}`, detail: { ...a, ...(fight ? { conflict: fight } : {}) } };
  }

  /** Top of a frame's hooks. Two frame hooks with no draw between (engine.step many frames, one draw) are two frames: a state change between them is no fight */
  frameStart() { this.view.sync(); if (this.hooksRan) this.frame++; this.hooksRan = true; }
  /** After the draw. The fixed steps before the next hooks count with that next frame, which is what they lead to */
  frameEnd() { this.drawing = false; this.frame++; this.hooksRan = false; }
  dispose() { this.view.remove(); this.roots.remove(); }
}

/** @param {any} e */
export function installPictureWriters(e) {
  notePatch('picture-writers', 'dev server only: intensity, color, position of lights, scene.fog and its values, renderer.toneMapping / toneMappingExposure, scene.environment / background and their intensities, material color / emissive / opacity: an own get / set on each, and on the r g b / x y z of the Color or Vector3 (core/inspect/pictureWriters.js)',
    () => { page.off = true; },   // accessors already placed stay and only pass values through; new objects get none
    { scope: 'objects in the scene', lost: "describe('picture').writers stops answering, and two writers in one frame are no longer warned about" });
  e._picture = new Writers(e);
}

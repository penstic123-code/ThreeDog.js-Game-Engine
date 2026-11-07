// What entered and left a scene since the last frame, so systems that must reach every object in the scene (the cascades patching
// materials, night glow finding its materials, the room map waiting for a material that reads it) visit only the new subtrees instead of
// each walking the whole scene after any change. While streaming, something is added almost every frame; four full walks of a 1000+
// object scene per such frame cost more than the frame's game code.
// One mechanism, shared: a system registers a visitor ({ enter(o), leave?(o) }) on a scene; enter runs once for every object in the
// scene (a full walk when the visitor is new or asks rescan(), then only objects that entered since), leave once when an entered object
// leaves. What is seen, and why each hook is there:
// - Object3D.prototype.add / remove (attach, clear and removeFromParent go through these): a game adds with scene.add, group.add,
//   engine.add or a loader, at any depth, and three's 'childadded' event only fires on the direct parent, so a listener on the scene
//   misses nested adds. The hook wraps three's own method, changes nothing else and is installed once per page. An add whose parent
//   chain does not reach a watched scene is ignored: a subtree built off-scene is visited whole when its root is attached.
// - mesh.material = other on an object the scene has seen (watchMaterial, put on every object with a material as it enters): an own
//   accessor on that one object (calling the class's own material getter / setter when it has one); the object leaves and enters again.
//   Swapping an entry inside a material array in place (mesh.material[1] = m) is not seen; assign a new array instead.
// A visitor keeps its own per-object / per-material state (Maps, WeakMaps); nothing here holds an object after it left the scene.
import * as THREE from 'three';
import { useSceneVisitor } from '../../render/backend.js';
import { notePatch, patchOn } from './threePatches.js';

const KEY = Symbol.for('threedog.sceneDelta');
const P = THREE.Object3D.prototype;
/** scene -> its tracker (one per scene, made when the first visitor registers, dropped with the last) */
const shared = globalThis[KEY] ??= { trackers: new WeakMap() };

/** The tracker of the scene this object is in, if that scene is watched (O(depth) parent walk) */
function trackerOf(o) {
  let r = o;
  while (r.parent) r = r.parent;
  return shared.trackers.get(r);
}

const ORIG = Symbol.for('threedog.sceneDelta.orig');   // three's own add / remove, for threePatches.off('scene-add-hook')
if (!P[KEY]) {
  const add = P.add, remove = P.remove;
  Object.defineProperty(P, KEY, { value: true, configurable: true });
  Object.defineProperty(P, ORIG, { value: { add, remove }, configurable: true });
  P.add = function (...a) {
    if (!patchOn('scene-add-hook')) return add.apply(this, a);   // switched off while another library's wrapper sits on top of ours: pass through
    const out = add.apply(this, a);   // three detaches each child from its old parent first (through remove below), then attaches
    const t = trackerOf(this);
    if (t) for (const c of a) if (c?.parent === this) t.pending.add(c);
    // a root right under the scene: the root listeners hear it now, not at the next flush, so engine.thing(obj) works on the next line and
    // an add inside a session:start listener still counts as setup (plain scene.add is adopted like engine.add: see onSceneRoot)
    if (t?.roots.size && this === t.scene) for (const c of a) if (c?.parent === this) for (const f of t.roots) f(c);
    return out;
  };
  P.remove = function (...a) {
    const t = patchOn('scene-add-hook') ? trackerOf(this) : null;
    if (!t) return remove.apply(this, a);
    let gone = null, roots = null;
    for (const c of a) if (c?.parent === this) (gone ??= []).push(c);   // not only seen ones: a material swap unmarks the root, its children stay counted (left checks each)
    if (t.rootLeaves.size && this === t.scene) for (const c of a) if (c?.parent === this) (roots ??= []).push(c);
    const out = remove.apply(this, a);
    if (gone) for (const c of gone) t.left(c);
    if (roots) for (const c of roots) if (c.parent !== this) for (const f of t.rootLeaves) f(c);
    return out;
  };
  P[ORIG].ours = { add: P.add, remove: P.remove };   // to tell at off() whether they are still the outermost
}
notePatch('scene-add-hook', 'Object3D.prototype.add / remove: wrapped once per page to see what enters and leaves a watched scene at any depth (three\'s childadded fires on the direct parent only)',
  () => {
    // a wrapper another library put on top of ours stays: taking it off would undo that library too. Ours then only passes calls through (patchOn above).
    const o = P[ORIG]; if (!o?.ours) return;
    if (P.add === o.ours.add) P.add = o.add;
    if (P.remove === o.ours.remove) P.remove = o.remove;
    if (P.add === o.add && P.remove === o.remove) { delete P[KEY]; delete P[ORIG]; }
  },
  { lost: 'plain scene.add is no longer adopted like engine.add, and cascades, night glow and light counts miss objects added later' });
notePatch('mesh-material-accessor', 'mesh.material on each object with a material that enters a watched scene: an own get / set on that object (the class accessor still runs) so a material swap is seen',
  () => {},   // off: objects entering from now on keep a plain material (_walk asks patchOn)
  { scope: 'objects in the scene', lost: 'mesh.material = other on objects entering from now on is not seen: the new material misses cascades until the object re-enters' });

/** The accessor (get / set) `material` resolves to on this object or up its prototype chain, or null when it is a plain value */
function materialAccessor(o) {
  for (let p = o; p; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, 'material');
    if (d) return d.get || d.set ? d : null;
  }
  return null;
}

/**
 * Make `o.material = x` on this object count as it leaving and entering again (idempotent; three still reads and writes o.material as usual).
 * A plain Mesh keeps material as a value: the own accessor below stores it. A class with its own material accessor (troika-three-text
 * derives the material it renders from the one assigned; other libraries do the same) keeps it: the own accessor calls the original getter
 * and setter, so the library's logic still runs, and only adds the leave / enter around the set. Such a getter may return a derived
 * material that is never === the one assigned, so there every set counts as a swap (one extra re-enter, harmless).
 */
function watchMaterial(o) {
  if (Object.prototype.hasOwnProperty.call(o, KEY)) return;
  if (Object.getOwnPropertyDescriptor(o, 'material')?.configurable === false) return;   // cannot be redefined: swaps on it are not seen
  const acc = materialAccessor(o);
  if (acc && !acc.set) return;   // getter only: assigning throws (strict mode) and nothing can swap it, so there is nothing to watch or to change
  let mat = acc ? undefined : o.material;
  Object.defineProperty(o, KEY, { value: true });
  Object.defineProperty(o, 'material', {
    configurable: true, enumerable: true,
    get: acc ? function () { return acc.get?.call(this); } : function () { return mat; },
    set(m) {
      if (!acc && m === mat) return;
      const t = trackerOf(o), was = t?.seen.has(o);
      if (was) t.left(o, false);   // leave sees the old material, so a visitor can drop what it counted for it
      if (acc) acc.set.call(this, m); else mat = m;
      if (was) t.pending.add(o);
    },
  });
}

class Tracker {
  /** @param {THREE.Object3D} scene */
  constructor(scene) {
    this.scene = scene;
    /** objects in the scene that every visitor has been shown (a WeakSet: an object that left and was dropped is not held) */
    this.seen = new WeakSet();
    /** subtree roots attached since the last flush (may have left again: flush checks) */
    this.pending = new Set();
    this.visitors = new Set();
    /** onSceneRoot listeners: called synchronously for each object added directly under the scene */
    this.roots = new Set();
    /** onSceneRoot leave listeners: called synchronously for each object taken off directly from under the scene */
    this.rootLeaves = new Set();
    this._walk(scene, null);   // what is in the scene already counts as seen; each new visitor gets its own full walk
  }
  /** Visit a subtree: objects not yet seen get seen and shown to the visitors (only `only` when given) */
  _walk(root, only) {
    const stack = [root];
    while (stack.length) {
      const o = stack.pop();
      if (only) only.enter(o);
      else if (!this.seen.has(o)) {
        this.seen.add(o);
        if (o.material !== undefined && patchOn('mesh-material-accessor')) watchMaterial(o);
        for (const v of this.visitors) if (!v.full) v.spec.enter(o);
      }
      for (const c of o.children) stack.push(c);
    }
  }
  /** An object left (removed, or its material swapped when deep = false): every seen object in its subtree leaves */
  left(root, deep = true) {
    const stack = [root];
    while (stack.length) {
      const o = stack.pop();
      if (this.seen.has(o)) {
        this.seen.delete(o);
        for (const v of this.visitors) if (!v.full) v.spec.leave?.(o);
      }
      if (deep) for (const c of o.children) stack.push(c);
    }
  }
  /** Show the visitors what entered since the last flush (the first visitor to sync in a frame pays for all) */
  flush() {
    if (!this.pending.size) return;
    for (const r of this.pending) {
      let top = r;
      while (top.parent) top = top.parent;
      if (top === this.scene) this._walk(r, null);   // left again before the frame, or attached to an off-scene group: nothing to show
    }
    this.pending.clear();
  }
}

/**
 * Register a visitor on a scene. enter(o) runs once for every object in the scene and every object that enters it later, leave(o) once
 * for each of those that leaves (o.material is still the old one when a material swap is the reason). Call sync() on the frame the
 * visitor needs to be up to date; it costs one size check when nothing entered.
 * @param {THREE.Object3D} scene
 * @param {{ enter(o: THREE.Object3D): void, leave?(o: THREE.Object3D): void }} spec
 */
export function sceneVisitor(scene, spec) {
  const t = shared.trackers.get(scene) ?? new Tracker(scene);
  shared.trackers.set(scene, t);
  const v = {
    spec, full: true,
    /** full walks this visitor ran (tests read it: a quiet frame or an add must not add one) */
    walks: 0,
    /** Bring the visitor up to date: what entered since the last flush, or the whole scene once after creation / rescan() */
    sync() {
      t.flush();
      if (v.full) { v.full = false; v.walks++; t._walk(scene, spec); }
    },
    /** Show this visitor the whole scene again at the next sync (its own rules changed); it resets its own state first */
    rescan() { v.full = true; },
    /** Stop visiting; the scene stops being watched when no visitor is left */
    remove() {
      t.visitors.delete(v);
      if (!t.visitors.size && !t.roots.size && shared.trackers.get(scene) === t) shared.trackers.delete(scene);
    },
  };
  t.visitors.add(v);
  return v;
}
/**
 * Call fn(obj) synchronously each time an object is added directly under scene (scene.add, engine.add, attach), from any code. The thing
 * registry uses it so a plain three.js scene.add is adopted like engine.add. leave(obj), when given, runs each time one is taken off from
 * directly under scene (scene.remove, removeFromParent, attach elsewhere). Returns { remove() }.
 * @param {THREE.Object3D} scene @param {(o: THREE.Object3D) => void} fn @param {(o: THREE.Object3D) => void} [leave]
 */
export function onSceneRoot(scene, fn, leave) {
  const t = shared.trackers.get(scene) ?? new Tracker(scene);
  shared.trackers.set(scene, t);
  t.roots.add(fn);
  if (leave) t.rootLeaves.add(leave);
  return {
    remove() {
      t.roots.delete(fn);
      if (leave) t.rootLeaves.delete(leave);
      if (!t.visitors.size && !t.roots.size && shared.trackers.get(scene) === t) shared.trackers.delete(scene);
    },
  };
}
useSceneVisitor(sceneVisitor);   // render/backend.js shadowLights: the shadow lights of a scene without a walk per frame

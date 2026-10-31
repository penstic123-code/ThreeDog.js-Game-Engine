// Trigger zone module: invisible regions in the world that notify you when the player (or something else) enters, leaves or stays inside.
// Use for: auto-opening a door, showing a place name on entering a village, traps, starting dialogue at a story spot, stopping music when leaving an area...
//
// const door = engine.triggers.add({
//   shape: 'box', position: { x: 4, y: 0, z: -2 }, size: [3, 3, 2],
//   tag: 'door', onEnter: t => openDoor(), onExit: t => closeDoor(),
// });
// door.remove();                                         // remove when no longer needed
// engine.events.on('trigger:enter', ({ tag }) => ...);   // or listen to the events globally
// engine.triggers.fromMarkers();                          // every trigger_xxx marker in the level becomes a trigger zone (tag = xxx)
//
// Parameters of add():
//   shape      'sphere' | 'box' (can rotate) | 'cylinder' (vertical, default)
//   position   center { x, y, z } / Vector3 / Object3D / [x, y, z]. For box and cylinder, y is the bottom height; if y is omitted, the ground height there is used
//   radius     sphere/cylinder radius (default 1.5); size [width, height, depth] (box, default [2,2,2]); height cylinder height (default 3)
//   rotation   box rotation around the Y axis in radians (default 0)
//   onEnter(t, who) / onExit(t, who) / onStay(dt, t, who)   callbacks; who is the position that entered
//   once       fire on the first enter only (default false; exit follows at once); t.used is true afterwards, and a new playthrough (engine.session) re-arms it
//   enabled    false pauses detection (handle.enabled can be changed any time)
//   tag        name carried in events, for shared handling
//   who        what can trigger: default is engine.actorPosition() (the player, or what engine.actor names; engine.focus without a player); or a Vector3 / Object3D, or a function returning an array of positions () => [p1, p2]
//   cooldown   seconds after leaving during which enter will not fire again (stops edge jitter from re-triggering), default 0
// Returned handle: { tag, inside, enabled, used, remove(), contains(p) }
//
// Events: trigger:enter / trigger:exit with { tag, trigger, who }. On removal (remove / clear) and at the end of a playthrough, zones still occupied send exit first (who is null)
// A playthrough ending (engine.session newGame / load / quit) resets every zone: occupied ones exit, cooldowns clear, once zones are re-armed;
// so the zone around the spawn point fires enter again in the new playthrough. Zones added during play belong to the game: wrap them in engine.session.track(h).
//
// Debug display: triggers({ debug: true }) or engine.triggers.setDebug(true) draws all trigger zones as wireframes.
//   Look comes from style.triggers = { debugColor, debugOpacity } of the style pack; neutral gray if absent (a dev overlay: its line material is not a makeMaterial role).
//   In dev builds F4 (action triggersDebug, rebindable) toggles the display; release builds bind no key unless triggers({ keys }) names one.
import * as THREE from 'three';
import { checkOptions, DEV } from '../../core/validate.js';

const ADD_KEYS = ['shape', 'position', 'radius', 'size', 'height', 'rotation', 'onEnter', 'onExit', 'onStay', 'once', 'enabled', 'tag', 'who', 'cooldown', 'userData'];

const STRINGS = {
  'zh-CN': { 'triggers.debug': '显示触发区' },
  en: { 'triggers.debug': 'Show triggers' },
};

export class Triggers {
  constructor(engine, { debug = false, action = 'triggersDebug', keys = DEV ? ['F4'] : [] } = {}) {
    this.engine = engine;
    this.list = [];
    this.debug = false;
    this.action = action;
    this._one = [null];           // by default "who" is a single position: reuse this array to avoid per-frame allocation
    this._custom = [null];
    this._scan = [];               // snapshot iterated by update(): callbacks may add / remove zones
    this._debugGroup = null;
    engine.i18n.add(STRINGS);
    /** @internal the debug toggle has a key */ this._keyed = keys.length > 0;
    if (this._keyed) engine.input.define(action, keys, 'triggers.debug');
    if (debug) this.setDebug(true);
  }

  add(opts = {}) {
    checkOptions('triggers.add()', opts, ADD_KEYS);
    const { shape = 'cylinder', position: at = {}, radius = 1.5, size = [2, 2, 2], height = 3, rotation = 0, onEnter = null, onExit = null, onStay = null,
      once = false, enabled = true, tag = '', who = null, cooldown = 0, userData = {} } = opts;
    const position = at.isObject3D ? at.position : Array.isArray(at) ? { x: at[0], y: at[1], z: at[2] } : at;
    const e = this.engine, x = position.x ?? 0, z = position.z ?? 0;
    const y = position.y ?? e.surface(x, z);
    const t = {
      shape, x, y, z, radius, hx: size[0] / 2, hy: size[1] / 2, hz: size[2] / 2, sy: size[1], height, rotation,
      c: Math.cos(rotation), s: Math.sin(rotation), onEnter, onExit, onStay, once, enabled, tag, who, cooldown, userData,
      inside: false, used: false, _cool: 0, _mesh: null, _gone: false,
      remove: () => this._remove(t),
      contains: p => this._contains(t, p),
    };
    this.list.push(t);
    if (this.debug) this._addDebugMesh(t);
    return t;
  }

  _remove(t) {   // remove only through the handle t.remove(); zones still occupied send exit first (so music areas and content onExit can clean up)
    const i = this.list.indexOf(t); if (i < 0) return;
    if (t.inside) this._exit(t, null);
    this.list.splice(i, 1);
    t._gone = true;
    if (t._mesh) { t._mesh.parent?.remove(t._mesh); t._mesh.geometry.dispose(); t._mesh = null; }
  }
  clear() { for (const t of [...this.list]) this._remove(t); }
  byTag(tag) { return this.list.filter(t => t.tag === tag); }

  /**
   * Create trigger zones from level markers: each trigger_xxx becomes a zone with tag xxx.
   * Shape and size are read first from the marker's userData.shape / radius / size / height, otherwise derived from object scale:
   *   scale (sx, sy, sz) -> box [2sx, 2sy, 2sz] centered on the marker (matches Blender's default cube empty)
   * Callbacks etc. in opts are shared by every zone. Returns an array of created handles.
   * These zones belong to the current level: removed automatically on level change / unload (level.track)
   */
  fromMarkers(opts = {}) {
    const markers = this.engine.level?.markers || {};
    const out = [];
    for (const m of Object.values(markers)) {
      if (!/^trigger_/i.test(m.name)) continue;
      const u = m.userData || {}, s = m.scale, p = m.position;
      const shape = u.shape || opts.shape || 'box';
      const euler = new THREE.Euler().setFromQuaternion(m.quaternion, 'YXZ');
      const size = u.size || [2 * Math.abs(s.x), 2 * Math.abs(s.y), 2 * Math.abs(s.z)];
      const radius = u.radius ?? Math.max(Math.abs(s.x), Math.abs(s.z));
      const height = u.height ?? 2 * Math.abs(s.y);
      // box/cylinder y is the bottom: marker is the center, so shift down by half the height
      const half = shape === 'box' ? size[1] / 2 : shape === 'cylinder' ? height / 2 : 0;
      const t = this.add({ ...opts, shape, size, radius, height, rotation: euler.y, tag: m.name.slice(8), userData: u,
        position: { x: p.x, y: p.y - half, z: p.z } });
      this.engine.level?.track(t);
      out.push(t);
    }
    return out;
  }

  _contains(t, p) {
    const dx = p.x - t.x, dz = p.z - t.z;
    if (t.shape === 'sphere') { const dy = p.y - t.y; return dx * dx + dy * dy + dz * dz <= t.radius * t.radius; }
    const dy = p.y - t.y;
    if (t.shape === 'box') {
      if (dy < 0 || dy > t.sy) return false;
      const lx = dx * t.c - dz * t.s, lz = dx * t.s + dz * t.c;    // same rotation convention as the collision module's rectangle
      return Math.abs(lx) <= t.hx && Math.abs(lz) <= t.hz;
    }
    return dy >= 0 && dy <= t.height && dx * dx + dz * dz <= t.radius * t.radius;
  }

  _defaultWho() {
    const e = this.engine;
    this._one[0] = e.actorPosition();   // engine.actor: the player by default, or the vehicle / squad member the game handed control to
    return this._one;
  }

  /** Fixed step: enter / stay / exit for every zone */
  update(dt) {
    const e = this.engine;
    if (!this.list.length) return;
    const def = this._defaultWho(), list = this._scan;
    list.length = 0; list.push(...this.list);   // a callback removing an earlier zone must not make a later one run twice
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      if (t._gone) continue;
      if (t._cool > 0) t._cool -= dt;
      if (!t.enabled || t.used) { if (t.inside) this._exit(t, null); continue; }
      let ps = def;
      if (t.who) { if (typeof t.who === 'function') ps = t.who(); else { this._custom[0] = t.who.isObject3D ? t.who.position : t.who; ps = this._custom; } }
      let hit = null;
      if (ps) for (let k = 0; k < ps.length; k++) { const p = ps[k]; if (p && this._contains(t, p)) { hit = p; break; } }
      if (hit && !t.inside) {
        if (t._cool > 0) continue;
        t.inside = true;
        t.onEnter?.(t, hit);
        e.events.emit('trigger:enter', { tag: t.tag, trigger: t, who: hit });
        if (t.once) { t.used = true; this._exit(t, null); continue; }
      } else if (!hit && t.inside) this._exit(t, null);
      else if (hit && t.inside) t.onStay?.(dt, t, hit);
    }
  }
  /** @internal session:end: occupied zones exit, cooldowns clear, once zones are armed again (recipes/14-custom-module.md "Per-playthrough state") */
  _reset() {
    for (const t of [...this.list]) { if (t.inside) this._exit(t, null); t._cool = 0; t.used = false; }
  }
  _exit(t, who) {
    t.inside = false; t._cool = t.cooldown;
    t.onExit?.(t, who);
    this.engine.events.emit('trigger:exit', { tag: t.tag, trigger: t, who });
  }

  // ---------- debug display ----------
  setDebug(on) {
    this.debug = on;
    if (on) {
      if (!this._debugGroup) { this._debugGroup = new THREE.Group(); this._debugGroup.name = 'triggers-debug'; }
      const st = this.engine.style.triggers || {};
      this._mat ??= new THREE.LineBasicMaterial({ color: st.debugColor ?? 0x9a9a9a, transparent: true, opacity: st.debugOpacity ?? 0.8, depthTest: false });
      this.engine.add(this._debugGroup);
      for (const t of this.list) if (!t._mesh) this._addDebugMesh(t);
    } else if (this._debugGroup) {
      for (const t of this.list) if (t._mesh) { t._mesh.geometry.dispose(); t._mesh = null; }
      this._debugGroup.clear(); this.engine.detach(this._debugGroup);   // keep group and material for the next enable
    }
  }
  _addDebugMesh(t) {
    let geo;
    if (t.shape === 'sphere') geo = new THREE.SphereGeometry(t.radius, 12, 8);
    else if (t.shape === 'box') geo = new THREE.BoxGeometry(t.hx * 2, t.sy, t.hz * 2).translate(0, t.sy / 2, 0);
    else geo = new THREE.CylinderGeometry(t.radius, t.radius, t.height, 16, 1, true).translate(0, t.height / 2, 0);
    const lines = new THREE.LineSegments(new THREE.WireframeGeometry(geo), this._mat);
    geo.dispose();
    lines.position.set(t.x, t.y, t.z); lines.rotation.y = t.rotation; lines.renderOrder = 999;
    this._debugGroup.add(lines);
    t._mesh = lines;
  }
}

/** Trigger zone module. Provides engine.triggers once installed. Optional dependency: level (used by fromMarkers) */
export function triggers(opts = {}) {
  let tr = null;
  return {
    name: 'triggers', label: 'Triggers', optional: ['level'], stage: 'gameplay', after: ['interactions'],
    install(e) {
      checkOptions('triggers()', opts, ['debug', 'action', 'keys']);
      tr = new Triggers(e, opts);
      e.events.on('session:end', () => tr._reset());
      return tr;
    },
    fixed(dt) { tr.update(dt); },
    frame(dt, e) { if (tr._keyed && e.input.pressed(tr.action)) tr.setDebug(!tr.debug); },
    describe(e, ctx) {
      for (const t of tr.list) if (t.enabled && !t.used) ctx.near(t, { name: t.tag || t.shape, kind: 'trigger', inside: t.inside });
      return { inside: tr.list.filter(t => t.inside).map(t => t.tag || t.shape), used: tr.list.filter(t => t.used).map(t => t.tag || t.shape) };
    },
  };
}

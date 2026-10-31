// Objective markers and a simple HUD: world markers (an edge-of-screen arrow when the target is off-screen), counters, progress bars.
//   const m = engine.hud.marker(npc.root, { label: '面包师' });  m.set({ label: '面包师（关门了）' });  m.remove();
//   engine.hud.marker('river')                              // a place name (content places or a level marker point), { x, z }, an object or a character all work
//   engine.hud.marker({ nearest: 'berry' })                 // the nearest not-yet-picked pickup of a kind (hides itself once all are taken)
//   engine.hud.marker(() => targetOrNull)                   // function: resolves the target each frame, null hides it; m.setTarget(newTarget) swaps the target
//   engine.hud.counter('fish', { icon: '🐟', label: '鱼', value: 2, max: 5 });   // calling again with the same id = update
//   engine.hud.bar('stamina', { value: 0.6, label: '体力' });   engine.hud.remove('stamina');
// Quests: a marker shows automatically when the current step has a target, and is removed on completion (turn off with hud({ questMarkers: false })).
//   Quest markers follow the quests' state: they are dropped when a playthrough ends and rebuilt when the next starts (engine.session) or a save loads.
//   Markers, counters and bars the game made itself stay; ones made during play go through engine.session.track(m) (counters / bars: hud.remove(id)).
// Drawing is done by UI parts (see parts.js): engine.ui.set('hud.marker' | 'hud.counter' | 'hud.bar', yourFactory | false) replaces or hides each kind;
//   this file keeps the logic (targets, projection, arrows, quest sync, describe) so a replaced part only draws the data it gets.
import * as THREE from 'three';
import { injectUICSS, worldToScreen } from '../../ui/UI.js';
import { checkOptions } from '../../core/validate.js';
import { vec3 } from '../../core/math.js';
import { CSS, defineHudParts } from './parts.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { Hud, HudOptions } from '../../types/gameplay' */

const STRINGS = {
  'zh-CN': { 'hud.distance': '{m} 米' },
  en: { 'hud.distance': '{m} m' },
};
const MARKER_KEYS = ['label', 'icon', 'offscreen', 'distance', 'height'];
const EDGE = 28;   // how far the arrow sits from the screen edge (px)

/**
 * Objective markers, counters, progress bars -> engine.hud
 * @param {HudOptions} [opts]
 * @returns {ModuleDef<Hud>}
 */
export function hud(opts = {}) {
  let e = null, root = null;
  const items = new Map();       // counters, bars: id -> { kind, o, part }
  const quest = new Map();       // quest id -> auto marker
  const v = new THREE.Vector3();
  // Containers of the default parts, built on first use (a game that replaced every part gets no empty HUD layer)
  const containers = () => {
    if (!root) {
      injectUICSS(CSS);
      const layer = document.createElement('div'); layer.className = 'threedog-ui threedog-hud';
      const stats = document.createElement('div'); stats.className = 'threedog-hud-stats';
      layer.appendChild(stats); e.uiRoot.appendChild(layer);
      root = { layer, stats };
    }
    return root;
  };

  // { nearest: itemId } -> the nearest not-yet-picked pickup (world data, so it is found even when far away with no model)
  const nearest = id => e.inventory?.nearestPickup(id, e.actorPosition())?.position ?? null;
  // Target -> world position (written into v); null if not found
  const resolve = (target, height) => {
    if (typeof target === 'function') target = target();
    if (target?.nearest != null) target = nearest(target.nearest);
    if (target == null) return null;
    if (typeof target === 'string') {
      const p = e.content?.place(target) ?? e.level?.marker(target)?.position;
      if (!p) return null;
      return v.set(p.x, e.surface(p.x, p.z, p.y) + height, p.z);   // a level marker's own height picks its storey
    }
    const obj = target.root?.isObject3D ? target.root : target;
    if (obj.isObject3D) { obj.getWorldPosition(v); v.y += height; return v; }
    vec3(target, v);
    if (target.y === undefined) v.y = e.surface(v.x, v.z);
    v.y += height;
    return v;
  };

  const hideMarker = m => { if (m.visible) { m.visible = false; m.part?.hide(); } };
  const updateMarker = m => {
    const p = resolve(m.target, m.o.height ?? 2.2);
    if (!p) { hideMarker(m); return; }
    const from = e.actorPosition() ?? e.focus;   // distance from whoever the user controls (engine.actor)
    m.dist = Math.round(p.distanceTo(from));
    const s = worldToScreen(e, p), W = innerWidth, H = innerHeight;
    m.onScreen = s.onScreen;
    if (!s.onScreen && m.o.offscreen === 'hide') { hideMarker(m); return; }
    m.visible = true;
    let x = s.x, y = s.y, angle = 0;
    m.arrow = !s.onScreen;
    if (m.arrow) {
      // Point from the screen center to the target (the projection is mirrored when behind, so flip it), clamped to the screen edge
      let dx = x - W / 2, dy = y - H / 2;
      if (s.behind) { dx = -dx; dy = -dy; }
      if (!dx && !dy) dy = 1;
      const k = Math.min((W / 2 - EDGE) / Math.abs(dx || 1e-6), (H / 2 - EDGE) / Math.abs(dy || 1e-6));
      x = W / 2 + dx * k; y = H / 2 + dy * k; angle = Math.atan2(dy, dx);
    }
    if (!m.part) return;
    const o = m.o, label = typeof o.label === 'function' ? o.label() : o.label ?? '';
    const distance = o.distance !== false && m.dist != null ? e.t('hud.distance', { m: m.dist }) : '';
    m.part.update({ x, y, onScreen: s.onScreen, arrow: m.arrow, angle, label, icon: o.icon ?? '', distance });
  };

  const item = (kind, id, o) => {
    let it = items.get(id);
    if (!it) { it = { kind, o: {}, part: e.ui.create('hud.' + kind) }; items.set(id, it); }
    else if (Object.keys(o).every(k => it.o[k] === o[k])) return;   // value unchanged: leave the part alone (cheap even when called every frame)
    Object.assign(it.o, o);
    it.part?.update({ id, ...it.o });
  };

  // The current quest step's target -> marker; a parallel step marks each part not yet done (key 'quest#part')
  const syncQuests = () => {
    if (opts.questMarkers === false || !e.quests) return;
    const want = new Map();
    for (const q of e.quests.list()) {
      const s = q.steps.find(x => x.current);
      if (s?.parts) s.parts.forEach((p, k) => { if (!p.done && p.target != null) want.set(`${q.id}#${k}`, { target: p.target, label: p.text }); });
      else if (s?.target != null) want.set(q.id, { target: s.target, label: q.title });
    }
    for (const [id, m] of quest) if (want.get(id)?.target !== m.target) { m.remove(); quest.delete(id); }
    for (const [id, w] of want) if (!quest.has(id)) quest.set(id, api.marker(w.target, { label: w.label }));
  };

  const api = {
    /** All markers */
    markers: [],
    /** Add an objective marker (target: object, character, { x, z }, place name, { nearest: itemId }, or a function returning a target); returns { set(opts), setTarget(t), remove() } */
    marker(target, o = {}) {
      checkOptions('hud.marker()', o, MARKER_KEYS);
      const part = e.ui.create('hud.marker');
      const m = {
        target, o: { offscreen: 'arrow', distance: true, ...o }, part, el: part?.el ?? null, dist: null, onScreen: false, arrow: false, visible: false,
        set(p) { checkOptions('hud.marker().set()', p, MARKER_KEYS); Object.assign(m.o, p); },
        setTarget(t) { m.target = t; },
        remove() { part?.dispose(); api.markers = api.markers.filter(x => x !== m); },
      };
      api.markers.push(m);
      return m;
    },
    /** Counter (calling again with the same id = update): { label, icon, value, max } */
    counter(id, o) { item('counter', id, o); },
    /** Progress bar (calling again with the same id = update): { value, max = 1, label } */
    bar(id, o) { item('bar', id, o); },
    /** Remove a counter or bar */
    remove(id) { items.get(id)?.part?.dispose(); items.delete(id); },
  };

  return {
    name: 'hud', label: 'Objective markers', optional: ['inventory', 'content', 'level', 'quests'], stage: 'presentation', after: ['particles', 'settings'], presentation: true,
    install(engine) {
      e = engine;
      checkOptions('hud()', opts, ['questMarkers']);
      e.i18n.add(STRINGS);
      defineHudParts(e, containers);
      for (const ev of ['quest:start', 'quest:step', 'quest:part', 'quest:done', 'quest:fail', 'load', 'session:start']) e.events.on(ev, syncQuests);
      // per-playthrough state (recipes/14-custom-module.md "Per-playthrough state"): quest markers belong to the old quests
      e.events.on('session:end', () => { for (const m of quest.values()) m.remove(); quest.clear(); });
      e.events.on('i18n:change', () => { for (const [id, it] of items) it.part?.update({ id, ...it.o }); });
      return api;
    },
    frame() { for (const m of api.markers) updateMarker(m); },
    describe() {
      return {
        markers: api.markers.map(m => ({ label: typeof m.o.label === 'function' ? m.o.label() : m.o.label ?? null, distance: m.dist, onScreen: m.onScreen, visible: m.visible })),
        counters: Object.fromEntries([...items].map(([id, it]) => [id, it.o.value ?? null])),
      };
    },
  };
}

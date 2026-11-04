// Light pool: many sources, a few real lights.
// Sources: torches, street lamps, campfires, muzzle flashes, neon signs; the real lights are a fixed handful of three.js lights.
//   engine.use(lightPool({ point: 8 }));                                     // 8 real PointLights, created now, never added / removed / hidden
//   const torch = engine.lightPool.add(torchMesh, { color: 0xffa040, intensity: 4, distance: 8 });
//   torch.set({ intensity: 0 });  torch.remove();
// Why: three.js builds one shader program per material for each light setup (how many point / spot / directional... lights the scene has).
// Adding, removing or hiding a light mid-play changes the setup and compiles new programs, so one frame freezes for hundreds of milliseconds
// (seen in a first-person dungeon: torches switched lights by distance, programs 27 -> 30, a 450 ms frame). The pool's lights exist from install,
// so engine.start() compiles every material for them behind the loading screen; afterwards they only move to the sources that matter most
// and fade with intensity (0 = dark but still counted: no recompile). core/lightWatch.js warns in dev when a game changes its lights anyway.
// Choosing: every `every` seconds each source scores priority x intensity / (1 + (d / range)^2), d = distance to the focus (default the camera);
// a source that already holds a light gets a small bonus so two equal torches do not swap back and forth. A slot fades its old source out
// before taking the next one, so lights never pop. Sources without a light can drive a stand-in (`glow`: a halo sprite or emissive material).
// Shadows: none by default; lightPool({ shadows: k }) makes k of the point lights cast, used by sources added with castShadow: true.
// An idle shadow light (no source, or faded to 0) stops re-rendering its cube shadow map (shadow.autoUpdate = false): six shadow passes a frame for a dark light.
// When every point light casts (shadows >= point) there are no plain ones, so sources without castShadow also take the shadow lights (they cast then) instead of never lighting.
// Day / night: a source added with `dusk` (street lamps, shop lights) is scaled by the daylight curve of engine.uniforms.uNight (render/daylight.js,
// shared code, not a copy), so its real light, its stand-in and the game's window glow switch on together. Off by default: a torch in a cave, a
// muzzle flash or a lamp the game wants lit at noon keeps its intensity. Its scaled intensity is what the choice scores, so lamps that are off by
// day give their lights to sources that are lit.
import { engineOwned } from '../../core/things.js';
import * as THREE from 'three';
import { warnOnce } from '../../core/validate.js';
import { readParams, keysSchema } from '../../core/params.js';
import { vec3 } from '../../core/math.js';
import { codedError, coded } from '../../core/errorHints.js';
import { DUSK, daylightOf, nightOf } from '../../render/daylight.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { LightPool, LightPoolOptions } from '../../types/world' */

const OPT_KEYS = ['point', 'spot', 'shadows', 'every', 'fade', 'focus'];
const ADD_KEYS = ['name', 'type', 'color', 'intensity', 'distance', 'decay', 'priority', 'castShadow', 'angle', 'penumbra', 'target', 'flicker', 'glow', 'dusk'];
const SET_KEYS = ['position', ...ADD_KEYS.filter(k => k !== 'type' && k !== 'castShadow')];   // the kind of light a source needs is fixed when it is added
const BONUS = 1.25;   // score bonus for a source that already holds a light (hysteresis)
const STRINGS = {
  late: 'lightPool() was installed after engine.start(): its lights were added to a running scene, so every material compiles once more (one long frame). Install it with the other modules, before engine.start() [light-recompile]',
  type: "lightPool.add(): type must be 'point' or 'spot', got ",
  allShadow: 'lightPool({ point: {n}, shadows: {k} }): every point light casts shadows, so sources added without castShadow use shadow lights too (and cast). For plain lights next to the shadow ones give point more than shadows, e.g. lightPool({ point: {m}, shadows: {k} })',
  noSlot: "lightPool.add(): a '{type}' source but lightPool({ {type}: 0 }) has no {type} lights; give lightPool() a count, e.g. lightPool({ {type}: 2 })",
  dusk: 'lightPool.add(): dusk is true (the glow default, {d}), false, or the daylight (0..1; 0 = on only while daylight is 0) below which the source fades in; got ',
  noDay: 'lightPool: a source follows daylight (dusk) but nothing tells day from night, so it stays at its day value (off). Install calendar() (or sky())',
};

/** The material a glow stand-in drives, and which of its numbers: emissiveIntensity when it has one (emissive mesh), else opacity (halo sprite) */
function glowOf(g) {
  if (!g) return null;
  let m = g.isMaterial ? g : null;
  if (!m) g.traverse?.(o => { if (!m && o.material && !Array.isArray(o.material)) m = o.material; });
  if (!m) return null;
  const key = 'emissiveIntensity' in m ? 'emissiveIntensity' : 'opacity';
  return { m, key, base: m[key], k: -1 };
}

const LIGHT_POOL_PARAMS = keysSchema(OPT_KEYS);

/**
 * Light pool (many light sources, a fixed number of real lights) -> engine.lightPool
 * @param {LightPoolOptions} [opts]
 * @returns {ModuleDef<LightPool>}
 * @example
 * engine.use(lightPool({ point: 8 }));   // before engine.start(), so the startup compile covers these lights
 * for (const t of torchMeshes) engine.lightPool.add(t, { color: 0xffa040, intensity: 4, distance: 8, flicker: (time, i) => 0.85 + 0.15 * Math.sin(time * 13 + i) });
 */
export function lightPool(opts = {}) {
  readParams('lightPool', LIGHT_POOL_PARAMS, opts);
  const { point = 8, spot = 0, shadows = 0, every = 0.1, fade = 0.3 } = opts;
  let e = null, timer = Infinity, time = 0, seq = 0, daylight = null, cut = false, offCut = null;
  const sources = [], groups = [], tmp = new THREE.Vector3(), at = new THREE.Vector3();

  const worldPos = (src, out) => src.follow ? out.setFromMatrixPosition(src.follow.matrixWorld) : out.copy(src.pos);
  // 1 for a source that ignores the time of day, else the night factor (0 by day, 1 at night) for its dusk
  const nightK = src => src.dusk === null ? 1 : nightOf(daylight, src.dusk);
  const litOf = src => src.intensity * nightK(src);
  const setGlow = (src, k) => {
    const g = src.glow;
    if (!g) return;
    k *= nightK(src);   // a lamp that is off by day has its stand-in off too
    if (g.k === k) return;
    g.k = k; g.m[g.key] = g.base * k;
  };
  function score(src, focus) {
    const lit = litOf(src);
    if (!(lit > 0) || !(src.priority > 0)) return 0;
    const r = src.distance > 0 ? src.distance : 10;
    const s = src.priority * lit / (1 + worldPos(src, tmp).distanceToSquared(focus) / (r * r));
    return src.slot && src.slot.w > 0 ? s * BONUS : s;
  }
  // a slot that has faded its source out lets it go: the source is free for any group again and its stand-in shows fully
  function release(slot) {
    const src = slot.src;
    slot.src = null; slot.want = 0; slot.light.intensity = 0;
    if (slot.group.shadow) slot.light.shadow.autoUpdate = false;   // dark: its shadow map is not rendered again until a source takes it
    if (src) { src.slot = null; if (!src.removed) setGlow(src, 1); }
  }

  /** Pick the best sources for each group (shadow points first, then plain points, then spots) and hand free slots to the winners */
  function assign() {
    const f = api.focus ?? e.camera;
    if (f.isObject3D) f.getWorldPosition(at); else vec3(f, at);   // fresh (not last frame's matrix): the camera may have just moved
    for (const s of sources) { s.score = score(s, at); if (!s.slot && s.dusk !== null) setGlow(s, 1); }   // an unlit lamp's stand-in follows daylight
    const taken = new Set();
    for (const g of groups) {
      // a source fading out of another group's slot waits until it is released, so it never holds two lights
      const pick = sources.filter(s => s.score > 0 && !taken.has(s) && g.fits(s) && (!s.slot || s.slot.group === g))
        .sort((a, b) => b.score - a.score).slice(0, g.slots.length);
      const chosen = new Set(pick);
      for (const s of pick) taken.add(s);
      for (const slot of g.slots) slot.want = slot.src && chosen.has(slot.src) ? 1 : 0;
      const waiting = pick.filter(s => !s.slot);
      for (const slot of g.slots) {
        if (!waiting.length) break;
        if (slot.src && (slot.want || slot.w > 0)) continue;   // kept by its source, or still fading the old one out: next time
        if (slot.src) release(slot);
        const s = waiting.shift();
        slot.src = s; slot.want = 1; s.slot = slot;
        if (g.shadow) { slot.light.shadow.autoUpdate = true; slot.light.shadow.needsUpdate = true; }   // lit again: render its shadow map every frame
      }
    }
  }

  /** Per frame, only for the N slots: fade, follow, flicker, drive the stand-in */
  function update(dt) {
    const step = fade > 0 ? dt / fade : 1;
    for (const g of groups) for (const slot of g.slots) {
      const src = slot.src;
      if (!src) continue;
      slot.w = slot.want ? Math.min(1, slot.w + step) : Math.max(0, slot.w - step);
      if (slot.w === 0 && !slot.want) { release(slot); continue; }
      const L = slot.light;
      if (src.follow) src.follow.getWorldPosition(L.position); else L.position.copy(src.pos);   // fresh for the few lit ones: a muzzle flash must not lag a frame
      L.color.copy(src.color); L.distance = src.distance; L.decay = src.decay;
      const fl = src.flicker ? src.flicker(time, src.index) : 1;
      L.intensity = litOf(src) * slot.w * fl;
      if (L.isSpotLight) {
        L.angle = src.angle; L.penumbra = src.penumbra;
        if (src.target?.isObject3D) L.target.position.setFromMatrixPosition(src.target.matrixWorld);
        else if (src.target) vec3(src.target, L.target.position);
        else L.target.position.copy(L.position).y -= 1;   // no target: straight down (a ceiling lamp)
        L.target.updateMatrixWorld();
      }
      if (!src.removed) setGlow(src, slot.w === 1 ? 0 : 1 - slot.w);   // a removed source's stand-in was put back by remove()
    }
  }

  function apply(src, o) {
    if ('color' in o) src.color.set(o.color);
    for (const k of ['intensity', 'distance', 'decay', 'priority', 'angle', 'penumbra', 'flicker', 'target', 'name']) if (k in o) src[k] = o[k];
    if ('dusk' in o) {
      const d = o.dusk === true ? DUSK : o.dusk === false || o.dusk == null ? null : o.dusk;
      if (d !== null && !(typeof d === 'number' && d >= 0 && d <= 1)) throw codedError('lightpool-dusk', STRINGS.dusk.replace('{d}', String(DUSK)) + JSON.stringify(o.dusk), TypeError);
      src.dusk = d;
    }
    if ('glow' in o) { if (src.glow) setGlow(src, 1); src.glow = glowOf(o.glow); setGlow(src, src.slot ? 1 - src.slot.w : 1); }
    timer = Infinity;   // a changed source is reconsidered on the next frame, not after `every`
  }

  const api = {
    /** The real lights, created once at install: plain three.js lights in the scene (read them; the pool sets their position, color and intensity) */
    lights: /** @type {any[]} */ ([]),
    /** Distance is measured from this Object3D / position; null (default) = the camera */
    focus: opts.focus ?? null,
    /** Register a light source at a position (Object3D: it follows that object) and return its handle { set(patch), remove(), light, weight } */
    add(position, o = {}) {
      readParams('lightPool.add()', keysSchema(ADD_KEYS), o);
      const type = o.type ?? 'point';
      if (type !== 'point' && type !== 'spot') throw codedError('light-type', STRINGS.type + JSON.stringify(type), TypeError);
      if (!groups.some(g => g.type === type)) throw codedError('light-type', STRINGS.noSlot.replaceAll('{type}', type), TypeError);
      const src = { index: seq++, type, castShadow: !!o.castShadow, follow: position?.isObject3D ? position : null, pos: position?.isObject3D ? null : vec3(position),
        color: new THREE.Color(0xffffff), intensity: 1, distance: 10, decay: 2, priority: 1, angle: Math.PI / 4, penumbra: 0.3, target: null, flicker: null, name: null,
        glow: null, dusk: null, slot: null, score: 0, removed: false };
      apply(src, o);
      sources.push(src);
      const h = {
        /** The real light lighting this source now (null while it has none) */
        get light() { return src.slot?.light ?? null; },
        /** How much of its light it has, 0-1 (fades when lights move between sources) */
        get weight() { return src.slot?.w ?? 0; },
        /** Change the source: { position, color, intensity, distance, decay, priority, angle, penumbra, target, flicker, glow, name } */
        set(patch) {
          readParams('lightPool.add().set()', keysSchema(SET_KEYS), patch);
          if ('position' in patch) { const p = patch.position; src.follow = p?.isObject3D ? p : null; src.pos = p?.isObject3D ? null : vec3(p); }
          apply(src, patch);
          return h;
        },
        /** Unregister: its light fades out and goes to another source; the stand-in is put back as it was (safe to call twice) */
        remove() {
          if (src.removed) return;
          src.removed = true;
          const i = sources.indexOf(src); if (i >= 0) sources.splice(i, 1);
          if (src.slot) src.slot.want = 0;
          if (src.glow) { src.glow.m[src.glow.key] = src.glow.base; src.glow.k = -1; }
          timer = Infinity;
        },
      };
      return h;
    },
    /** How the pool is used now: lights per kind, how many are lighting something, and which source each holds */
    usage() {
      const out = { sources: sources.length, lit: 0, slots: [] };
      for (const g of groups) for (const s of g.slots) {
        if (s.src && s.w > 0) out.lit++;
        out.slots.push({ type: g.type, shadow: g.shadow, source: s.src ? (s.src.name ?? s.src.index) : null, weight: Math.round(s.w * 100) / 100 });
      }
      return out;
    },
  };

  function makeGroup(type, shadow, n) {
    if (n <= 0) return;
    const allShadow = shadow && n >= point;   // no plain point lights: the shadow ones also take non-casting sources, so those never stay dark
    const g = { type, shadow, slots: [], fits: type === 'spot' ? s => s.type === 'spot' : shadow && !allShadow ? s => s.type === 'point' && s.castShadow : s => s.type === 'point' };
    for (let i = 0; i < n; i++) {
      const L = type === 'spot' ? new THREE.SpotLight(0xffffff, 0) : new THREE.PointLight(0xffffff, 0);
      L.name = `lightPool_${type}${shadow ? '_shadow' : ''}_${i}`;
      L.userData.fixedCount = true;   // the light-count warning (core/lightWatch.js) leaves pooled lights out: their number never grows
      L.castShadow = shadow;   // fixed at creation: a shadow count that changes recompiles too
      if (shadow) L.shadow.autoUpdate = false;   // no source yet: no shadow passes
      e.scene.add(engineOwned('lightPool', L));
      if (L.isSpotLight) e.scene.add(engineOwned('lightPool', L.target));
      api.lights.push(L);
      g.slots.push({ light: L, group: g, src: null, w: 0, want: 0 });
    }
    groups.push(g);
  }

  return {
    name: 'lightPool', type: 'picture', params: LIGHT_POOL_PARAMS, options: opts, label: 'Light pool', stage: 'late',
    install(engine) { engine.i18n.add({ 'zh-CN': { 'module.lightPool': '光源池' }, en: { 'module.lightPool': 'light pool' } });
      e = engine;
      const k = Math.max(0, Math.min(shadows, point));
      if (k > 0 && k >= point) warnOnce(STRINGS.allShadow.replace('{n}', String(point)).replace('{m}', String(k + 2)).replaceAll('{k}', String(k)));
      makeGroup('point', true, k);
      makeGroup('point', false, point - k);
      makeGroup('spot', false, spot);
      if (e.ready) warnOnce(STRINGS.late);
      offCut = e.events.on('camera:shot', () => { cut = true; });
      return api;
    },
    frame(dt) {
      time += dt;   // presentation seconds for flicker: keeps running while gameplay is frozen, like the picture
      daylight = daylightOf(e);
      if (daylight === null && sources.some(s => s.dusk !== null)) warnOnce(coded('lightpool-dusk', STRINGS.noDay));
      // a camera cut (a view, a fixed shot): no fade, the picture is new anyway. Twice: the first pass frees the slots of sources left behind, the
      // second hands them over. Without it `shot --view` drew the lamps of the old spot, 1/30 s after the cut and 0.3 s before any fade would end
      if (cut) { cut = false; timer = 0; for (let i = 0; i < 2; i++) { assign(); update(fade); } return; }
      if ((timer += dt) >= every) { timer = 0; assign(); }
      update(dt);
    },
    dispose() { offCut?.remove(); for (const L of api.lights) { L.removeFromParent(); L.target?.removeFromParent(); L.dispose(); } },
    describe() {
      const u = api.usage();
      return { lights: api.lights.length, lit: u.lit, sources: u.sources, shadows: Math.max(0, Math.min(shadows, point)) };
    },
  };
}

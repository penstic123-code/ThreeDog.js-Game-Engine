// The real lights: groups of slots, each slot one three.js light, and how sources are chosen for them. pool is the state lightPool() shares with sources.js.
import { engineOwned } from '../../core/scene/things.js';
import * as THREE from 'three';
import { vec3 } from '../../core/base/math.js';
import { litOf, setGlow } from './sources.js';

const BONUS = 1.25;   // score bonus for a source that already holds a light (hysteresis)

const worldPos = (src, out) => src.follow ? out.setFromMatrixPosition(src.follow.matrixWorld) : out.copy(src.pos);

function score(pool, src, focus) {
  const lit = litOf(pool, src);
  if (!(lit > 0) || !(src.priority > 0)) return 0;
  const r = src.distance > 0 ? src.distance : 10;
  const s = src.priority * lit / (1 + worldPos(src, pool.tmp).distanceToSquared(focus) / (r * r));
  return src.slot && src.slot.w > 0 ? s * BONUS : s;
}

// a slot that has faded its source out lets it go: the source is free for any group again and its stand-in shows fully
function release(pool, slot) {
  const src = slot.src;
  slot.src = null; slot.want = 0; slot.light.intensity = 0;
  if (slot.group.shadow) slot.light.shadow.autoUpdate = false;   // dark: its shadow map is not rendered again until a source takes it
  if (src) { src.slot = null; if (!src.removed) setGlow(pool, src, 1); }
}

/** Pick the best sources for each group (shadow points first, then plain points, then spots) and hand free slots to the winners */
export function assign(pool) {
  const { sources, groups, at } = pool, f = pool.api.focus ?? pool.e.camera;
  if (f.isObject3D) f.getWorldPosition(at); else vec3(f, at);   // fresh (not last frame's matrix): the camera may have just moved
  for (const s of sources) { s.score = score(pool, s, at); if (!s.slot && s.dusk !== null) setGlow(pool, s, 1); }   // an unlit lamp's stand-in follows daylight
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
      if (slot.src) release(pool, slot);
      const s = waiting.shift();
      slot.src = s; slot.want = 1; s.slot = slot;
      if (g.shadow) { slot.light.shadow.autoUpdate = true; slot.light.shadow.needsUpdate = true; }   // lit again: render its shadow map every frame
    }
  }
}

/** Per frame, only for the N slots: fade, follow, flicker, drive the stand-in */
export function update(pool, dt) {
  const step = pool.fade > 0 ? dt / pool.fade : 1;
  for (const g of pool.groups) for (const slot of g.slots) {
    const src = slot.src;
    if (!src) continue;
    slot.w = slot.want ? Math.min(1, slot.w + step) : Math.max(0, slot.w - step);
    if (slot.w === 0 && !slot.want) { release(pool, slot); continue; }
    const L = slot.light;
    if (src.follow) src.follow.getWorldPosition(L.position); else L.position.copy(src.pos);   // fresh for the few lit ones: a muzzle flash must not lag a frame
    L.color.copy(src.color); L.distance = src.distance; L.decay = src.decay;
    const fl = src.flicker ? src.flicker(pool.time, src.index) : 1;
    L.intensity = litOf(pool, src) * slot.w * fl;
    if (L.isSpotLight) {
      L.angle = src.angle; L.penumbra = src.penumbra;
      if (src.target?.isObject3D) L.target.position.setFromMatrixPosition(src.target.matrixWorld);
      else if (src.target) vec3(src.target, L.target.position);
      else L.target.position.copy(L.position).y -= 1;   // no target: straight down (a ceiling lamp)
      L.target.updateMatrixWorld();
    }
    if (!src.removed) setGlow(pool, src, slot.w === 1 ? 0 : 1 - slot.w);   // a removed source's stand-in was put back by remove()
  }
}

/** Create one group's real lights (install): they exist from here on, so the startup compile covers them */
export function makeGroup(pool, type, shadow, n) {
  if (n <= 0) return;
  const allShadow = shadow && n >= pool.point;   // no plain point lights: the shadow ones also take non-casting sources, so those never stay dark
  const g = { type, shadow, slots: [], fits: type === 'spot' ? s => s.type === 'spot' : shadow && !allShadow ? s => s.type === 'point' && s.castShadow : s => s.type === 'point' };
  for (let i = 0; i < n; i++) {
    const L = type === 'spot' ? new THREE.SpotLight(0xffffff, 0) : new THREE.PointLight(0xffffff, 0);
    L.name = `lightPool_${type}${shadow ? '_shadow' : ''}_${i}`;
    L.userData.fixedCount = true;   // the light-count warning (core/inspect/lightWatch.js) leaves pooled lights out: their number never grows
    L.castShadow = shadow;   // fixed at creation: a shadow count that changes recompiles too
    if (shadow) L.shadow.autoUpdate = false;   // no source yet: no shadow passes
    pool.e.scene.add(engineOwned('lightPool', L));
    if (L.isSpotLight) pool.e.scene.add(engineOwned('lightPool', L.target));
    pool.api.lights.push(L);
    g.slots.push({ light: L, group: g, src: null, w: 0, want: 0 });
  }
  pool.groups.push(g);
}

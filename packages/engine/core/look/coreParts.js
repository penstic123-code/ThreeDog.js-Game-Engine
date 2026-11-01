// look.tone, lights, clouds.
// look.tone = renderer tone mapping and exposure, look.lights = the engine's placeholder sun + hemisphere, look.cloudShadow = the cloud-shadow patch.
// Why here and not in sceneMethods: the 0.2 renames (recipe 52) now write the 'game' layer, and the style values
// are the 'style' layer, so describe().look / describe().render can say who set a value instead of guessing from start values.
import * as THREE from 'three';
import { defineLookPart } from './part.js';

/** style.toneMapping names -> three constants */
export const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, none: THREE.NoToneMapping };
const toneName = v => Object.keys(TONE).find(k => TONE[k] === v) ?? String(v);

/**
 * Exposure over the day: [[time 0-1, exposure], ...] sorted by time, wrapping across midnight (after the last row it blends back to the first),
 * or (sky) => number. Returns the per-frame function, null for a plain number (set once); throws on anything else
 */
export function exposureDriver(v) {
  if (typeof v === 'number') return null;
  if (typeof v === 'function') return v;
  const ok = Array.isArray(v) && v.length > 0 && v.every((k, i) => Array.isArray(k) && typeof k[0] === 'number' && typeof k[1] === 'number' && k[0] >= 0 && k[0] <= 1 && (i === 0 || k[0] > v[i - 1][0]));
  if (!ok) throw new Error(`exposure must be a number, [[time 0-1, exposure], ...] sorted by time (e.g. [[0, 1.6], [0.5, 1], [0.8, 1.3]]) or (sky) => number; got ${JSON.stringify(v)}`);
  return sky => {
    const t = sky.timeOfDay, n = v.length;
    let i = -1; for (let k = 0; k < n; k++) if (v[k][0] <= t) i = k;
    const a = v[i < 0 ? n - 1 : i], b = v[(i + 1) % n];   // before the first row or after the last: the segment across midnight
    const span = (b[0] - a[0] + 1) % 1 || 1, f = ((t - a[0] + 1) % 1) / span;
    return a[1] + (b[1] - a[1]) * f;
  };
}
const badExposure = v => { try { exposureDriver(v); return null; } catch (err) { return err.message; } };

/**
 * Register look.tone and look.lights. owned: false when the game passed its own renderer: then the style's tone values are not applied at start
 * (the renderer is the game's), but a later look.tone.set still writes it.
 * @param {any} e @param {{ owned: boolean }} o
 */
export function defineCoreLook(e, { owned }) {
  const r = e.renderer;
  defineLookPart(e, {
    id: 'tone', group: 'atmosphere', module: 'core', object: () => e.renderer, applyAtStart: owned, docs: ['recipes/52-look.md'],
    params: {
      mapping: { type: 'string', values: Object.keys(TONE), default: 'none', neutral: true, cost: 'recompile', desc: 'tone mapping curve; changing it recompiles each material once' },
      exposure: { type: 'any', default: 1, neutral: true, cost: 'uniform', check: badExposure, desc: 'a number, day keyframes [[time 0-1, exposure], ...] or (sky) => number (a time-of-day module evaluates it each frame)' },
    },
    style: () => (owned ? { mapping: e.style.toneMapping, exposure: e.style.exposure } : {}),
    read: () => ({ mapping: toneName(r.toneMapping), exposure: e.exposureDriver ? undefined : r.toneMappingExposure }),
    apply(v, changed) {
      if (changed.has('mapping')) r.toneMapping = TONE[v.mapping];   // three recompiles each material on its next draw (tone mapping is part of its program)
      if (changed.has('exposure')) {
        // keyframes / a function become exposureDriver, which a time-of-day module (sky) evaluates each frame; core knows no time of day
        e.exposureDriver = exposureDriver(v.exposure);
        if (typeof v.exposure === 'number') r.toneMappingExposure = v.exposure;
      }
    },
    noPatch: "custom tone curves (three's CustomToneMapping) are not offered yet; pick a curve with look.tone.set({ mapping: 'aces' })",
    noReplace: 'to own tone mapping completely, pass your own renderer: createEngine({ renderer }) (recipes/50)',
  });

  const { sun, hemi } = e.lights;
  const off = "look.lights.set({ sun: { intensity: 0 } }) (or hemi), or createEngine({ lights: false }) and light the world with your own three.js lights";
  const why = 'placeholder light so a scene without a sky module (and the gray placeholders) is never black; an installed sky drives it from style.sky.keyframes instead';
  defineLookPart(e, {
    id: 'lights', group: 'atmosphere', module: 'core', object: () => e.lights, docs: ['recipes/52-look.md'],
    params: {
      'sun.intensity': { type: 'number', default: 2, min: 0, cost: 'uniform', why, off },
      'sun.color': { type: 'any', default: '#ffffff', neutral: true, cost: 'uniform', desc: 'any THREE.Color input' },
      'hemi.intensity': { type: 'number', default: 1.2, min: 0, cost: 'uniform', why, off },
      'hemi.color': { type: 'any', default: '#ffffff', neutral: true, cost: 'uniform', desc: 'sky color of the hemisphere light' },
      'hemi.ground': { type: 'any', default: '#555555', cost: 'uniform', why: 'darker ground color, so faces turned down read darker than faces turned up', off: "look.lights.set({ hemi: { ground: '#ffffff' } })" },
    },
    read: () => ({ 'sun.intensity': sun.intensity, 'hemi.intensity': hemi.intensity }),
    apply(v, changed) {
      // undefined = a style driver (sky) writes this key every frame: leave it to the driver
      const set = (k, fn) => { if (changed.has(k) && v[k] !== undefined) fn(v[k]); };
      set('sun.intensity', x => { sun.intensity = x; });
      set('sun.color', x => sun.color.set(x));
      set('hemi.intensity', x => { hemi.intensity = x; });
      set('hemi.color', x => hemi.color.set(x));
      set('hemi.ground', x => hemi.groundColor.set(x));
    },
    noPatch: 'lights have no shader of their own; how surfaces take light is look.surface (lighting / ramp)',
    noReplace: "to light the world yourself, turn the engine lights off: createEngine({ lights: false }), or sky({ sun: 'manual' | false })",
  });
}

/**
 * look.cloudShadow: drifting cloud shadows on the ground and on every material from makeMaterial / applyEffects. The patch is on by default (clouds: true)
 * so the style and the weather can darken it later without a recompile; how dark comes from style.clouds.shadow, 0 (nothing drawn) without one.
 * Declared as a part so this default is visible in describe().look and the catalog instead of hiding in applyEffects.
 * @param {any} e
 */
export function defineCloudShadowLook(e) {
  const u = e.uniforms, c = e.style.clouds ?? {};
  defineLookPart(e, {
    id: 'cloudShadow', group: 'surface', module: 'core', object: () => u, docs: ['recipes/52-look.md'],
    params: {
      shadow: { type: 'number', default: 0, min: 0, max: 1, cost: 'uniform', desc: 'darkest cloud shadow (uCloudShadow)',
        why: 'every engine material carries the cloud-shadow patch (applyEffects clouds: true) so a style or the weather can darken it with no recompile; at 0 it draws nothing',
        off: 'look.cloudShadow.set({ shadow: 0 }); to leave the patch out of one material: applyEffects(mat, { clouds: false })' },
      scale: { type: 'number', default: 0.006, min: 0, neutral: true, cost: 'uniform', desc: 'cloud size (smaller = bigger clouds)' },
      speed: { type: 'array', default: [0.012, 0.006], neutral: true, cost: 'uniform', desc: 'drift [x, z] per second' },
    },
    style: () => ({ shadow: c.shadow, scale: c.scale, speed: c.speed }),
    read: () => ({ shadow: u.uCloudShadow.value, scale: u.uCloudScale.value }),
    apply(v, changed) {
      if (changed.has('shadow')) u.uCloudShadow.value = v.shadow;
      if (changed.has('scale')) u.uCloudScale.value = v.scale;
      if (changed.has('speed')) u.uCloudSpeed.value.set(v.speed[0], v.speed[1]);
    },
    noPatch: 'the cloud-shadow GLSL is shared with the sky clouds; change the look with look.cloudShadow.set({ shadow, scale, speed })',
    noReplace: 'to drop cloud shadows from a material, build it with applyEffects(mat, { clouds: false })',
  });
}
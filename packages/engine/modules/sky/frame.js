// Sky per-frame work (helper of Sky.js): dome colors, sun / moon light, ambient, fog and the shadow center from the time of day and
// the modifier layers; plus the dev guard that warns when a game edits what this overwrites every frame.
import { ownedProps } from '../../core/validate.js';
import { applySeason } from './calendar.js';
import { applyCover } from './layers.js';
import { updateFog } from './fog.js';
import { cascadeFrame } from './cascades.js';

// Developer message: how to fix when a per-frame recomputed property (ownedProps) is edited directly
const STRINGS = {
  sun: "use engine.sky.modify('layerName', { sun })",
  sunColor: "edit style pack sky.keyframes or use engine.sky.modify('layerName', { tint, tintAmount })",
  sunPos: 'sun position is driven by sky.timeOfDay',
  hemi: "use engine.sky.modify('layerName', { ambient })",
  fog: "use look.fog.set({ color, density, far }), engine.sky.modify('layerName', { fog }) or engine.setFogFar(); to own scene.fog, create the sky with sky({ fog: 'manual' }) (or false)",
  modifiers: "sky.modifiers is the composite of all layers; use engine.sky.modify('layerName', { sun, ambient, fog, ... })",
};

/** Watchers of the properties sky rewrites every frame (validate.js ownedProps) */
export function watchOwned(sky) {
  const scene = sky.engine.scene, fog = () => scene.fog;
  // only what the sky writes: a light in 'manual' or false mode (look.js) is the game's to edit
  const D = sky._drive;
  return [
    D.sun === true && ownedProps('sky.sun.intensity', () => sky.sun.intensity, STRINGS.sun),
    D.sun === true && ownedProps('sky.sun.color', () => sky.sun.color.toArray(), STRINGS.sunColor),
    D.sun !== false && ownedProps('sky.sun.position', () => sky.sun.position.toArray(), STRINGS.sunPos),
    D.hemi === true && ownedProps('sky.hemi', () => [sky.hemi.intensity, ...sky.hemi.color.toArray(), ...sky.hemi.groundColor.toArray()], STRINGS.hemi),
    // fog: the object itself, color, near/far ratio (engine.setFogFar keeps the ratio, so it is not a violation)
    D.fog === true && ownedProps('scene.fog', () => sky._fogHeld ? [null] : [fog(), ...(fog()?.color?.toArray() ?? []), fog()?.near / fog()?.far], STRINGS.fog),
    ownedProps('sky.modifiers', () => { const M = sky.modifiers; return [M.sun, M.ambient, M.fog, M.tintAmount, M.horizonTintAmount, M.flash, ...M.tint.toArray()]; }, STRINGS.modifiers),
  ].filter(Boolean);
}

/** Recompute dome, lights, fog and shadow placement for this frame */
export function updateSky(sky, focus) {
  applySeason(sky, sky.engine.uniforms);
  const t = sky.timeOfDay, kf = sky.kf;
  let i = 0; while (i < kf.length - 2 && t > kf[i + 1][0]) i++;
  const a = kf[i], b = kf[i + 1], f = (t - a[0]) / (b[0] - a[0]);
  const u = sky.uniforms, scene = sky.engine.scene;
  u.uTop.value.copy(a[1]).lerp(b[1], f);
  u.uHorizon.value.copy(a[2]).lerp(b[2], f);
  for (const o of sky._owned) o.check();
  sky._combine();
  applyCover(sky, sky.engine.uniforms);   // after the season: snow / ash cover lies over the season tint
  const M = sky.modifiers;
  if (M.tintAmount) u.uTop.value.lerp(M.tint, M.tintAmount);
  if (M.horizonTintAmount) u.uHorizon.value.lerp(M.tint, M.horizonTintAmount);
  if (M.flash) { u.uTop.value.addScalar(M.flash * 0.4); u.uHorizon.value.addScalar(M.flash * 0.3); }
  const bd = sky._backdrop;   // style.sky.backdrop (look.js): a flat background in place of the dome, fog follows it
  if (bd) { if (bd.fn) bd.color.set(bd.fn(sky)); sky.dome.visible = false; scene.background = bd.color; }
  updateFog(sky, bd ? bd.color : u.uHorizon.value, M);
  u.uSunColor.value.copy(a[3]).lerp(b[3], f);   // the dome's sun disk follows the keyframes whatever drives the light
  if (sky._drive.sun === true) sky.sun.color.copy(u.uSunColor.value);
  const sunI = a[4] + (b[4] - a[4]) * f, hemiI = a[5] + (b[5] - a[5]) * f;

  const ang = (t - 0.25) * Math.PI * 2, elev = Math.sin(ang);
  sky.sunDir.set(Math.cos(ang) * sky.orbit.sway, elev, sky.orbit.tilt).normalize();
  u.uSunDir.value.copy(sky.sunDir);
  u.uNight.value = Math.min(1, Math.max(0, -elev * 4));
  const lightDir = elev >= 0 ? sky.sunDir : sky._lightDir.copy(sky.sunDir).negate().setZ(sky.orbit.tilt).normalize();
  if (sky._drive.sun === true) sky.sun.intensity = sunI * Math.min(1, Math.abs(elev) * 7) * M.sun;   // fade out near the horizon so day/night switching does not pop
  if (sky._drive.hemi === true) {
    sky.hemi.intensity = hemiI * M.ambient + M.flash * 3;
    sky.hemi.color.copy(u.uTop.value).lerp(u.uHorizon.value, 0.5);
    sky.hemi.groundColor.copy(sky.groundTint).multiplyScalar(0.4 + 0.6 * Math.min(1, hemiI));
  }
  sky.engine.look.lights.applyTop();   // a game look.lights.set({ sun: { intensity } }) wins over the keyframes (look/part.js)
  const ex = sky.engine.exposureDriver;
  if (ex) sky.engine.renderer.toneMappingExposure = ex(sky);   // style.exposure keyframes / function (engine.look.tone.set)

  if (sky.skybox) sky.engine.scene.backgroundIntensity = Math.max(0.05, hemiI * M.ambient / 1.2);
  if (sky.csm) cascadeFrame(sky, lightDir);   // cascades place their own lights from the camera (cascades.js)
  else if (sky._drive.sun !== false) sky._placeShadow(focus, lightDir);
  for (const o of sky._owned) o.mark();
}

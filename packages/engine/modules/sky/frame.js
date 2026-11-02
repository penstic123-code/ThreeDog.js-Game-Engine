// Sky per-frame work (helper of Sky.js): dome colors, sun / moon light, ambient, fog and the shadow center from the time of day and
// the modifier layers; plus the dev guard that warns when a game edits what this overwrites every frame.
import { defineOwned } from '../../core/owned.js';
import { applySeason } from './season.js';
import { applyCover } from './layers.js';
import { updateFog, fogBand, fogMaterials } from './fog.js';
import { cascadeFrame } from './cascades.js';
import { fillContext, live } from '../../core/look/state.js';
import { roomShare, ROOM_RADIANCE } from '../../render/lights.js';

/**
 * Brightness of the sky's ambient light for one sky color pair: ambient intensity x the luminance of the hemi color (top / horizon halfway,
 * linear colors, so the mean of their luminances). One measure for the keyframe peak (Sky.js) and the frame (updateSky).
 * @param {import('three').Color} top @param {import('three').Color} horizon @param {number} ambient
 */
export const skyLight = (top, horizon, ambient) => ambient * (lum(top) + lum(horizon)) / 2;
const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// The copyable takeover calls each owned property's warning quotes (core/owned.js): the engine yields to a direct write, these say it explicitly
const L = {
  sun: { manual: "engine.look.lights.manual('sun')", set: "engine.look.lights.set({ sun: { intensity: 2 } })" },
  sunColor: { manual: "engine.look.lights.manual('sun.color')", set: "engine.look.lights.set({ sun: { color: '#ffd9a0' } })" },
  sunDir: { manual: "engine.look.lights.manual('sun.direction')" },
  hemi: { manual: "engine.look.lights.manual('hemi')", set: "engine.look.lights.set({ hemi: { intensity: 0.8 } })" },
  fog: { manual: 'engine.look.fog.manual()', set: "engine.look.fog.set({ color: '#cfd8e0', far: 300 })" },
  exposure: { manual: "engine.look.tone.manual('exposure')", set: 'engine.look.tone.set({ exposure: 1.2 })' },
  background: { manual: "engine.look.sky.manual('background')", replace: 'engine.look.sky.replace(null)' },
  modifiers: { manual: "engine.look.sky.manual('modifiers')", set: "engine.mod('sky.sunLight', { owner: 'cave', mul: 0.3 })" },
  follow: { manual: "engine.look.shadow.manual('follow')", set: 'engine.look.shadow.set({ follow: false })' },
};

/**
 * Register what the sky writes every frame (core/owned.js). Everything starts engine-written; the one way to take a value over is
 * look.<part>.manual(key) (or a direct write, which the sky yields to). Lights in false mode are hidden and not registered.
 */
export function watchOwned(sky) {
  const e = sky.engine, scene = e.scene, fog = () => scene.fog, D = sky._drive, sun = sky._sun, hemi = sky._hemi;
  const own = (id, part, key, read, levels, objects) => defineOwned(e, { id, part, key, read, levels, objects });
  const list = [];
  if (D.sun !== false) {
    sky._oSunI = own('sun.intensity', 'lights', 'sun.intensity', () => sun.intensity, L.sun, [sun]);
    sky._oSunC = own('sun.color', 'lights', 'sun.color', () => sun.color.toArray(), L.sunColor, [sun, sun.color]);
    // the direction is where the sun sits relative to its target; the shadow box still follows the focus when the game owns the direction (shadow.js)
    sky._oSunDir = own('sun.direction', 'lights', 'sun.direction', () => { const p = sun.position, t = sun.target.position; return [p.x - t.x, p.y - t.y, p.z - t.z]; }, L.sunDir, [sun, sun.position]);
    sky._oFollow = own('shadow.follow', 'shadow', 'follow', () => sun.target.position.toArray(), L.follow, [sun.target, sun.target.position]);
    list.push(sky._oSunI, sky._oSunC, sky._oSunDir, sky._oFollow);
  }
  if (D.hemi !== false) list.push(sky._oHemi = own('hemi', 'lights', 'hemi', () => [hemi.intensity, ...hemi.color.toArray(), ...hemi.groundColor.toArray()], L.hemi, [hemi, hemi.color, hemi.groundColor]));
  // fog: the object itself, color, near and far (the values, not their ratio: a game writing far 50 / near 15 is an outside write too; the engine
  // only writes near / far inside updateFog, between check and mark, so its own writes never look like the game's).
  // look.fog.replace(fog) puts this entry in manual mode itself (lookFog.js), so "who writes scene.fog" has one record, not a second flag
  if (D.fog !== false) list.push(sky._oFog = own('fog', 'fog', 'fog', () => [fog(), ...(fog()?.color?.toArray() ?? []), fog()?.near, fog()?.far, fog()?.density], L.fog,
    [scene, ...(fog() ? [fog(), fog().color] : [])]));
  list.push(sky._oExposure = own('exposure', 'tone', 'exposure', () => e.renderer.toneMappingExposure, L.exposure, [e.renderer]));
  // background: the sky writes it with a backdrop / skybox; with the dome it draws over whatever scene.background holds, so a game that sets one
  // takes it, and the dome hides (onChange) so the game's background shows; handing it back shows the dome again
  list.push(sky._oBg = own('background', 'sky', 'background', () => [scene.background, scene.backgroundIntensity], L.background, [scene]));
  sky._oBg._onChange = o => { if (!sky._backdrop && !sky.skybox && !sky._ownSky) sky.dome.visible = o.on; };   // a replaced sky keeps the dome hidden
  list.push(sky._oMods = own('sky.modifiers', 'sky', 'modifiers', () => { const M = sky.modifiers; return [M.sun, M.ambient, M.fog, M.tintAmount, M.horizonTintAmount, M.flash, ...M.tint.toArray()]; }, L.modifiers, [sky.modifiers]));
  return list;
}

/** Recompute dome, lights, fog and shadow placement for this frame */
export function updateSky(sky, focus) {
  applySeason(sky, sky.engine.uniforms);
  // the contract's inputs, once per frame: every function-valued look key below reads this one object (core/look/state.js)
  const ctx = fillContext(sky.engine, sky, sky.engine.weather?.name, sky.engine.calendar), P = sky.engine.look.sky;
  const t = sky.drawnTime, kf = sky.kf;
  let i = 0; while (i < kf.length - 2 && t > kf[i + 1][0]) i++;
  const a = kf[i], b = kf[i + 1], f = (t - a[0]) / (b[0] - a[0]);
  const u = sky.uniforms, scene = sky.engine.scene;
  u.uTop.value.copy(a[1]).lerp(b[1], f);
  u.uHorizon.value.copy(a[2]).lerp(b[2], f);
  // look.sky top / horizon: a color or a function over the keyframes (null = keyframes); fog 'horizon', hemi color and the dome all follow
  const top = P.value('top'), hor = P.value('horizon');
  if (top != null) u.uTop.value.set(live(top, ctx));
  if (hor != null) u.uHorizon.value.set(live(hor, ctx));
  for (const o of sky._owned) if (o !== sky._oExposure || sky.engine.exposureDriver) o.check();   // exposure is engine-written only with a driver
  if (sky._oMods.on) sky._combine();
  applyCover(sky, sky.engine.uniforms);   // after the season: snow / ash cover lies over the season tint
  const M = sky.modifiers, hemiI = a[5] + (b[5] - a[5]) * f;
  // the sky's light now, 0-1 of its brightest keyframe row, read before any tint. Why: a sky.tint color (weather grey, a cave tint) is the color
  // under that brightest sky; lerping toward it as a fixed color turned a rainy night into a lit grey (#0d1628 -> #6b6b6d, R3). Dimmed by the
  // sky's own light it stays dark at night and is unchanged at the brightest row
  const light = sky._lightPeak > 0 ? Math.min(1, skyLight(u.uTop.value, u.uHorizon.value, hemiI) / sky._lightPeak) : 1;
  if (M.tintAmount || M.horizonTintAmount) {
    const tint = sky._tintLit.copy(M.tint).multiplyScalar(light);
    if (M.tintAmount) u.uTop.value.lerp(tint, M.tintAmount);
    if (M.horizonTintAmount) u.uHorizon.value.lerp(tint, M.horizonTintAmount);
  }
  if (M.flash) { u.uTop.value.addScalar(M.flash * 0.4); u.uHorizon.value.addScalar(M.flash * 0.3); }
  const bd = sky._backdrop;   // style.sky.backdrop (look.js): a flat background in place of the dome, fog follows it
  if (bd && sky._oBg.on) { if (bd.fn) bd.color.set(bd.fn(ctx)); sky.dome.visible = false; scene.background = bd.color; }
  updateFog(sky, bd ? bd.color : u.uHorizon.value, M, ctx);
  fogMaterials(sky);   // the 'fog' patch onto materials added since the last scene change (nothing while three's own fog draws it)
  u.uFogBand.value = fogBand(scene.fog, u.uHorizon.value);   // compared to the dome's horizon (not the backdrop): the band is drawn on the dome
  u.uSunColor.value.copy(a[3]).lerp(b[3], f);   // the dome's sun disk follows the keyframes whatever drives the light
  if (sky._oSunC?.on) sky._sun.color.copy(u.uSunColor.value);
  const sunI = a[4] + (b[4] - a[4]) * f;

  const ang = (t - 0.25) * Math.PI * 2, elev = Math.sin(ang);
  sky.sunDir.set(Math.cos(ang) * sky.orbit.sway, elev, sky.orbit.tilt).normalize();
  u.uSunDir.value.copy(sky.sunDir);
  // the contract's shared outputs: engine.uniforms is what a game's own sky / water / shader reads (a replaced dome keeps getting
  // these); uSunDir is the dome's own object (shader.js), so the copy above already wrote it
  const EU = sky.engine.uniforms;
  EU.uDaylight.value = Math.max(0, elev); EU.uTimeOfDay.value = t;
  u.uNight.value = Math.min(1, Math.max(0, -elev * 4));
  const lightDir = elev >= 0 ? sky.sunDir : sky._lightDir.copy(sky.sunDir).negate().setZ(sky.orbit.tilt).normalize();
  if (sky._oSunI?.on) sky._sun.intensity = sunI * Math.min(1, Math.abs(elev) * 7) * M.sun;   // fade out near the horizon so day/night switching does not pop
  // one ambient budget (the style's ambient column x the weather's sky.ambient): the room map takes its share, the hemisphere light the rest
  const amb = hemiI * M.ambient, share = roomShare(sky.engine);
  if (sky._oHemi?.on) {
    sky._hemi.intensity = amb * (1 - share) + M.flash * 3;
    sky._hemi.color.copy(u.uTop.value).lerp(u.uHorizon.value, 0.5);
    sky._hemi.groundColor.copy(sky.groundTint).multiplyScalar(0.4 + 0.6 * Math.min(1, hemiI));
  }
  // the room environment is its share of the same budget, in the same units: ambient x the luminance of the sky color the hemi light takes
  // (a neutral white map must not light a dark-blue night white: desert demo R4), turned into an environment intensity by what the map gives
  // at 1 (ROOM_RADIANCE; three's hemisphere light divides by PI, the environment does not). look.lights env.intensity is the share
  sky._envFollow(amb * skyLight(u.uTop.value, u.uHorizon.value, 1) / (Math.PI * ROOM_RADIANCE));
  sky.engine.look.lights.applyTop(ctx);   // a game look.lights.set({ sun: { intensity } }) wins over the keyframes (look/part.js)
  const ex = sky.engine.exposureDriver;
  if (ex && sky._oExposure.on) sky.engine.renderer.toneMappingExposure = ex(ctx);   // style.exposure keyframes / function (engine.look.tone.set)

  if (sky.skybox && sky._oBg.on) sky.engine.scene.backgroundIntensity = Math.max(0.05, hemiI * M.ambient / 1.2);
  if (sky.csm) cascadeFrame(sky, lightDir);   // cascades place their own lights from the camera (cascades.js)
  else if (sky._drive.sun !== false) sky._placeShadow(focus, lightDir);
  for (const o of sky._owned) o.mark();
}

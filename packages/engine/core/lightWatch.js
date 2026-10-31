// Dev-only check (called from loop.js after each render once the engine is ready): warn when three.js compiled new shader programs
// in a frame where the scene's lights changed. Why: three.js builds one program per material for each light setup, so a light added,
// removed or hidden mid-play compiles again and freezes that frame (a dungeon game froze ~450 ms when a torch turned its light on).
// engine.start() already compiled everything for the startup lights; this names the cause when a game changes them afterwards.
// Cost: one array-length compare per frame; the scene walk that counts lights runs only in a frame whose program count went up (rare).
import { warnOnce } from './validate.js';
import { coded } from './errorHints.js';

const STRINGS = {
  changed: 'Shader programs were compiled during play ({from} -> {to}) in a frame where the scene\'s lights changed ({was} -> {now}). ' +
    'three.js compiles every material again for a new light setup, so adding, removing or hiding a light mid-game freezes a frame. ' +
    'Use engine.use(lightPool({ point: 8 })) and engine.lightPool.add(torch, {...}) for many lights, or fade a fixed set with intensity ' +
    '(recipes/09-style-pack.md "Lights and stalls")',
};

/** Visible lights by the kinds three.js counts in its light setup (ambient and probes do not change programs), as one comparable string */
export function lightSetup(scene) {
  let point = 0, spot = 0, dir = 0, hemi = 0, rect = 0;
  scene.traverseVisible(o => {
    if (!o.isLight) return;
    if (o.isPointLight) point++; else if (o.isSpotLight) spot++; else if (o.isDirectionalLight) dir++;
    else if (o.isHemisphereLight) hemi++; else if (o.isRectAreaLight) rect++;
  });
  return `point ${point}, spot ${spot}, directional ${dir}, hemisphere ${hemi}, rect ${rect}`;
}

/** @param {any} e the engine (dev and ready only: the caller checks) */
export function watchLights(e) {
  const n = e.renderer.info?.programs?.length;
  if (n == null) return;
  const w = e._lightWatch ??= { n, lights: lightSetup(e.scene) };
  if (n <= w.n) { w.n = n; return; }       // fewer programs (materials disposed) or none new: nothing to say
  const lights = lightSetup(e.scene);
  if (lights !== w.lights) warnOnce(coded('light-recompile', STRINGS.changed.replace('{from}', String(w.n)).replace('{to}', String(n)).replace('{was}', w.lights).replace('{now}', lights)));
  w.n = n; w.lights = lights;
}

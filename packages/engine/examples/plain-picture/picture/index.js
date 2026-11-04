// @ts-check
// The game's picture code: wiring only. Each part is one file here and writes plain three.js; the engine gives signals, these files map them to
// three.js values once per frame: engine.uniforms.uDaylight (0 night .. 1 noon), uSunDir (toward the sun), uSkyHorizon (the sky's horizon color), uRain (0-1)
import { TONE_MAPPING } from './palette.js';
import { createMaterials } from './materials.js';
import { createLights } from './lights.js';
import { createSky } from './sky.js';

/** @param {any} engine */
export function createPicture(engine) {
  engine.renderer.toneMapping = TONE_MAPPING;
  const materials = createMaterials(), lights = createLights(engine), sky = createSky(engine);
  // onRender 'before', not onFrame: onFrame runs before the modules' frame hooks, so it would read last frame's signals (and the defaults,
  // uDaylight = 1 = noon, on the very first frame). Here the sky has already written this frame's values
  engine.onRender(() => {
    sky.update(engine.uniforms);
    lights.update(engine.uniforms);
    materials.update(engine.uniforms);
  });
  return { mat: materials.mat, addLamp: lights.addLamp, sun: lights.sun, hemi: lights.hemi };
}

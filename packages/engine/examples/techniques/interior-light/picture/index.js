// @ts-check
// The picture of the interior-light demo: wiring only. Each part writes plain three.js.
import { exposureZones } from '../interiorLight.js';
import { AMBIENT, EXPOSURE, TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';
import { createSky } from './sky.js';

/**
 * Returns { mat, sun, hemi, addLamp, zone, snapZone() }. snapZone(): the zone's values at once, without easing, for the bake.
 * @param {any} engine
 * @param {Parameters<typeof createLights>[1] & { isInside: (p: any) => boolean, leak: boolean }} o
 */
export function createPicture(engine, { isInside, leak, ...o }) {
  engine.renderer.toneMapping = TONE_MAPPING;
  const sky = createSky(engine), lights = createLights(engine, o), { mat } = createMaterials();
  const zones = exposureZones(engine, { hemi: lights.hemi, isInside, exposure: EXPOSURE[o.night ? 'night' : 'day'], ease: EXPOSURE.ease,
    ambient: leak ? { inside: AMBIENT.outside, outside: AMBIENT.outside } : AMBIENT });
  // onRender, not onFrame: onFrame runs before the sky module, so it would read last frame's signals
  engine.onRender(() => { sky.update(engine.uniforms); lights.update(engine.uniforms); });
  // the zones read no signals but must count every second, and a frame that is not drawn still passes time: onFrame sees those, onRender does not
  engine.onFrame((/** @type {number} */ dt) => zones.update(dt));
  return { mat, sun: lights.sun, hemi: lights.hemi, addLamp: lights.addLamp, zone: zones.zone, snapZone: () => zones.update() };
}

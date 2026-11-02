// @ts-check
// Interior light helpers (technique example, README.md next to this file). Imports only three and its RectAreaLight addon.
// Why helpers: the zone switch has to change exposure and the leaking outdoor ambient together, eased, and only when the zone changes;
// the window light needs a one-time uniforms init. Both are easy to get half right by hand.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

/**
 * Exposure and ambient by zone, following the camera. `isInside(cameraPosition)` decides the zone; on a change the hemisphere / environment
 * intensities switch at once (they light through walls) and the exposure eases over `ease` seconds (an eye adapting). Presentation only: it
 * runs in onFrame and writes owner layers of look.lights / look.tone (remove() on the handle gives the style values back).
 * @param {any} engine
 * @param {{ isInside: (p: THREE.Vector3) => boolean, exposure: { inside: number, outside: number }, ambient: { inside: { hemi: number, env: number }, outside: { hemi: number, env: number } }, ease?: number, owner?: string }} o
 */
export function exposureZones(engine, { isInside, exposure, ambient, ease = 1.2, owner = 'zone' }) {
  const zone = { name: '', exposure: 0, target: 0 };
  /** @param {boolean} immediate @param {number} dt */
  const apply = (immediate, dt = 0) => {
    const name = isInside(engine.camera.position) ? 'inside' : 'outside';
    if (name !== zone.name) {
      zone.name = name;
      zone.target = exposure[name];
      engine.look.lights.set({ hemi: { intensity: ambient[name].hemi }, env: { intensity: ambient[name].env } }, { owner });
    }
    const next = immediate || !zone.exposure ? zone.target : zone.exposure + (zone.target - zone.exposure) * Math.min(1, dt / (ease / 3));
    if (Math.abs(next - zone.exposure) > 1e-4) { zone.exposure = next; engine.look.tone.set({ exposure: next }, { owner }); }
  };
  const h = engine.onFrame((/** @type {number} */ dt) => apply(false, dt));
  return { zone, apply, remove() { h?.remove?.(); engine.look.lights.set({ hemi: null, env: null }, { owner }); engine.look.tone.set({ exposure: null }, { owner }); } };
}

/**
 * The sky seen through a window as a RectAreaLight in the opening, facing `lookAt`. Soft and window-shaped, but it casts no shadow and lights
 * only MeshStandardMaterial / MeshPhysicalMaterial.
 * @param {any} engine
 * @param {{ position: number[], lookAt: number[], width: number, height: number, color?: THREE.ColorRepresentation, intensity?: number }} o
 */
export function windowLight(engine, { position, lookAt, width, height, color = '#cfe0ff', intensity = 2 }) {
  RectAreaLightUniformsLib.init();   // once per page is enough; calling it again is harmless
  const area = new THREE.RectAreaLight(color, intensity, width, height);
  area.position.set(position[0], position[1], position[2]);
  area.lookAt(lookAt[0], lookAt[1], lookAt[2]);
  engine.scene.add(area);
  return area;
}

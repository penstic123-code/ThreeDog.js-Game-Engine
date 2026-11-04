// @ts-check
// The room's lamp. The sun and the ambient belong to the picture under test; this page only adds what its exhibits need.
import { LAMP } from './palette.js';

/** One pooled light and the lamp's glow, switched together @param {any} engine @param {(on: boolean) => void} glow @param {{ x: number, y: number, z: number }} at */
export function addLamp(engine, glow, at) {
  const light = engine.lightPool.add(at, { color: LAMP.color, intensity: 0, distance: LAMP.distance });
  return (/** @type {boolean} */ on) => { glow(on); light.set({ intensity: on ? LAMP.intensity : 0 }); };
}

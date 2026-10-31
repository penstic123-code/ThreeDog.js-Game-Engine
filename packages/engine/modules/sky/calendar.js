// Sky season tint (helper of Sky.js): blends style.seasons colors into the engine's foliage / ground tint uniforms every frame.
import * as THREE from 'three';

// This season's color, blending to the next season over the last 20% of the season
const c1 = new THREE.Color(), c2 = new THREE.Color();
export function applySeason(sky, uniforms) {
  const S = sky.seasonStyle; if (!S) return;
  const cur = S[sky.season] || {}, next = S[sky.seasons[(sky.seasonIndex + 1) % sky.seasons.length]] || {};
  const k = Math.max(0, (sky.seasonProgress - 0.8) / 0.2);
  const blend = (key, out) => { c1.set(cur[key] ?? 0xffffff); c2.set(next[key] ?? 0xffffff); out.copy(c1).lerp(c2, k); };
  blend('foliage', uniforms.uFoliageTint.value); blend('ground', uniforms.uGroundTint.value);
}

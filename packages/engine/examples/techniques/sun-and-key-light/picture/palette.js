// @ts-check
// The lighting routes of the gray yard, and the numbers to change. Neutral gray objects, so the light is all there is to look at.
// elevation / azimuth in degrees. azimuth is measured around the subject from the camera: 0 = sun behind the camera (front light),
// 90 = from the side, 180 = facing the camera (back light). key = the sun (DirectionalLight), fill = the hemisphere light + the room environment.
import { THREE } from 'threedog';

/** @type {Record<string, { elevation: number, azimuth: number, key: { intensity: number, color: string }, fill: { intensity: number, color: string, ground: string }, env: number, tint: number, backdrop: string, shadow: { type: 'basic' | 'pcf' | 'vsm', radius: number, blurSamples?: number } }>} */
export const ROUTES = {
  // hard noon: a strong high key, a weak blue fill -> short dark shadows, key:fill about 5:1 on the ground. Clear, graphic, a bit harsh.
  noon: { elevation: 72, azimuth: 35, key: { intensity: 2.7, color: '#fff3e2' }, fill: { intensity: 0.35, color: '#9fbfe8', ground: '#6d675e' }, env: 0.1,
    tint: 1, backdrop: '#a8c4e4', shadow: { type: 'pcf', radius: 1 } },
  // soft overcast: the sky is the light. A weak key, a strong near-white fill, a very soft shadow -> key:fill about 1.4:1, forms read by
  // gentle gradients and contact darkening only. Calm, can turn gray-flat if the fill is also dim or colorless.
  overcast: { elevation: 58, azimuth: 40, key: { intensity: 0.9, color: '#f1f0ec' }, fill: { intensity: 1.5, color: '#d9dee6', ground: '#8b8a86' }, env: 0.3,
    tint: 1, backdrop: '#c8cdd4', shadow: { type: 'vsm', radius: 14, blurSamples: 16 } },
  // golden hour: a low warm key from the side, a cool fill -> long shadows, lit faces glow orange, shadows read blue, rims on round tops.
  golden: { elevation: 13, azimuth: 50, key: { intensity: 5, color: '#ffb877' }, fill: { intensity: 0.55, color: '#7f9fdc', ground: '#5c4d40' }, env: 0.1,
    tint: 1, backdrop: '#e6b98f', shadow: { type: 'pcf', radius: 2 } },
};
/** Sun direction overrides (?sun=...), [elevation, azimuth] */
export const DIRECTIONS = { front: [35, 0], side: [35, 90], back: [22, 165], low: [9, 60], top: [88, 0] };
/** One shadow box fitted to this compact yard: 2048 px over +-12 m = 1.2 cm texels (an open-world +-70 m box is 6.8 cm). bias in centimeters */
export const SHADOW_FIT = { extent: 12, mapSize: 2048, bias: 2, normalBias: 0.02 };
/** Where the page's URL names land in three.js */
export const SHADOW_TYPES = { basic: THREE.BasicShadowMap, pcf: THREE.PCFShadowMap, vsm: THREE.VSMShadowMap };
/** Fog starts this far into its range: the ground fades into the backdrop only near the horizon */
export const FOG = { near: 21, far: 70 };
export const COLORS = { ground: 0x8e8e8e, cube: 0xb8b8b8, ball: 0xc4c4c4, drum: 0xa8a8a8, pole: 0x9a9a9a, figure: 0xbdbdbd, small: 0xd0d0d0 };
export const TONE_MAPPING = THREE.AgXToneMapping;

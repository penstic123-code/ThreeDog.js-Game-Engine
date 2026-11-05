// @ts-check
// Palette: every color and key number of this picture. Change this file first; a new palette alone is a different game.
// The values below are a starting point for a clear, bright daytime look. They are not "the threedog look": there is none.
import { THREE } from 'threedog';

export const palette = {
  // No tone curve: the color written here is the color on screen, as long as sun + ambient add up to about PI (lights.js says why).
  // Want a filmic roll-off instead? THREE.AgXToneMapping or THREE.ACESFilmicToneMapping, then raise the saturation of everything below.
  toneMapping: THREE.NoToneMapping,

  sky: {
    top: 0x3f9fea, horizon: 0xcfeef5, nightTop: 0x101a3c, nightHorizon: 0x2c3a68,
    cloud: 0xffffff, cloudShade: 0xc3dcf2,
    cloudSize: 1.1, cloudCover: 0.08, cloudPuff: 0.28, cloudDrift: 0.006,   // cover: -0.5 full sky .. 0.5 almost none; puff: meters of bumps on the outline
  },
  fog: { near: 45, far: 190 },   // takes the sky's horizon color, so far things melt into it

  // sun: direction is used when the game has no sky() module; with one, the sun follows the time of day. noon + ambient.noon = about PI.
  // The share between them sets the light range: ambient lifts lit and shaded parts alike, so more sun and less ambient means deeper shade at the same overall level.
  sun: { color: 0xfff4e0, noon: 2.7, direction: [0.55, 0.62, 0.42], shadowMap: { low: 1024, high: 2048 } },
  ambient: { sky: 0xe6f2ff, ground: 0xc8c090, noon: 0.45, night: 0.3 },

  // The light in each band, dark to light, one ramp for the whole game. Left half of the ramp = the side turned away from the sun, and cast shadows.
  // The dark entry is the color of every shadow: tinting it is the fastest way to change the mood (violet, teal, warm brown).
  ramp: [0x4a4fa8, 0x4a4fa8, 0x4a4fa8, 0x4a4fa8, 0x4a4fa8, 0xb4b6e4, 0xffffff, 0xffffff, 0xffffff, 0xffffff],

  // The one texture language (paint.js): two flat colors with a clean wobbling edge between them. size is in meters; cover -0.5 (mostly patch) .. 0.5 (mostly base).
  surface: {
    leaf: { base: 0x46b04a, patch: 0x6cc950, size: 0.9, cover: 0.05 },
    leafDark: { base: 0x2f9458, patch: 0x3fae5c, size: 0.7, cover: 0.05 },
    bark: { base: 0xa06a3e, patch: 0x8d5a34, size: 0.35, cover: 0.12 },
    wood: { base: 0xd29a56, patch: 0xbd8344, size: 0.5, cover: 0.18 },
    stone: { base: 0xb9bdc7, patch: 0x9ea4b4, size: 0.8, cover: 0.08 },
    wall: { base: 0xf6e6c4, patch: 0xecd5ac, size: 1.2, cover: 0.18 },
    roof: { base: 0xe8553f, patch: 0xdb4a3a, size: 0.6, cover: 0.14 },
    accent: { base: 0xffc93c, patch: 0xffb020, size: 0.5, cover: 0.2 },
  },
  glow: { day: 0.5, night: 2.2, color: 0xffd36b },   // lit things (the lamp); bright at night

  ground: {
    base: 0x6ccf4f, patch: 0x86dc5c, size: 3.2, cover: 0.06,   // the field
    fleck: 0x62c64e, fleckSize: 1.1, fleckCover: 0.3,          // a second, smaller patch on top, so the ground reads at both distances
    path: 0xedd199, pathPatch: 0xdfc084, pathEdge: 0.32,       // where the game's pathAt() says so
    sand: 0xf8e6ae, sandHeight: 0.55,                          // meters above the water line
  },
  water: {
    shallow: 0x62e0dc, middle: 0x2bbcd8, deep: 0x1a8fce, foam: 0xffffff,
    middleAt: 0.45, deepAt: 1.5, foamWidth: 0.1,               // meters of water under the surface where each band starts
    wobble: 0.16, wobbleSize: 1.6, driftSpeed: 0.05,
    glint: 0.4, glintSize: 0.9,                               // short white strokes on open water; raise glint for fewer
  },
};

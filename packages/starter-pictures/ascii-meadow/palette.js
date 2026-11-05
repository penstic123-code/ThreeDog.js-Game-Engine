// @ts-check
// Palette: every color and key number of the scene under the character layer (the layer's own values sit at the top of ascii.js). Change this file first.
// The values below are a starting point for a soft, muted, mid-toned daytime look. They are not "the threedog look": there is none.
import { THREE } from 'threedog';

export const palette = {
  // No tone curve: the color written here is the color on screen, as long as sun + fill add up to about PI (lights.js says why).
  toneMapping: THREE.NoToneMapping,

  // What shows above the horizon on a low camera; fog takes the same color, so far land melts into it. A high camera never sees it.
  horizon: 0xb9c6a4,
  fog: { near: 200, far: 480 },

  // Sun is close to neutral: light and shade differ in depth here, not in temperature. The fill's ground color is green on purpose: it is what shadows are made of.
  // The share between them sets the picture's light range: the fill alone lights the shade, so more sun and less fill means deep shade and bright tops at the same overall level.
  sun: { color: 0xfffaf0, noon: 2.6, direction: [-0.5, 0.72, 0.42], shadowMap: { low: 2048, high: 4096 }, softness: 5 },
  fill: { sky: 0xdfe8d0, ground: 0x6f9a5a, noon: 0.55, night: 0.4 },

  // Applied to the finished picture: pixels lose color as they get bright, so light areas read pale and dark areas stay rich. amount 0 turns it off.
  grade: { from: 0.42, to: 0.85, amount: 0.55 },

  // base and drift are near neighbors: a field stays quiet and only breathes. size: meters across a soft patch.
  grass: { base: 0x8aa660, drift: 0x6f9a58, far: 0x9cae6c, size: 26 },
  lush: 0x5c8a4e,                  // the grass around tree groups
  bank: { base: 0xc2b39c, drift: 0xa89a80, reach: 0.45 },   // the bare edge along water; reach: how far up the mask it climbs
  bed: 0x6e8a70,                   // under the water line, seen only at the very edge

  water: { deep: 0x84b4ae, shallow: 0xaed0ca, streak: 0xc8e0da, foam: 0xdbe6d8, size: 9, drift: 0.05, depthRange: 1.3, foamWidth: 0.1 },

  // Each leaf is a pair: the color of a canopy's lit top and of its underside. Add a row and it joins the mix.
  leaves: [
    { light: 0xc6d07e, dark: 0x4f7a3a },   // yellow-green
    { light: 0xb2c874, dark: 0x3f6c38 },   // fresh
    { light: 0x9dc070, dark: 0x2c5a34 },   // middle
    { light: 0x82b070, dark: 0x214a32 },   // deep
    { light: 0x96bf90, dark: 0x265a46 },   // cool, the rare one
  ],
  leafGrain: { size: 1.6, amount: 0.12 },  // soft light and dark over a canopy, so a sphere does not read as a sphere
  trunk: { light: 0x7a6650, dark: 0x4a3f30 },
  rock: { light: 0xcdbfbe, dark: 0x8d8284 },   // pale pink-grey: the picture's one small accent
  reed: { light: 0xb0b56c, dark: 0x5f7f40 },
};

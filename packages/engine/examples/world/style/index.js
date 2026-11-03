// The world example's look: one folder = one style (recipes/09-style.md). Starting values only; the game and effects change them on top
// (engine.look.<part>.set, weather, settings). The trees, rocks and the humanoid body are this example's art (../art/), not part of the look:
// the material roles below decide how they are shaded.
// A style folder also brings look plugins (a sky, a post effect, a material per role...): each file the same shapes as the game's plugins/
// folder. This one brings its bloom that way (plugins/10-bloom.js); a Vite game lists the folder with import.meta.glob('./plugins/*.js', { eager: true }).
import * as bloom from './plugins/10-bloom.js';
import { PALETTE } from '../art/models.js';

/** @type {import('threedog').Style} */
export default {
  name: 'world',
  exposure: 1.05,
  toneMapping: 'aces',
  background: 0xcfe6f2,
  plugins: { './plugins/10-bloom.js': bloom },

  // the material per role: look.materials' style layer (makeMaterial(role) reads it; the game's look.materials.set goes on top)
  materials: {
    default: { type: 'lambert' },
    water: { type: 'phong', shininess: 90, specular: 0x9ac8e0 },
    pickup: { flatShading: true, emissive: 0x403418 },   // the item's own color is the base color
    // the roles the humanoid body uses (art/humanoid.js)
    cloth: { flatShading: true, color: 0xd9774a }, skin: { flatShading: true, color: 0xf1c9a5 },
    trousers: { flatShading: true, color: 0x3f4a5c }, hair: { flatShading: true, color: 0x4a3426 },
  },

  palette: PALETTE,   // the colors the procedural art reads (art/models.js); style: [style, { palette: { leaf } }] retints every tree
  clouds: { shadow: 0.55, scale: 0.006, speed: [0.012, 0.006] },

  // ground type colors; the type names come from terrainPreset() of @threedog/terrain-noise
  terrain: {
    config: { shading: 'flat' },
    colors: { sand: 0xe2cf9c, meadowA: 0x95c45e, meadowB: 0x80b350, forestA: 0x6aa04a, forestB: 0x5a9142, savannaA: 0xc9bd6e, savannaB: 0xb3a85c,
      wetland: 0x6f9a5a, riverbank: 0x8fb06a, highGrass: 0x60954a, rock: 0x8f897d, rockDark: 0x77726a, snow: 0xf1efe8 },
    biomeColors: { beach: ['sand'], snow: ['snow'], rock: ['rock', 'rockDark'], riverbank: ['riverbank', 'meadowA'], wetland: ['wetland', 'meadowB'],
      savanna: ['savannaA', 'savannaB'], forest: ['forestA', 'forestB'], highland: ['highGrass', 'meadowB'], meadow: ['meadowA', 'meadowB'] },
    steep: [{ maxNormalY: 0.62, colors: ['rockDark'] }, { maxNormalY: 0.78, colors: ['rock', 'rockDark'] }],
  },

  // [time 0-1, zenith, horizon (= fog), sun color, sun intensity, ambient intensity]
  sky: {
    keyframes: [
      [0.00, 0x0b1026, 0x1d2747, 0x8fa3d6, 0.45, 0.35],
      [0.25, 0x6f8ec4, 0xf0b48c, 0xffb27a, 1.90, 0.80],
      [0.50, 0x4f95d8, 0xc8e4f6, 0xffffff, 3.00, 1.20],
      [0.75, 0x5a6fb0, 0xf2a07a, 0xff9a5c, 1.90, 0.80],
      [1.00, 0x0b1026, 0x1d2747, 0x8fa3d6, 0.45, 0.35],
    ],
    groundTint: 0x4d5a34,
    clouds: { color: 0xf8f6f0, shade: 0xb0b8c4, coverage: 1, scale: 0.35, speed: [0.004, 0.002] },
  },

  water: { color: 0x4f9cc0, opacity: 0.85, flat: true, fresnel: 0.5 },
  pickup: { color: 0xf0d27a, size: 0.25, lift: 0.4 },
  ui: { bg: 'rgba(24,22,18,.9)', fg: '#f3eee2', muted: '#a8a294', accent: '#f0b450', line: 'rgba(255,255,255,.15)', radius: '12px' },
  particles: {
    dust: { max: 200, lifetime: [0.5, 1.1], speed: [0.6, 1.8], direction: [0, 1, 0], spread: 1.2, gravity: -1.5, drag: 2, size: [0.25, 0.6], color: [0xd8c8a0, 0xc8b890], opacity: [0.6, 0] },
    smoke: { max: 120, rate: 6, lifetime: [3, 5], speed: [0.4, 0.8], direction: [0.2, 1, 0], spread: 0.25, gravity: 0.15, drag: 0.4, size: [0.6, 2.2], color: [0xc8c4bc, 0xe8e6e2], opacity: [0.55, 0] },
    leaves: { max: 150, lifetime: [3, 6], speed: [0.3, 1], direction: [1, -0.4, 0.3], spread: 1, gravity: -0.6, drag: 1.2, size: [0.18, 0.18], color: [0xd99a4a, 0xb86a30], opacity: [1, 0], spin: 3 },
  },
};

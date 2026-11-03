// sheepisland: this game's style, LOOKS ONLY (recipes/09-style.md, 35-style-from-reference.md), filled in from the empty style/index.js
// a new game starts with. A soft painted diorama: few flat colors, round shapes, soft shadows, a pale warm background with no horizon.
// The world (island outline, river, wheat field) is the game's terrain() in ../main.js, never here.
import { makeMaterial, applyEffects } from '../../../index.js';
import { models, PALETTE } from './models.js';

export { models };
/** Asset pack of the procedural models: engine.assets.manifest(assets) registers roundTree, sheep and wheatTuft */
export const assets = { name: 'sheepisland', models };

// Background: zenith = horizon = fog color at every time, so the dome is one flat tone and no horizon line shows.
// [time 0-1, zenith, horizon (= fog), sun color, sun intensity, ambient intensity]
// Ground material with snow that survives shading: 'texture'. The engine's season tint runs at color_fragment, before the per-chunk color map is
// multiplied in, so in 'mix' mode the map paints the green back over the white. This patch repeats the season mix later (slot emissive, emissivemap_fragment,
// after every color patch, before lighting), reading the engine's own season uniforms under new names (the season patch declares the old ones).
/** @param {any} engine */
function snowyGround(engine) {
  const u = engine.uniforms;
  return applyEffects(makeMaterial('terrain', { vertexColors: true }, engine), { clouds: false, patches: [{
    name: 'snowCover', cacheKey: 1, uniforms: { uSnowTint: u.uGroundTint, uSnowMix: u.uGroundMix },
    pars: 'uniform vec3 uSnowTint; uniform float uSnowMix;',
    slot: 'emissive', glsl: 'diffuseColor.rgb = mix(diffuseColor.rgb, uSnowTint, uSnowMix);' }] });
}

const DAY = 0xefebe4, DUSK = 0xf0d9c4, NIGHT = 0x2c3346;
export default {
  name: 'sheepisland',
  exposure: 1,
  toneMapping: 'neutral',        // neutral keeps the painted colors close to what is written here (aces darkens and shifts them)

  // no post plugins: restraint, the reference shows no outline, bloom or grain

  materials: {
    default: { type: 'lambert' },
    leaf: { type: 'lambert' },
    bark: { type: 'lambert' },
    wool: { type: 'lambert' },
    face: { type: 'lambert' },
    cliff: { type: 'lambert' },
    vegetation: { type: 'lambert', side: 2 },   // the wheat stalks are thin: both sides (THREE.DoubleSide = 2)
  },

  // Soft light: half-lambert wrap so the shade side of a round blob is not black, and a cool blue shade instead of a gray one
  lighting: { wrap: 0.45, shadowTint: { color: 0x7d88b8, strength: 0.45, soft: 0.3 } },

  palette: PALETTE,

  sky: {
    keyframes: [
      [0.00, NIGHT, NIGHT, 0x9aaad8, 0.7, 0.85],
      [0.22, NIGHT, NIGHT, 0x9aaad8, 0.7, 0.85],
      [0.30, DAY, DAY, 0xfff0dc, 1.8, 1.0],
      [0.50, DAY, DAY, 0xfffaf0, 2.3, 1.15],
      [0.70, DAY, DAY, 0xffe6c8, 1.9, 1.0],
      [0.77, DUSK, DUSK, 0xffb07a, 1.5, 0.85],
      [0.84, NIGHT, NIGHT, 0x9aaad8, 0.7, 0.85],
      [1.00, NIGHT, NIGHT, 0x9aaad8, 0.7, 0.85],
    ],
    groundTint: 0xb8c49a,         // ambient bounce from below: the green of the meadow, not gray
    sunBrightness: 0, sunGlow: 0, moonBrightness: 0, starDensity: 0,   // a flat painted backdrop: no disc, glow or stars
    clouds: { coverage: 0 },
    shadow: { type: 'pcf', radius: 4, extent: 45, mapSize: 2048 },      // soft edges; the island is small, so a tight box keeps them sharp enough
    fog: { kind: 'exp', density: 0.0015 },                              // barely there: the far rim fades a touch into the backdrop
  },

  terrain: {
    config: { shading: 'texture', colorResolution: 256 },   // crisp river bank and field edge without more triangles (recipe 37); 128 (0.5 m pixels) shows stairs up close
    colors: { grassA: 0x92c062, grassB: 0x86b658, river: 0x6aa6d6, riverDeep: 0x5b97ca, wheatA: 0xdcae48, wheatB: 0xd2a442,
      earth: 0xb98d64, rock: 0x94705a },
    biomeColors: { grass: ['grassA', 'grassB'], river: ['river', 'riverDeep'], wheat: ['wheatA', 'wheatB'], cliff: ['earth'], rock: ['rock'] },
    variation: { blend: { size: 14, strength: 0.6 }, jitter: { size: 0.5, min: 0.97, range: 0.04 } },   // low texture: almost no grain
    material: snowyGround,
  },

  // Snow: winter in the calendar turns foliage and ground most of the way to white ('mix', so green does not go muddy)
  seasons: { mode: /** @type {const} */ ('mix'), strength: 0.82, winter: { foliage: 0xf6f6f8, ground: 0xf4f5f8 } },
  // snow greys the sky towards overcastColor and dims the sun: keep the backdrop pale and the island readable
  weather: { snow: { color: 0xffffff }, overcastColor: 0xe6e3de, types: { snow: { sun: 0.8, grey: 0.25 } } },
};

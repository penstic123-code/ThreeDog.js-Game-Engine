// Lowpoly style pack (@threedog/style-lowpoly): an optional package with everything about how a game looks: colors, materials, sky,
// lighting, post effects, procedural models (trees, rocks, the humanoid character, pickups) and UI colors. The engine ships no art;
// a game opts in with createEngine({ style: lowpoly }). Sounds and gameplay data are not here: they are the game's (createEngine({ audio })).
// New art style = copy this folder, change values / swap model files; engine code stays untouched.
//
// Every entry is optional; omitted parts get neutral engine placeholders (gray).
// Also exported: terrainPreset / riverAt / BIOMES / terrainStrings (terrain.js, a generator for terrain(); its ground type names match terrain.biomeColors below).
import { models } from './models.js';
import { humanoid, pickup } from './shapes.js';
import { bloom, outline, ao } from './post.js';

export { bloom, outline, ao, models };
export { terrainPreset, riverAt, BIOMES, terrainStrings } from './terrain.js';

export default {
  name: 'lowpoly',
  exposure: 1.05,
  toneMapping: 'aces',           // 'aces' | 'agx' | 'neutral' | 'none'
  background: 0xcfe6f2,

  // Post effects in render order (engine.post): outline (off; on for a cartoon look), ambient occlusion (off), bloom (off on low-end devices)
  post: [outline({ color: 0x2a2620, thickness: 1, strength: 0.7 }), ao(), bloom({ strength: 0.35, radius: 0.5, threshold: 0.85 })],

  // Materials (look): type and params per role. 'lambert' matte | 'phong' glossy | 'standard' realistic | 'toon' cartoon bands (steps levels)
  materials: {
    default: { type: 'lambert' },
    water: { type: 'phong', shininess: 90, specular: 0x9ac8e0 },
    character: { flatShading: true },   // faceted character parts
  },

  // Season tint (multiplied onto base color): foliage, ground. Fades to the next season at season end
  seasons: {
    spring: { foliage: 0xf4ffe8, ground: 0xffffff },
    summer: { foliage: 0xffffff, ground: 0xffffff },
    autumn: { foliage: 0xffc27a, ground: 0xf0e0c0 },
    winter: { foliage: 0xc8d0d8, ground: 0xe8eef4 },
  },
  // Cloud shadows and wind (shader params)
  clouds: { shadow: 0.55, scale: 0.006, speed: [0.012, 0.006] },
  wind: { frequency: 1 },

  // Terrain: color per ground type (flat shading, one color per triangle). Ground type names are those of terrainPreset() (terrain.js)
  terrain: {
    config: { shading: 'flat' },   // faceted ground; material: (engine) => Material swaps the whole ground material
    // detail: { texture: '/textures/grain.png', scale: 0.25, strength: 0.35 },   // ground detail texture (grain, grass)
    colors: {
      sand: 0xe2cf9c, meadowA: 0x95c45e, meadowB: 0x80b350, forestA: 0x6aa04a, forestB: 0x5a9142,
      savannaA: 0xc9bd6e, savannaB: 0xb3a85c, wetland: 0x6f9a5a, riverbank: 0x8fb06a,
      highGrass: 0x60954a, rock: 0x8f897d, rockDark: 0x77726a, snow: 0xf1efe8,
    },
    // ground type -> palette color names (two are blended by noise)
    biomeColors: {
      beach: ['sand'], snow: ['snow'], rock: ['rock', 'rockDark'], riverbank: ['riverbank', 'meadowA'], wetland: ['wetland', 'meadowB'],
      savanna: ['savannaA', 'savannaB'], forest: ['forestA', 'forestB'], highland: ['highGrass', 'meadowB'], meadow: ['meadowA', 'meadowB'],
    },
    // steep slopes are drawn as rock whatever the ground type: [{ maxNormalY: how upward-facing, colors }]
    steep: [{ maxNormalY: 0.62, colors: ['rockDark'] }, { maxNormalY: 0.78, colors: ['rock', 'rockDark'] }],
  },

  // Sky: [time 0-1, zenith color, horizon color (= fog color), sun color, sun intensity, ambient intensity]
  sky: {
    keyframes: [
      [0.00, 0x0b1026, 0x1d2747, 0x8fa3d6, 0.45, 0.35],
      [0.22, 0x1c2148, 0x463f6a, 0xffa070, 0.50, 0.45],
      [0.27, 0x6f8ec4, 0xf0b48c, 0xffb27a, 1.90, 0.80],
      [0.36, 0x5f9fd8, 0xcfe6f2, 0xfff1d8, 2.70, 1.10],
      [0.50, 0x4f95d8, 0xc8e4f6, 0xffffff, 3.00, 1.20],
      [0.66, 0x5c9bd2, 0xd2e6f0, 0xfff0d4, 2.70, 1.10],
      [0.75, 0x5a6fb0, 0xf2a07a, 0xff9a5c, 1.90, 0.80],
      [0.80, 0x272a5a, 0x6a5a86, 0xc07a8a, 0.50, 0.50],
      [1.00, 0x0b1026, 0x1d2747, 0x8fa3d6, 0.45, 0.35],
    ],
    sunSize: 900,          // bigger = smaller sun
    sunGlow: 0.18,         // halo around the sun
    moonSize: 1400,
    moonColor: 0xd8e0f0,
    sunBrightness: 6,      // sun brightness
    moonBrightness: 3,
    orbitTilt: 0.45,       // how far the sun path leans south (north)
    orbitSway: 0.8,
    hoursPerDay: 24,
    starDensity: 0.0025,   // star density
    starScale: 260,        // bigger = smaller, more numerous stars
    gradientCurve: 0.55,   // zenith-to-horizon gradient curve
    groundTint: 0x4d5a34,  // ground bounce color of the ambient light
    clouds: { color: 0xf8f6f0, shade: 0xb0b8c4, coverage: 1, scale: 0.35, speed: [0.004, 0.002] },   // sky clouds (cover follows weather)
    // skybox: '/textures/sky.jpg',   // panorama instead of the gradient sky
    // Shadows: mapSize resolution (px), extent coverage radius (m), distance light distance (m), bias/normalBias against banding,
    // updateEvery update every N frames (1 = every frame), snap shadow-center grid (m; 'texel' aligns to shadow texels), ahead shift the center along the view direction (m)
    // low: overrides on low-tier devices (phones, integrated GPUs): a quarter of the shadow fill cost, same update rate (wind shadows stay smooth)
    shadow: { mapSize: 2048, extent: 70, distance: 160, bias: -0.0006, normalBias: 0.04, updateEvery: 1, snap: 0.5, ahead: 0, low: { mapSize: 1024 } },
  },

  weather: {
    area: 40,                                                // rain/snow coverage (m)
    overcastColor: 0x8a9096,                                 // target sky gray when overcast
    lightningBrightness: 1,
    rain: { color: 0xbfd0e0, opacity: 0.55, length: 0.7, speed: 22, slant: 1 },   // add texture to draw drops with a texture
    snow: { color: 0xffffff, opacity: 0.9, size: 20, maxSize: 5, speed: 1.6, texture: null },  // texture can name a snowflake image asset
  },

  water: { color: 0x4f9cc0, opacity: 0.85, waveHeight: 1, waveScale: 1, waveSpeed: 1, flat: true, fresnel: 0.5 },   // normalMap: '/textures/water-normal.jpg'

  // Default look of pickups on the ground (the item's own color wins when it defines one)
  // model(item, { color, size }) returns the Object3D or BufferGeometry to show (shapes.js: faceted glowing octahedron)
  pickup: { color: 0xf0d27a, size: 0.25, lift: 0.4, model: pickup },

  // Default character: colors is the palette; create(engine, colors) returns the procedural character (rig format: packages/engine/modules/characters/Character.js; shapes.js humanoid here)
  // animation.fade: transition seconds when a skeletal animation switches
  character: { colors: { body: 0xd9774a, skin: 0xf1c9a5, legs: 0x3f4a5c, hair: 0x4a3426 }, create: humanoid, animation: { fade: 0.25 } },

  // UI colors (dialogue box, inventory, quests, toasts, loading screen)
  ui: {
    bg: 'rgba(24,22,18,.9)', fg: '#f3eee2', muted: '#a8a294', accent: '#f0b450', line: 'rgba(255,255,255,.15)',
    font: 'system-ui,"PingFang SC","Microsoft YaHei",sans-serif', radius: '12px', loadingBg: '#1c2420', good: '#8fd17a',
    promptHeight: 2.4,   // how high the interaction prompt floats above the object (m)
    fadeBg: '#000',      // fade color of scene transitions
    hudBg: 'rgba(24,22,18,.75)', hudFg: '#f3eee2', hudAccent: '#f0b450',   // objective marker, counter, progress bar
    // Font files: fontFaces: [{ family: 'MyFont', url: '/fonts/my.woff2' }], or fontCSS: 'https://fonts.googleapis.com/css2?family=...'
    // Extra CSS (overrides any .threedog-* class): css: '.threedog-win { width: 600px }'
    // Replace a UI's content whole: templates: { inventory: (data, { esc, t, icon }) => '<div>…</div>' }
    //   Objective marker: templates: { hudMarker: (d, { esc }) => `<b>${esc(d.label)}</b> ${esc(d.distance)}`, hudCounter: …, hudBar: … }
  },

  // Particle presets: use directly via engine.particles.emit('dust', position, { count }); default is the fallback for every effect
  particles: {
    default: { color: [0xffffff, 0xdddddd], opacity: [0.8, 0], maxPixels: 512 },   // maxPixels: on-screen size cap of one particle
    dust: { max: 200, lifetime: [0.5, 1.1], speed: [0.6, 1.8], direction: [0, 1, 0], spread: 1.2, gravity: -1.5, drag: 2, size: [0.25, 0.6], color: [0xd8c8a0, 0xc8b890], opacity: [0.6, 0] },
    smoke: { max: 120, rate: 6, lifetime: [3, 5], speed: [0.4, 0.8], direction: [0.2, 1, 0], spread: 0.25, gravity: 0.15, drag: 0.4, size: [0.6, 2.2], color: [0xc8c4bc, 0xe8e6e2], opacity: [0.55, 0] },
    leaves: { max: 150, lifetime: [3, 6], speed: [0.3, 1], direction: [1, -0.4, 0.3], spread: 1, gravity: -0.6, drag: 1.2, size: [0.18, 0.18], color: [0xd99a4a, 0xb86a30], opacity: [1, 0], spin: 3 },
    splash: { max: 150, lifetime: [0.4, 0.8], speed: [2, 4], direction: [0, 1, 0], spread: 0.6, gravity: -12, size: [0.15, 0.05], color: [0xdcecf4, 0xffffff], opacity: [0.9, 0] },
    sparks: { max: 100, lifetime: [0.3, 0.7], speed: [2, 5], direction: [0, 1, 0], spread: 0.9, gravity: -6, size: [0.08, 0.02], color: [0xffd070, 0xff6020], opacity: [1, 0], blending: 'additive' },
  },
  // Trigger zone debug wireframe color (F4)
  triggers: { debugColor: 0x9a9a9a, debugOpacity: 0.8 },
  // Grid placement (grids() module): preview colors (can place / cannot), and tile colors per layer: first truthy field wins
  grid: { ok: 0x7fd38a, bad: 0xe0675a, previewOpacity: 0.45 },

  // Procedural models (trees, rocks, grass, flowers). Game code gets them via lowpoly.models.pine()
  models,
};

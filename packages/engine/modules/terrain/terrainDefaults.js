// Terrain defaults: biome rules, biome colors, steep-slope colors, defaults of all parameters. Pure data, no three.js dependency (the Worker reads it too).
// Biome rules: checked top to bottom, the first match is the biome there (the last has no condition and is the default).
// Conditions (all optional): minHeight/maxHeight altitude, maxAboveWater height above water, minSlope slope, minTemp/maxTemp temperature 0-1,
// minMoist/maxMoist moisture 0-1, minRiver closeness to a river (0-1); any: [cond, cond] matches if either holds.
// A game can replace these fully via terrain({ biomes: [...] }); names are free, vegetation rules and footsteps match by name.
export const DEFAULT_BIOMES = [
  { name: 'beach', maxAboveWater: 1.3 },
  { name: 'snow', any: [{ minHeight: 46 }, { maxTemp: 0.2 }] },
  { name: 'rock', any: [{ minSlope: 0.8 }, { minHeight: 34 }] },
  { name: 'riverbank', minRiver: 0.05 },
  { name: 'wetland', minMoist: 0.62, maxHeight: 6 },
  { name: 'savanna', maxMoist: 0.4, minTemp: 0.5 },
  { name: 'forest', minMoist: 0.5 },
  { name: 'highland', minHeight: 16 },
  { name: 'meadow' },
];
// biome -> color name in the palette (two colors are blended by noise). Style pack style.terrain.biomeColors can override
export const DEFAULT_BIOME_COLORS = {
  beach: ['sand'], snow: ['snow'], rock: ['rock', 'rockDark'], riverbank: ['riverbank', 'meadowA'], wetland: ['wetland', 'meadowB'],
  savanna: ['savannaA', 'savannaB'], forest: ['forestA', 'forestB'], highland: ['highGrass', 'meadowB'], meadow: ['meadowA', 'meadowB'],
  // never generated, only painted by engine.terrain.edit(pos, { paint: 'tilled' }) (farming); a game adds its own painted types the same way
  tilled: ['soil'], wet: ['soilWet'],
};
// steep slopes are drawn as rock regardless of biome: [{ maxNormalY: how upward-facing, colors }]
const DEFAULT_STEEP = [{ maxNormalY: 0.62, colors: ['rockDark'] }, { maxNormalY: 0.78, colors: ['rock', 'rockDark'] }];
export const BIOMES = DEFAULT_BIOMES.map(b => b.name);

export const DEFAULT_TERRAIN = {
  seed: 1337,
  chunkSize: 64,       // chunk edge length (m)
  resolution: 16,      // cells per chunk; smaller is more "low-poly"
  waterLevel: 0,
  heightScale: 1,      // overall relief multiplier
  mountains: 1,        // mountain strength
  rivers: true,        // whether to generate rivers
  riverWidth: 0.03,    // river width (noise threshold, 0.02 narrow, 0.05 wide)
  flatten: [],         // flattened plots: [{ x, z, radius, height? }], for villages and houses
  biomes: DEFAULT_BIOMES,
  biomeColors: DEFAULT_BIOME_COLORS,
  steep: DEFAULT_STEEP,
  tempScale: 0.0011, moistScale: 0.0014, tempLapse: 0.006,   // temperature/moisture noise scale; temperature drop per meter of altitude
  // terrain shape: 'hills' (default) | 'island' | 'canyon' plateau | 'flat' plain | 'heightmap' from a height map
  shape: 'hills',
  noise: { baseScale: 0.0035, baseAmp: 46, hillScale: 0.016, hillAmp: 10, mountainScale: 0.0018, mountainAmp: 900, mountainThreshold: 0.52, seaBias: 0.42 },
  island: { center: [0, 0], radius: 700, falloff: 350, depth: 30 },
  canyon: { scale: 0.004, depth: 40, plateau: 14 },
  // height map: { data: number array (row-major), width, height, size: [width m, length m], min, max, center: [x, z], outside } -- the terrain module reads the image and fills this in
  heightmap: null,
  // a game's own generator, pure functions (sent to workers as source: no outside variables): height(x, z, n) -> meters replaces the shape;
  // groundType(x, z, h, slope, n) -> type name, or null to fall back to the biome rules. n = { fbm(x, z, octaves), noise(x, z), hash(x, z, salt), seed }
  height: null,
  groundType: null,
  shading: 'smooth',   // 'smooth' blended per grid point | 'flat' one color and normal per triangle (the lowpoly pack sets this)
  // Colors belong to art and come from the style pack (style.terrain.colors); this is only the neutral gray fallback when there is no style pack (light/dark only)
  colors: {
    sand: 0xb8b8b8, meadowA: 0x8c8c8c, meadowB: 0x828282, forestA: 0x747474, forestB: 0x6c6c6c,
    savannaA: 0x9e9e9e, savannaB: 0x949494, wetland: 0x727272, riverbank: 0x808080,
    highGrass: 0x787878, rock: 0x8a8a8a, rockDark: 0x767676, snow: 0xe8e8e8, soil: 0x6e6e6e, soilWet: 0x5a5a5a,
  },
};

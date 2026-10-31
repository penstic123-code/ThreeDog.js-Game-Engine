// Terrain defaults: the parameters of the machinery (chunks, flatten, height map, a game's own generator, colors). Pure data, no three.js
// dependency (the Worker reads it too). The engine has no built-in landform or ground types: without a height function (or a height map) the
// ground is flat at y = 0; generators such as noise hills and biome tables are presets a game passes in (e.g. terrainPreset() from
// @threedog/style-lowpoly) or its own height / groundType functions.
export const DEFAULT_TERRAIN = {
  seed: 1337,
  chunkSize: 64,       // chunk edge length (m)
  resolution: 16,      // cells per chunk; smaller is more "low-poly"
  waterLevel: 0,
  flatten: [],         // flattened plots: [{ x, z, radius, height? }], for villages and houses
  // height map: { url | data: number array (row-major), width, height, size: [width m, length m], min, max, center: [x, z], outside } -- the terrain module reads the image and fills in data
  heightmap: null,
  // a game's own generator, pure functions (sent to workers as source: no outside variables): height(x, z, n) -> meters;
  // groundType(x, z, h, slope, n) -> type name (null = 'default'). n = { fbm(x, z, octaves), noise(x, z), hash(x, z, salt), seed, waterLevel, params }
  height: null,
  groundType: null,
  params: null,        // plain data handed to height / groundType as n.params (a preset's settings); must be serializable
  shading: 'smooth',   // 'smooth' blended per grid point | 'flat' one color and normal per triangle
  // Colors are art and come from the style pack (style.terrain): colors palette name -> color, biomeColors ground type -> palette names
  // (two are blended by noise), steep [{ maxNormalY, colors }] slope colors. Empty here: every ground type is the neutral gray fallback
  colors: {},
  biomeColors: {},
  steep: [],
};

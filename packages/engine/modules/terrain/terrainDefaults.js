// Terrain defaults: the parameters of the machinery (chunks, flatten, height map, a game's own generator, colors). Pure data, no three.js
// dependency (the Worker reads it too). The engine has no built-in landform or ground types: without a height function (or a height map) the
// ground is flat at y = 0; generators such as noise hills and biome tables are presets a game passes in (e.g. terrainPreset() from
// @threedog/terrain-noise) or its own height / groundType functions.
export const DEFAULT_TERRAIN = {
  seed: 1337,
  chunkSize: 64,       // chunk edge length (m)
  resolution: 16,      // cells per chunk; smaller is more "low-poly"
  waterLevel: -Infinity,   // no sea unless the game sets a level (terrainPreset() from @threedog/terrain-noise sets 0): water is world shape, not a default
  flatten: [],         // flattened plots: [{ x, z, radius, height? }], for villages and houses
  // height map: { url | data: number array (row-major), width, height, size: [width m, length m], min, max, center: [x, z], outside } -- the terrain module reads the image and fills in data
  heightmap: null,
  // a game's own generator, pure functions (sent to workers as source: no outside variables): height(x, z, n) -> meters;
  // groundType(x, z, h, slope, n) -> type name (null = 'default'). n = { fbm(x, z, octaves), noise(x, z), hash(x, z, salt), seed, waterLevel, params }
  height: null,
  groundType: null,
  params: null,        // plain data handed to height / groundType as n.params (a preset's settings); must be serializable
  // How the ground gets its color (look only; style.terrain.config may set shading, colorResolution, normals, normalFn):
  // 'smooth' blended per grid point | 'flat' one color and normal per triangle | 'texture' colors come from a per-chunk color map
  // (colorResolution pixels per chunk edge, independent of the mesh resolution; vertex colors are plain white then)
  shading: 'smooth',
  colorResolution: 128,   // texture mode: color map pixels per chunk edge (a border pixel is added on each side for seamless chunks)
  normals: null,       // texture mode only: lighting normals 'smooth' (default) | 'flat'; flat / smooth shading fix their own
  // pure function (i, j, h, cell) -> [nx, ny, nz] replacing the smooth normal at grid point (i, j); h(i, j) is a grid-point height
  // (null = central difference of the neighbors). Serialized to workers like height / groundType
  normalFn: null,
  // how each cell is cut into two triangles (shape, so it also moves engine.surface): 'fixed' the same diagonal everywhere |
  // 'adaptive' along the diagonal with the smaller height difference | 'alternate' flips every other cell
  diagonal: 'fixed',
  // World outline (null = ground everywhere): { mask, edge, side, bottom, voidY }, see terrainShape.js and recipes/42-terrain-shape.md.
  // mask (x, z, n) -> > 0 ground, pure like height; or a gray image { url | data, width, height, size: [w, l], center, threshold }
  shape: null,
  boundsPad: { up: 3, radius: 8 },   // chunk bounding sphere margin (m): center raised by up, radius grown by radius; raise for tall height-moving shaders
  // Colors are art and come from the style pack (style.terrain): colors palette name -> color, biomeColors ground type -> palette names
  // (two are blended by noise), steep [{ maxNormalY, colors }] slope colors. Empty here: every ground type is the neutral gray fallback
  colors: {},
  biomeColors: {},
  steep: [],
};

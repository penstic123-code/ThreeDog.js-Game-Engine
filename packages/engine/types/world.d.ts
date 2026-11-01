// World modules: terrain, vegetation, sky, weather, water.
import type { Object3D, Vector3, Color, Material, BufferGeometry, ColorLike, Handle, PositionLike } from './common';
import type { Engine, ModuleDef } from './core';
import type { StyleSky, StyleShadow, StyleFog } from './style';

// ======================================================================
// Terrain terrain()
// ======================================================================

/** Steep-slope colors: used when the normal's Y component is below maxNormalY */
export interface SteepRule { maxNormalY: number; colors: string[] }
/** Flattened plot (for villages, houses): center x/z, radius (meters), height optionally fixes the height */
export interface FlattenZone { x: number; z: number; radius: number; height?: number; clearRatio?: number }

/** Noise helpers handed to a custom height / groundType function (it cannot import anything) */
export interface TerrainNoise {
  fbm(x: number, z: number, octaves?: number): number; noise(x: number, z: number): number; hash(x: number, z: number, salt?: number): number; seed: number;
  /** The terrain's water level (meters; -Infinity when the terrain has no water) */
  waterLevel: number;
  /** terrain({ params }): plain data for the generator (a preset's settings) */
  params: Record<string, any>;
}

/** Options of engine.terrain.edit() */
export interface TerrainEditOptions {
  /** Meters, default half a cell. Heights snap to grid points and paint to cells inside the shape; the nearest one when the shape is smaller */
  radius?: number;
  /** Default 'circle' */
  shape?: 'circle' | 'square';
  /** Raise by meters (one of raise / lower / flatten) */
  raise?: number;
  /** Lower by meters (dig) */
  lower?: number;
  /** Set the height to this many meters (level a foundation) */
  flatten?: number;
  /** Paint the ground type ('tilled', 'wet', or a game's own with biomeColors[type]); null gives the cells back their generated type */
  paint?: string | null;
}

/**
 * World outline, terrain({ shape }): ground only where mask > 0, cut along straight lines through the cells where it crosses 0, with walls
 * down the rim (side) and optionally a hanging underside (bottom). Off it engine.surface is -Infinity, engine.ground.has false, slope 0,
 * groundType 'void'; nothing grows there; a fall below voidY emits terrain:void. Without shape the terrain is unchanged.
 * Depth and mask functions are pure like height (they run in workers). See recipes/42-terrain-shape.md.
 * @example terrain({ height: (x, z, n) => 6 * n.fbm(x * 0.02, z * 0.02), shape: { mask: (x, z) => 40 - Math.hypot(x, z),
 *   edge: { noise: 5, size: 14 }, side: { depth: 2, ground: 'cliff' }, bottom: { depth: (x, z, n, m) => 4 + m * 0.6, ground: 'rock' } } })
 */
export interface TerrainShape {
  /**
   * Where there is ground: (x, z, n) => number, > 0 ground (distance-like values in meters read best: 40 - Math.hypot(x, z) is a 40 m disc).
   * Or a gray image: whiter is ground, value = gray - threshold (default 0.5); outside the image is void.
   */
  mask: ((x: number, z: number, n: TerrainNoise) => number) | string
    | { url?: string; data?: ArrayLike<number>; width?: number; height?: number; size: number[]; center?: number[]; threshold?: number };
  /**
   * The rim's look. noise: meters of fbm added to the mask (a ragged outline), size: its wavelength in meters (default 16; keep it above a cell,
   * the cut cannot be finer than `resolution`); jitter: meters of per-grid-point random offset (a jagged rim); round: meters the top bends down
   * towards the rim (0 = a hard cliff edge)
   */
  edge?: { noise?: number; size?: number; jitter?: number; round?: number };
  /**
   * Wall down from the rim: depth meters (default 2) or (x, z, n) => meters; ground: color = biomeColors[ground] (default 'cliff');
   * material: a Material (or (engine) => Material) for sides and bottom
   */
  side?: { depth?: number | ((x: number, z: number, n: TerrainNoise) => number) | string; ground?: string;
    material?: Material | ((engine: Engine) => Material) };
  /**
   * Underside, below the side band: depth meters (default 4) or (x, z, n, m) => meters, m = mask value there (larger inland, so the middle
   * hangs lower); ground default 'rock'. Without it the island is open below
   */
  bottom?: { depth?: number | ((x: number, z: number, n: TerrainNoise, m: number) => number) | string; ground?: string } | null;
  /** Height below which a fall emits terrain:void (default 50 m under the lowest island chunk loaded so far); give it for replay-exact games */
  voidY?: number;
}

/** Terrain generation parameters (JSON-able; a custom height / groundType function is sent to workers as source text) */
export interface TerrainConfig {
  /** Random seed; the same seed gives the same terrain */
  seed: number;
  /** Chunk edge length (meters), default 64 */
  chunkSize: number;
  /** Cells per chunk; smaller is more "low poly", default 16 */
  resolution: number;
  /** Water level (meters), default -Infinity = no water (terrainPreset() from @threedog/terrain-noise sets 0) */
  waterLevel: number;
  /** Flattened plots */
  flatten: FlattenZone[];
  /** Ground type → palette color names (two are blended by noise); usually from style.terrain.biomeColors */
  biomeColors: Record<string, string[]>;
  /** Steep-slope color rule */
  steep: SteepRule[];
  /** Heightmap (used when there is no height function): url grayscale image, size [width m, length m], min/max height (meters), center [x, z] */
  heightmap: { url?: string; size?: number[]; min?: number; max?: number; center?: number[]; outside?: number; data?: ArrayLike<number>; width?: number; height?: number } | null;
  /**
   * Height generator: (x, z, n) => meters. Without one (and without a heightmap) the ground is flat at y = 0, a placeholder (dev warning).
   * Runs in workers, so it must be pure (only its parameters and globals like Math); an outside variable throws at terrain() naming it.
   * n = { fbm(x, z, octaves?), noise(x, z), hash(x, z, salt?), seed, waterLevel, params }. Flatten still applies. Presets: terrainPreset() from
   * @threedog/terrain-noise.
   * @example terrain({ height: (x, z, n) => 4 + 12 * n.fbm(x * 0.01, z * 0.01) })
   */
  height: ((x: number, z: number, n: TerrainNoise) => number) | string | null;
  /**
   * Ground type: (x, z, h, slope, n) => type name (null = 'default'). Pure, like height. Colors come from biomeColors[type]; vegetation rules and
   * footsteps match by name.
   * @example terrain({ groundType: (x, z, h, slope) => slope > 0.7 ? 'rock' : h < 2 ? 'beach' : 'grass' })
   */
  groundType: ((x: number, z: number, h: number, slope: number, n: TerrainNoise) => string | null) | string | null;
  /** Plain data handed to height / groundType as n.params (a preset's settings); must be serializable */
  params: Record<string, any> | null;
  /**
   * How the ground gets its color: 'smooth' (default) blended per grid point | 'flat' one color and normal per triangle (low poly) |
   * 'texture' per-chunk color map sampled per pixel, so color borders (a river bank) are not confined to triangle edges and the mesh can stay coarse.
   * See recipes/37-terrain-look-hooks.md. A style may set it (style.terrain.config.shading).
   */
  shading: 'flat' | 'smooth' | 'texture';
  /** Texture shading: color map pixels per chunk edge (default 128, 64 on low-tier devices; independent of `resolution`). A style may set it */
  colorResolution: number;
  /** Texture shading only: lighting normals 'smooth' (default) | 'flat'. A style may set it */
  normals: 'smooth' | 'flat' | null;
  /**
   * Replace the smooth normal at grid point (i, j): (i, j, h, cell) => [nx, ny, nz] (any length; the engine normalizes). h(i, j) is a grid-point
   * height, cell the grid spacing in meters. Pure, like height (workers get its source). Default: central difference of the neighbors.
   * @example terrain({ normalFn: (i, j, h, cell) => [(h(i - 1, j) - h(i + 1, j)) / (2 * cell), 2, (h(i, j - 1) - h(i, j + 1)) / (2 * cell)] })   // flatter lighting
   */
  normalFn: ((i: number, j: number, h: (i: number, j: number) => number, cell: number) => number[]) | string | null;
  /**
   * How each cell is cut into two triangles: 'fixed' (default, the same diagonal everywhere) | 'adaptive' (along the diagonal with the smaller
   * height difference, fewer zigzag ridges on slopes) | 'alternate' (flips every other cell). It is shape: engine.surface follows it. World setting, not style
   */
  diagonal: 'fixed' | 'adaptive' | 'alternate';
  /** Chunk bounding sphere margin in meters (default { up: 3, radius: 8 }): center raised by `up`, radius grown by `radius`. Raise it when a shader moves vertices far */
  boundsPad: { up?: number; radius?: number };
  /** World outline (default null = ground everywhere): an island, a floating rock, a coastline that ends. World setting, not style */
  shape: TerrainShape | null;
  /** Palette: color name → color */
  colors: Record<string, ColorLike>;
}

/** Parameters of terrain({...}) */
export interface TerrainOptions extends Partial<TerrainConfig> {
  /** View distance (in chunks), default 4 */
  viewChunks?: number;
  /** Vegetation density multiplier, default 1 */
  density?: number;
  /** true: the fog distance (engine.fogFar) follows the view distance so the far chunk edge fades out; default false keeps the game's fog (openWorld() sets true) */
  viewFog?: boolean;
  /** Ground material (default style.terrain.material, else the 'terrain' role with vertex colors); chunks have uv = world xz / chunk size. Cloud shadows and season tint are added */
  material?: Material | ((engine: Engine) => Material);
}

/** Pure-computation terrain returned by createTerrain() (draws nothing, only computes heights; usable before the engine exists, e.g. for previews) */
export interface TerrainGen {
  config: TerrainConfig;
  /** Chunk edge length (meters) */
  CHUNK: number;
  /** Cells per chunk */
  RES: number;
  /** Cell size (meters) */
  CELL: number;
  /** Water level (meters) */
  waterLevel: number;
  /** Ground height at (x, z) (meters); -Infinity off the outline of shape */
  surface(x: number, z: number): number;
  /** Is there ground at (x, z) (false only off the outline of shape) */
  has(x: number, z: number): boolean;
  /** Slope at (x, z) */
  slope(x: number, z: number): number;
  /** Ground type name ('default' without a groundType function) */
  biomeAt(x: number, z: number, h?: number, slope?: number): string;
  /** The noise helpers a height / groundType function receives (n), e.g. for a preset's riverAt(x, z, gen.noise) */
  noise: TerrainNoise;
  /** Fractal noise 0–1 */
  fbm(x: number, z: number, octaves?: number): number;
  buildChunk(cx: number, cz: number): any;
  place(cx: number, cz: number, rule: VegetationRule, density?: number): any;
}

/** engine.terrain: chunk manager */
export interface Terrain {
  engine: Engine;
  /** Pure-computation terrain (height, landform) */
  T: TerrainGen;
  /** Chunk edge length (meters) */
  readonly CHUNK: number;
  /**
   * terrain({ shape }) only: below this height the player or a moving rigid body has fallen out of the world (one terrain:void per fall).
   * shape.voidY, else 50 m under the lowest island chunk loaded so far; -Infinity without a shape
   * @example engine.events.on('terrain:void', ({ who }) => { if (who === engine.player) engine.player.placeAt(home); });
   */
  readonly voidY: number;
  /** Loaded chunks: 'cx,cz' → chunk */
  chunks: Map<string, any>;
  /** View distance (in chunks) */
  viewChunks: number;
  /** Vegetation density multiplier */
  density: number;
  /** Time budget (milliseconds) for uploading chunks per frame */
  applyBudgetMs: number;
  /** Statistics (for the debug panel) */
  stats: { builtThisFrame: number; applyMs: number; queued: number; visible?: number; loaded?: number; instances?: number };
  /** Change the view distance (in chunks); fog and camera far plane adjust too */
  setViewChunks(n: number): void;
  /** Change the vegetation density (rebuilds all chunks) */
  setDensity(d: number): void;
  /** Rebuild all chunks */
  rebuild(): void;
  /** Grid spacing (meters) = chunkSize / resolution: edits snap to it, paint colors whole cells of this size */
  readonly cellSize: number;
  /**
   * Change the ground: dig, raise, flatten, paint the ground type. Saved gameplay state: call it from an op or a fixed step.
   * engine.surface / slope / groundType, collision, paths and vegetation follow at once; it is saved, and chunks generated later come out edited.
   * @example
   * engine.terrain.edit(pos, { radius: 3, lower: 1.5 });                                                   // dig a pit
   * engine.terrain.edit(pos, { shape: 'square', radius: engine.terrain.cellSize / 2, paint: 'tilled' });  // till one cell
   * @experimental
   */
  edit(position: PositionLike, opts: TerrainEditOptions): { heights: number; cells: number };
  /** Whether the chunks within rings rings (default 1) around position are all loaded */
  isReadyAround(position: PositionLike, opts?: { rings?: number }): boolean;
}

// ======================================================================
// Vegetation vegetation()
// ======================================================================

/** Vegetation placement rule (must be JSON-able, no functions) */
export interface VegetationRule {
  /** Placement attempts per chunk, default 100 */
  perChunk?: number;
  /** Success probability of each attempt 0–1 (when cluster is 'none'), default 1 */
  chance?: number;
  /** Altitude range (meters); default unlimited both ways (a terrain game names its band above the water, e.g. minHeight: 1.5) */
  minHeight?: number;
  maxHeight?: number;
  /** Max slope */
  maxSlope?: number;
  /** Clustering: 'forest' grows into woods | 'meadow' grows in open ground | 'none' even */
  cluster?: 'forest' | 'meadow' | 'none';
  /** Size range [min, max] multiplier */
  scale?: number[];
  /** Height stretch [min, max] multiplier */
  stretch?: number[];
  /** How deep to bury into the ground (meters, multiplied by size) */
  sink?: number;
  /** Random color jitter 0–1 */
  tintJitter?: number;
  /** Special color: color [r, g, b] multiplier, chance probability */
  tints?: { color: number[]; chance: number }[];
  /**
   * Which ground types it grows on: { type: probability 0–1 } (engine.groundType: a terrain groundType, a level mesh's groundType property or material
   * name); omitted = grows anywhere
   */
  biomes?: Record<string, number> | null;
  /** Collision circle radius (meters, multiplied by size), 0 = no collision */
  collider?: number;
  /** Avoid flattened plots (villages), default true */
  avoidFlat?: boolean;
  /** Random seed offset (default computed from the name) */
  salt?: number;
}
/** Parameters of engine.vegetation.add(name, {...}) */
export interface VegetationOptions {
  /** High-detail model (this or model is required) */
  geometry?: BufferGeometry;
  /** Multi-material model (one material per mesh, e.g. bark trunk + leaf cards); still one InstancedMesh per species. Its materials are cloned */
  model?: Object3D;
  /** Low-detail model, switched to beyond lodRing rings; with model an Object3D with the same mesh order, or a geometry drawn with the first material */
  lodGeometry?: BufferGeometry | Object3D;
  /** Placement rule */
  rule?: VegetationRule;
  /** Wind sway amplitude, 0 = still */
  wind?: number;
  /** Only generated near the player (grass, flowers) */
  nearOnly?: boolean;
  /** No longer drawn beyond this many rings */
  maxRing?: number;
  /**
   * Distance fade of a near-only species (grass, flowers, pebbles, debris ...): instances shrink out over a band in metres from the player instead of popping
   * per chunk at the ring edge. Default for nearOnly: end = maxRing x chunk size, start = 65% of it. `false` keeps the hard ring edge (also the default for
   * species that are not nearOnly). Part of the species' own material (no extra draw call or shader), works with wind and shadows
   */
  fade?: false | { start?: number; end?: number };
  /** Switch to the low-detail model beyond this many rings, default 1 */
  lodRing?: number;
  /** Cast shadows */
  castShadow?: boolean;
  /** Cast shadows within this many rings */
  shadowRing?: number;
  /** Receive shadows, default true */
  receiveShadow?: boolean;
  /** Custom material, any three.js material (default: the style pack's 'vegetation' role); wind, cloud shadows and season tint are added to it */
  material?: Material;
  /** false: leave a custom material untouched (no wind / clouds / season added) */
  effects?: boolean;
  /** Double-sided rendering */
  doubleSided?: boolean;
}
/** A registered kind of vegetation */
export interface Species {
  name: string; geometry: BufferGeometry; lodGeometry: BufferGeometry | null; rule: VegetationRule;
  nearOnly: boolean; maxRing: number; fade: { start: number; end: number } | null; lodRing: number; castShadow: boolean; shadowRing: number; receiveShadow: boolean; material: Material | Material[];
}
/** A found plant: species name, chunk cx/cz, stable id, world coordinates position */
export interface VegetationHit { species: string; cx: number; cz: number; id: number; position: Vector3 }
export interface VegetationRemoveEvent { species: string; cx: number; cz: number; id: number }

/** vegetation({...}): only without terrain (with terrain these are terrain options and are refused) */
export interface VegetationModuleOptions {
  /** Chunk edge (meters), default 32 */
  chunkSize?: number;
  /** Rings of chunks drawn around each stream source, default 3 */
  viewChunks?: number;
  /** Placement attempts multiplier, default 1 */
  density?: number;
  /** Where it may grow: { min: [x, z], max: [x, z] }; default anywhere the ground is */
  area?: { min: number[]; max: number[] } | null;
  /** Placement seed, default 1 */
  seed?: number;
}

/** engine.vegetation */
export interface Vegetation {
  /**
   * Place every chunk again: after changing the ground behind the same provider (a ground function reading game state). A new setGround or level is
   * followed automatically
   */
  rebuild(): void;
  /**
   * Change at runtime how far a vegetation kind casts shadows: within `ring` chunk rings of the player (0 = only the chunk you stand in, 1 = the default,
   * larger = further and dearer). Takes effect at once; the add() option shadowRing is only the starting value. An unknown name warns with the known ones
   * @example engine.vegetation.setShadowRing('tree', 0);   // graphics setting "shadows: low": trees shadow only the nearest chunk
   */
  setShadowRing(name: string, ring: number): void;
  /** Register a kind of vegetation */
  add(name: string, opts: VegetationOptions): Species;
  get(name: string): Species | undefined;
  list(): Species[];
  isRemoved(species: string, cx: number, cz: number, id: number): boolean;
  /**
   * Remove one (chop a tree). regrowSeconds: grows back after this many game seconds, 0 = permanent. The record is saved with the save (save key
   * 'vegetation'). Returns the entry name
   */
  removeInstance(species: string, cx: number, cz: number, id: number, opts?: { regrowSeconds?: number }): string;
  /** Restore one */
  restoreInstance(species: string, cx: number, cz: number, id: number): void;
  /** The one nearest to position within radius meters (default 2) (species restricts to one kind), null if none */
  instanceAt(position: PositionLike, opts?: { radius?: number; species?: string | null }): VegetationHit | null;
}

// ======================================================================
// Sky sky()
// ======================================================================

/** What engine.sky.environment reports */
export interface SkyEnvironmentInfo { source: string, intensity: number, rotation: number, interval: number, builds: number }

export interface SkyOptions extends Omit<StyleSky, 'fog'> {
  /**
   * Who owns scene.fog: true (default; the sky creates it and writes color and distance every frame) | 'manual' (created once, then never written:
   * the game sets its color / near / far or its own object) | false (scene.fog = null, never touched). An object is style.sky.fog settings (kind,
   * color, density...) and means true. A sky() option, not a style key. Custom kinds / glsl share the page's shader chunks: a second engine needs
   * the same setting or it throws. See recipes/38
   * @example sky({ fog: 'manual' })   // the game manages scene.fog itself
   */
  fog?: boolean | 'manual' | StyleFog;
  /** Time of day at start: fraction of a day 0–1 (0.5 noon), default 0.33 (afterwards read / write engine.sky.timeOfDay) */
  time?: number;
  /** Game seconds per day, default Infinity: the time of day never moves until the game sets a length (presets.calendar.cycle has 360) (one sky hour = dayLength / hoursPerDay game seconds; with timeScale 1 game seconds are fixed-step seconds); Infinity = the time of day never moves */
  dayLength?: number;
  /** Hours per day of the displayed clock and of clock notation ('18:30'), default 24. Gameplay timing, so a sky() option and not a style key */
  hoursPerDay?: number;
  /** Which day to start from, default 1 */
  day?: number;
  /** Days of each season given by name only, default 7 */
  daysPerSeason?: number;
  /**
   * The calendar's seasons, default none ([]): names (each daysPerSeason days) or { name, days } for seasons of their own length, e.g. ['spring',
   * 'summer', 'autumn', 'winter']
   */
  seasons?: (string | { name: string, days: number })[];
  /**
   * Whether the sky drives engine.lights.sun: true (default; color, intensity, direction and shadow box from the keyframes) | 'manual' (still aimed
   * along the time of day with the shadow box; color and intensity are the game's) | false (hidden, never touched: light the world with your own
   * three.js lights). How the game lights its world, so a sky() option, not a style key. See recipes/38
   * @example sky({ sun: false, hemisphere: false })   // a dungeon lit by the game's own lights
   */
  sun?: boolean | 'manual';
  /** Same for engine.lights.hemi (ambient): true (default) | 'manual' (colors and intensity are the game's) | false (hidden) */
  hemisphere?: boolean | 'manual';
}
/** Parameters of sky.at() / daily() */
export interface SkyAtOptions {
  /** Only fire on these days: a list of days, or (day) => whether to fire */
  days?: number[] | ((day: number) => boolean);
  /** When one advance crosses several trigger points: 'all' fire them all | 'once' fire once (default) | 'skip' do not make up */
  catchUp?: 'all' | 'once' | 'skip';
}
/** Callback of sky.between: on is called when entering the period, off when leaving it */
export interface SkyBetweenOptions {
  /** Entering the period (or found inside it when aligned) */
  on?: () => void;
  /** Leaving the period (or found outside it when aligned) */
  off?: () => void;
}
/** Sky modifiers: weather and other modules write them every frame, the sky layers them on its own result */
/** Sky modifiers (sky.modifiers is the combined result of all layers, read-only) */
export interface SkyModifiers {
  /** Sunlight multiplier (layers multiply) */
  readonly sun: number;
  /** Ambient light multiplier (layers multiply) */
  readonly ambient: number;
  /** Fog distance multiplier (layers multiply, smaller = denser fog) */
  readonly fog: number;
  /** Sky tint (layers blend weighted by tint amount) */
  readonly tint: Color;
  /** Zenith tint amount 0–1 */
  readonly tintAmount: number;
  /** Horizon tint amount 0–1 */
  readonly horizonTintAmount: number;
  /** Lightning brightness (layers take the max) */
  readonly flash: number;
}

/** One layer of sky.modify: write only what to change, omitted items have no effect */
export interface SkyLayer {
  /** Sunlight multiplier, default 1 */
  sun?: number;
  /** Ambient light multiplier, default 1 */
  ambient?: number;
  /** Fog distance multiplier, default 1 (smaller = denser fog) */
  fog?: number;
  /** Sky tint (color number or Color) */
  tint?: Color | number;
  /** Zenith tint amount 0–1, default 0 */
  tintAmount?: number;
  /** Horizon tint amount 0–1, default 0 */
  horizonTintAmount?: number;
  /** Lightning brightness, default 0 */
  flash?: number;
  /** Cover color laid over the foliage season tint (snow, ash, frost); null removes it. Rides the season patch, see recipes/47 */
  foliageCover?: Color | number | null;
  /** Cover color laid over the ground season tint */
  groundCover?: Color | number | null;
  /** How far toward the cover colors, 0–1, default 0 (style.weather.snow.cover drives the weather layer's from the snow amount) */
  coverAmount?: number;
}

// Sky (engine.sky) is generated from the JSDoc in modules/sky/Sky.js (npm run map); only the types are re-exported here
import type { Sky } from './generated/modules/sky/Sky';
export type { Sky };

// ======================================================================
// Weather weather()
// ======================================================================

/** Weather preset: intensities of about 0–1 */
export interface WeatherPreset {
  /** Cloud cover 0–1 */
  cloud: number;
  /** Sunlight multiplier */
  sun: number;
  /** Fog distance multiplier (smaller = denser fog) */
  fog: number;
  /** Wind multiplier */
  wind: number;
  /** Rain amount 0–1 */
  rain: number;
  /** Snow amount 0–1 */
  snow: number;
  /** How gray the sky turns 0–1 */
  grey: number;
  /** Thunder: above 0.5 it thunders */
  lightning: number;
}
/** A weather name from the game's table (weather() alone has only 'clear'; presets.weather.temperate brings seven) */
export type WeatherName = string;

export interface WeatherOptions {
  /** Starting weather, default 'clear' (or the first of the game's types when it has no 'clear') */
  start?: WeatherName;
  /** Automatic weather changes */
  auto?: boolean;
  /** Rain / snow particle count, default 6000 */
  particles?: number;
  /** The game's weather table, the whole list (default only a calm 'clear'; seven temperate ones in presets.weather.temperate.types, extend them with { ...presets.weather.temperate.types, dust: {...} }). Left-out fields are calm; extra numeric fields of the game's own blend too and show in weather.current */
  types?: Record<string, Partial<WeatherPreset> & Record<string, number>>;
  /** Candidates for automatic changes (repeat an entry for higher probability) */
  autoPool?: string[];
  /** Interval between automatic changes [shortest, longest] seconds */
  autoInterval?: number[];
  /** Transition seconds of automatic changes, default 25 */
  transition?: number;
  /** Rain / snow coverage (meters) */
  area?: number;
}

// Weather (engine.weather) is generated from the JSDoc in modules/weather/Weather.js (npm run map); only the types are re-exported here
import type { Weather } from './generated/modules/weather/Weather';
export type { Weather };

// ======================================================================
// Water water()
// ======================================================================

/**
 * Parameters of engine.addWaterBody(): position center, level water surface height (meters); give radius for a circle, halfWidth / halfDepth for a
 * rectangle
 */
export interface WaterBodyOptions {
  position: PositionLike;
  level: number;
  radius?: number;
  halfWidth?: number;
  halfDepth?: number;
}
/**
 * A standalone body of water (stored in engine.waterBodies and given by the water:add event, already converted): circle { x, z, radius, level } or
 * rectangle { x, z, hw, hd, level } (meters)
 */
export interface WaterBody {
  /** Center position (meters) */
  x: number; z: number;
  /** Water surface height (meters) */
  level: number;
  /** Radius of a circular body (meters) */
  radius?: number;
  /** Half width and half depth of a rectangular body (meters) */
  hw?: number; hd?: number;
}

export interface WaterOptions {
  /** false: do not draw the global water surface (sea) */
  sea?: boolean;
  /** Global water level (meters); if omitted, the terrain's water level is used */
  level?: number;
  color?: ColorLike;
  opacity?: number;
  flat?: boolean;
  waveHeight?: number;
  waveScale?: number;
  waveSpeed?: number;
  fresnel?: number;
  size?: number;
  segments?: number;
  normalMap?: string;
  normalScale?: number;
  normalRepeat?: number;
  normalSpeed?: number[];
  shininess?: number;
  specular?: ColorLike;
  /** Replace the whole surface material, same as style.water.material */
  material?: import('./style').StyleWater['material'];
  depthColor?: import('./style').StyleWater['depthColor'];
  foam?: import('./style').StyleWater['foam'];
  glsl?: import('./style').StyleWater['glsl'];
  uniforms?: import('./style').StyleWater['uniforms'];
}

// Water (engine.water) is generated from the JSDoc in modules/water/Water.js (npm run map); only the types are re-exported here
import type { Water } from './generated/modules/water/Water';
export type { Water };

// ======================================================================
// Module factories
// ======================================================================

// ======================================================================
// Distant merging hlod()
// ======================================================================

/** Parameters of hlod() (also the defaults of add()) */
export interface HlodOptions {
  /** Handle levels automatically (adds the level on level:loaded), default true */
  level?: boolean;
  /** Merge cell edge length (meters), default 64 */
  cell?: number;
  /** Beyond this distance (meters) the merged proxy is shown, default 160 */
  near?: number;
  /** Proxy casts shadows, default false */
  castShadow?: boolean;
  /** Which meshes to merge (return false to skip) */
  include?: (mesh: Object3D) => boolean;
}
/** Parameters of hlod.add() */
export interface HlodAddOptions {
  cell?: number;
  near?: number;
  castShadow?: boolean;
  /** Which meshes to merge (return false to skip) */
  include?: (mesh: Object3D) => boolean;
}
/** One merged cell: proxy is the merged proxy meshes, originals the original objects */
export interface HlodCell {
  /** Cell key 'x,z' */
  key: string;
  /** Merged proxy meshes (one per material) */
  proxy: Object3D[];
  /** Originals */
  originals: Object3D[];
  /** Average center of the originals (for distance) */
  center: Vector3;
  /** The proxy is currently shown */
  far: boolean;
}
/** Handle returned by hlod.add() */
export interface HlodHandle {
  cells: HlodCell[];
  /** Beyond this distance (meters) the proxy is shown */
  near: number;
  /** Are all proxies merged (done over several frames) */
  readonly ready: boolean;
  /** Promise that resolves when merging is done: await h.whenReady */
  whenReady: Promise<HlodHandle>;
  /** Cancel: restore the originals, free the proxies */
  remove(): void;
}
/** engine.hlod: merge a patch of distant objects into a few meshes to cut draw calls @experimental */
export interface Hlod {
  /** All merged cells */
  cells: HlodCell[];
  /** Register a group of objects (a root or an array), merged into proxies by cell */
  add(target: Object3D | Object3D[], opts?: HlodAddOptions): HlodHandle;
}

// ======================================================================
// Light pool engine.lightPool (lightPool() module)
// ======================================================================

/** Parameters of lightPool(): how many real lights exist (fixed for the whole game, so shaders never recompile) */
export interface LightPoolOptions {
  /** Real PointLights, default 8 */
  point?: number;
  /** Real SpotLights, default 0 (sources added with type: 'spot' use them) */
  spot?: number;
  /** How many of the point lights cast shadows, default 0; only sources added with castShadow: true get them */
  shadows?: number;
  /** Seconds between choosing which sources get the lights, default 0.1 (fading and following run every frame) */
  every?: number;
  /** Seconds a light takes to fade in or out when it moves to another source, default 0.3 */
  fade?: number;
  /** Measure distance from this object / position instead of the camera (e.g. the player in a top-down game) */
  focus?: PositionLike | null;
}
/** Options of lightPool.add(position, opts): one light source (a torch, lamp, campfire, muzzle flash...) */
export interface LightSourceOptions {
  /** Name shown in lightPool.usage() */
  name?: string;
  /** 'point' (default) or 'spot' (needs lightPool({ spot: n })) */
  type?: 'point' | 'spot';
  /** Light color, default white */
  color?: ColorLike;
  /** three.js intensity at full strength, default 1; 0 = off (it gives its light away) */
  intensity?: number;
  /** three.js light distance (range, meters), default 10; also the scale of the distance score */
  distance?: number;
  /** three.js decay, default 2 */
  decay?: number;
  /** Weight in the choice, default 1: 3 = picked over a 1 three times as bright at the same distance (a quest lamp, a muzzle flash) */
  priority?: number;
  /** May take one of the shadow-casting lights (lightPool({ shadows })), default false; fixed when added */
  castShadow?: boolean;
  /** Spot cone half-angle (radians), default PI / 4 */
  angle?: number;
  /** Spot penumbra 0-1, default 0.3 */
  penumbra?: number;
  /** Spot aim: a position or an Object3D it follows; default straight down */
  target?: PositionLike | null;
  /** Brightness factor each frame (time = presentation seconds, index = the source's number): (t, i) => 0.85 + 0.15 * Math.sin(t * 13 + i) */
  flicker?: ((time: number, index: number) => number) | null;
  /**
   * Stand-in shown while the source has no real light: a halo Sprite / Mesh (its material's opacity) or an emissive material (emissiveIntensity) scaled
   * from its value at add() down to 0 as the real light fades in. Give each source its own material
   */
  glow?: Material | Object3D | null;
}
/** What lightPool.add().set(patch) can change (type and castShadow are fixed when added) */
export interface LightSourcePatch {
  /** New position, or an Object3D to follow */
  position?: PositionLike;
  name?: string;
  color?: ColorLike;
  intensity?: number;
  distance?: number;
  decay?: number;
  priority?: number;
  angle?: number;
  penumbra?: number;
  target?: PositionLike | null;
  flicker?: ((time: number, index: number) => number) | null;
  glow?: Material | Object3D | null;
}
/** Handle returned by lightPool.add() */
export interface LightSource {
  /** The real light lighting this source now, null while it has none */
  readonly light: Object3D | null;
  /** How much of its light it has now, 0-1 */
  readonly weight: number;
  /** Change the source; returns the same handle */
  set(patch: LightSourcePatch): LightSource;
  /** Unregister: its light fades out and moves on, the stand-in is put back (safe to call twice) */
  remove(): void;
}
/** lightPool.usage(): what the pool is doing now */
export interface LightPoolUsage {
  /** Registered sources */
  sources: number;
  /** Real lights lighting a source now */
  lit: number;
  /** One per real light: its kind, whether it casts shadows, the source it holds (name or number, null = idle) and its fade 0-1 */
  slots: { type: 'point' | 'spot'; shadow: boolean; source: string | number | null; weight: number }[];
}
/** engine.lightPool: register any number of light sources; a fixed set of real lights moves to the most relevant ones */
export interface LightPool {
  /** The real three.js lights, created once at install and never added, removed or hidden (the pool sets their position, color, intensity) */
  readonly lights: Object3D[];
  /** Distance is measured from this object / position; null = the camera */
  focus: PositionLike | null;
  /**
   * Register a light source at a position (an Object3D: it follows that object every frame)
   * @example
   * const torch = engine.lightPool.add(torchMesh, { color: 0xffa040, intensity: 4, distance: 8, glow: haloSprite });
   * torch.set({ intensity: 0 });   // put out: its light goes to another torch
   */
  add(position: PositionLike, opts?: LightSourceOptions): LightSource;
  /** What the pool is doing now (also in describe().lightPool) */
  usage(): LightPoolUsage;
}

// ======================================================================
// Performance budget engine.budget (core, off by default)
// ======================================================================

/** Budget limits: only the given categories are checked. fps/low1 are lower bounds (frame rate must not drop below), the rest are upper bounds */
export interface BudgetLimits {
  /** Draw calls */
  drawCalls?: number;
  /** Average frame rate (lower bound) */
  fps?: number;
  /** Worst 1% frame rate (lower bound) */
  low1?: number;
  /** CPU milliseconds per frame */
  cpuMs?: number;
  /** Triangle count */
  triangles?: number;
  /** Texture count */
  textures?: number;
  /** Terrain chunk upload milliseconds per frame */
  chunkApplyMs?: number;
  /** Rigid body count */
  rigidBodies?: number;
  /** Per-frame cost of applying background results, by stage (engine.budget.cost): worker transit (approximate), creating three.js objects, colliders, GPU upload (approximate), stream build() */
  applyTransitMs?: number;
  applyBuildMs?: number;
  applyColliderMs?: number;
  applyUploadMs?: number;
  applyStreamMs?: number;
  /** Time from opening to playable (milliseconds); when exceeded, the slowest module is named */
  startupMs?: number;
  /** Single module startup (init + wait for ready, milliseconds); when exceeded, that module is named */
  moduleMs?: number;
  /** Custom module categories (registered via budget.metric) */
  [metric: string]: number | undefined;
}
/** One overrun: top is the biggest draw-call contributors grouped by userData.budgetTag */
export interface BudgetOver { category: string; value: number; limit: number; top: BudgetTagStat[] }
/** A category estimated by userData.budgetTag: 'terrain', 'vegetation', 'hlod', 'sky', 'weather', untagged 'other'… */
export interface BudgetTagStat { tag: string; drawCalls: number; triangles: number }
/** Budget report: ok means everything is within budget */
export interface BudgetReport { ok: boolean; over: BudgetOver[] }
// Budget (engine.budget) is generated from the JSDoc in core/Budget.js (npm run map); only the types are re-exported here
import type { Budget } from './generated/core/Budget';
export type { Budget };

export type TerrainModule = ModuleDef<Terrain>;
export type VegetationModule = ModuleDef<Vegetation>;
export type SkyModule = ModuleDef<Sky>;
export type WeatherModule = ModuleDef<Weather>;
export type WaterModule = ModuleDef<Water>;

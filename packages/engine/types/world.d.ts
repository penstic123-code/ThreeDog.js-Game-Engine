// World modules: terrain, vegetation, sky, weather, water.
import type { Object3D, Vector3, Color, Material, BufferGeometry, ColorLike, Handle, PositionLike } from './common';
import type { Engine, ModuleDef } from './core';
import type { StyleSky, StyleShadow } from './style';

// ======================================================================
// Terrain terrain()
// ======================================================================

/** Landform rule: checked from top to bottom, the first one satisfied is the landform at that spot (leave the last one without conditions as the default). All conditions are optional */
export interface BiomeCondition {
  /** Min / max altitude (meters) */
  minHeight?: number;
  maxHeight?: number;
  /** Max height above the water surface */
  maxAboveWater?: number;
  /** Min slope */
  minSlope?: number;
  /** Temperature 0–1 */
  minTemp?: number;
  maxTemp?: number;
  /** Humidity 0–1 */
  minMoist?: number;
  maxMoist?: number;
  /** Closeness to a river (0–1) */
  minRiver?: number;
}
export interface BiomeRule extends BiomeCondition {
  /** Landform name (vegetation rules and footsteps match by name) */
  name: string;
  /** Satisfying any one of these condition groups is enough */
  any?: BiomeCondition[];
}
/** Steep-slope colors: used when the normal's Y component is below maxNormalY */
export interface SteepRule { maxNormalY: number; colors: string[] }
/** Flattened plot (for villages, houses): center x/z, radius (meters), height optionally fixes the height */
export interface FlattenZone { x: number; z: number; radius: number; height?: number; clearRatio?: number }

/** Noise helpers handed to a custom height / groundType function (it cannot import anything) */
export interface TerrainNoise { fbm(x: number, z: number, octaves?: number): number; noise(x: number, z: number): number; hash(x: number, z: number, salt?: number): number; seed: number }

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

/** Terrain generation parameters (JSON-able; a custom height / groundType function is sent to workers as source text) */
export interface TerrainConfig {
  /** Random seed; the same seed gives the same terrain */
  seed: number;
  /** Chunk edge length (meters), default 64 */
  chunkSize: number;
  /** Cells per chunk; smaller is more "low poly", default 16 */
  resolution: number;
  /** Water level (meters), default 0 */
  waterLevel: number;
  /** Overall relief multiplier */
  heightScale: number;
  /** Mountain strength */
  mountains: number;
  /** Whether to generate rivers */
  rivers: boolean;
  /** River width (0.02 narrow, 0.05 wide) */
  riverWidth: number;
  /** Flattened plots */
  flatten: FlattenZone[];
  /** Landform rules */
  biomes: BiomeRule[];
  /** Landform → palette color name */
  biomeColors: Record<string, string[]>;
  /** Steep-slope color rule */
  steep: SteepRule[];
  /** Temperature / humidity noise scale */
  tempScale: number;
  moistScale: number;
  /** Temperature drop per meter of altitude */
  tempLapse: number;
  /** Shape: 'hills' | 'island' | 'canyon' (mesas) | 'flat' plains | 'heightmap' */
  shape: 'hills' | 'island' | 'canyon' | 'flat' | 'heightmap';
  /** Noise parameters */
  noise: { baseScale?: number; baseAmp?: number; hillScale?: number; hillAmp?: number; mountainScale?: number; mountainAmp?: number; mountainThreshold?: number; seaBias?: number };
  /** Island shape: center [x, z], radius, falloff (meters), depth seabed depth */
  island: { center?: number[]; radius?: number; falloff?: number; depth?: number };
  /** Canyon shape */
  canyon: { scale?: number; depth?: number; plateau?: number };
  /** Heightmap: url grayscale image, size [width m, length m], min/max height (meters), center [x, z] */
  heightmap: { url?: string; size?: number[]; min?: number; max?: number; center?: number[]; outside?: number; data?: ArrayLike<number>; width?: number; height?: number } | null;
  /**
   * Own height generator, replaces shape: (x, z, n) => meters. Runs in workers, so it must be pure (only its parameters and globals like Math);
   * an outside variable throws at terrain() naming it. n = { fbm(x, z, octaves?), noise(x, z), hash(x, z, salt?), seed }. Rivers and flatten still apply.
   * @example terrain({ height: (x, z, n) => 4 + 12 * n.fbm(x * 0.01, z * 0.01), rivers: false })
   */
  height: ((x: number, z: number, n: TerrainNoise) => number) | string | null;
  /**
   * Own ground type: (x, z, h, slope, n) => type name, or null to use the biome rules. Pure, like height. Colors come from biomeColors[type].
   * @example terrain({ groundType: (x, z, h, slope) => slope > 0.7 ? 'rock' : h < 2 ? 'beach' : null })
   */
  groundType: ((x: number, z: number, h: number, slope: number, n: TerrainNoise) => string | null) | string | null;
  /** 'flat' one color per triangle (low poly) | 'smooth' smooth shading */
  shading: 'flat' | 'smooth';
  /** Palette: color name → color */
  colors: Record<string, ColorLike>;
}

/** Parameters of terrain({...}) */
export interface TerrainOptions extends Partial<TerrainConfig> {
  /** View distance (in chunks), default 4 */
  viewDistance?: number;
  /** Vegetation density multiplier, default 1 */
  density?: number;
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
  /** Ground height at (x, z) (meters) */
  surface(x: number, z: number): number;
  /** Slope at (x, z) */
  slope(x: number, z: number): number;
  /** Landform name */
  biomeAt(x: number, z: number, h?: number, slope?: number): string;
  /** Closeness to a river: 0 not by the river, larger is closer to the middle of the river */
  riverFactor(x: number, z: number): number;
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
  /** Loaded chunks: 'cx,cz' → chunk */
  chunks: Map<string, any>;
  /** View distance (in chunks) */
  viewDistance: number;
  /** Vegetation density multiplier */
  density: number;
  /** Time budget (milliseconds) for uploading chunks per frame */
  applyBudgetMs: number;
  /** Statistics (for the debug panel) */
  stats: { builtThisFrame: number; applyMs: number; queued: number; visible?: number; loaded?: number; instances?: number };
  /** Change the view distance (in chunks); fog and camera far plane adjust too */
  setViewDistance(n: number): void;
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
   */
  edit(position: PositionLike, opts: TerrainEditOptions): { heights: number; cells: number };
  /** Whether the chunks within rings rings (default 1) around position are all loaded */
  isReadyAround(position: PositionLike, opts?: { rings?: number }): boolean;
  forEachCollider(x: number, z: number, range: number, fn: (cx: number, cz: number, r: number) => void): void;
  chunkCollision(cx: number, cz: number): any;
  refreshLevels(): void;
  registerSpecies(name: string, rule: VegetationRule): void;
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
  /** Altitude range (meters) */
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
  /** Which landforms it grows on: { landform name: probability 0–1 }; omitted = grows anywhere */
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
  nearOnly: boolean; maxRing: number; lodRing: number; castShadow: boolean; shadowRing: number; receiveShadow: boolean; material: Material | Material[];
}
/** A found plant: species name, chunk cx/cz, stable id, world coordinates position */
export interface VegetationHit { species: string; cx: number; cz: number; id: number; position: Vector3 }
export interface VegetationRemoveEvent { species: string; cx: number; cz: number; id: number }

/** engine.vegetation */
export interface Vegetation {
  /** Register a kind of vegetation */
  add(name: string, opts: VegetationOptions): Species;
  get(name: string): Species | undefined;
  list(): Species[];
  baseNames(): string[];
  nearNames(): string[];
  /** Entry name in the save 'veg:<name>:<cx>,<cz>:<id>' */
  key(species: string, cx: number, cz: number, id: number): string;
  isRemoved(species: string, cx: number, cz: number, id: number): boolean;
  /** Remove one (chop a tree). regrowSeconds: grows back after this many game seconds, 0 = permanent. The record is saved with the save (save key 'vegetation'). Returns the entry name */
  removeInstance(species: string, cx: number, cz: number, id: number, opts?: { regrowSeconds?: number }): string;
  /** Restore one */
  restoreInstance(species: string, cx: number, cz: number, id: number): void;
  /** The one nearest to position within radius meters (default 2) (species restricts to one kind), null if none */
  instanceAt(position: PositionLike, opts?: { radius?: number; species?: string | null }): VegetationHit | null;
  /** Set from which chunk ring on this vegetation stops casting shadows (smaller saves more), takes effect immediately */
  setShadowRing(name: string, ring: number): void;
}

// ======================================================================
// Sky sky()
// ======================================================================

export interface SkyOptions extends StyleSky {
  /** Time of day at start: fraction of a day 0–1 (0.5 noon), default 0.33 (afterwards read / write engine.sky.timeOfDay) */
  time?: number;
  /** Game seconds per day, default 360 (one sky hour = dayLength / 24 game seconds; with timeScale 1 game seconds are fixed-step seconds) */
  dayLength?: number;
  /** Which day to start from, default 1 */
  day?: number;
  /** Days per season, default 7 */
  daysPerSeason?: number;
  /** Season name list, default ['spring', 'summer', 'autumn', 'winter'] */
  seasons?: string[];
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
/** Built-in weather names */
export type WeatherName = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'snow' | 'fog';

export interface WeatherOptions {
  /** Starting weather, default 'clear' */
  start?: WeatherName | (string & {});
  /** Automatic weather changes */
  auto?: boolean;
  /** Rain / snow particle count, default 6000 */
  particles?: number;
  /** Add / override weather presets */
  presets?: Record<string, Partial<WeatherPreset>>;
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

/** Parameters of engine.addWaterBody(): position center, level water surface height (meters); give radius for a circle, halfWidth / halfDepth for a rectangle */
export interface WaterBodyOptions {
  position: PositionLike;
  level: number;
  radius?: number;
  halfWidth?: number;
  halfDepth?: number;
}
/** A standalone body of water (stored in engine.waterBodies and given by the water:add event, already converted): circle { x, z, radius, level } or rectangle { x, z, hw, hd, level } (meters) */
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
/** engine.hlod: merge a patch of distant objects into a few meshes to cut draw calls */
export interface Hlod {
  /** All merged cells */
  cells: HlodCell[];
  /** Register a group of objects (a root or an array), merged into proxies by cell */
  add(target: Object3D | Object3D[], opts?: HlodAddOptions): HlodHandle;
  /** Switch by focus right now (normally automatic every 0.25 s) */
  update(): void;
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

// Style pack (style): looks only (render / post, materials and shaders, sky, lighting, environment colors, particle looks, UI look). Every item is optional;
// the engine ships no art and falls back to neutral gray placeholders for what is omitted. Not here: sounds (createEngine({ audio })), model and texture
// files or generators (asset packs, engine.assets.manifest), gameplay data (content packs, engine.content.load). A style may be a list of parts (StyleInput).
// Example: the optional @threedog/style-lowpoly package (packages/styles/lowpoly/index.js).
import type { ColorLike, BufferGeometry, Object3D, Material, Loose } from './common';
import type { Engine } from './core';
import type { TerrainConfig, SteepRule, WeatherPreset } from './world';
import type { ParticleOptions, CharacterRig } from './gameplay';

/** Material finish: 'lambert' matte | 'phong' with highlights | 'standard' realistic | 'physical' | 'toon' cel-shaded steps | 'basic' unlit */
export type MaterialType = Loose<'lambert' | 'phong' | 'standard' | 'physical' | 'toon' | 'basic'>;
/** Material parameters for one role (other fields are set on the three.js material as is, e.g. roughness, shininess, specular) */
export interface MaterialSpec {
  /** Material type, default 'lambert' */
  type?: MaterialType;
  /** Number of light/dark steps for the toon type, default 3 */
  steps?: number;
  color?: ColorLike;
  [prop: string]: any;
}

/** Sky keyframe: [time 0–1, zenith color, horizon color (= fog color), sun color, sun intensity, ambient intensity] */
export type SkyKeyframe = (number | ColorLike)[];

export interface StyleSky {
  /** Colors and light intensities at each time of day */
  keyframes?: SkyKeyframe[];
  /** Larger means a smaller sun, default 900 */
  sunSize?: number;
  /** Sun glow, default 0.18 */
  sunGlow?: number;
  /** Sun brightness, default 6 */
  sunBrightness?: number;
  /** Larger means a smaller moon */
  moonSize?: number;
  moonColor?: ColorLike;
  moonBrightness?: number;
  /** North-south tilt of the sun path */
  orbitTilt?: number;
  /** East-west swing of the sun path */
  orbitSway?: number;
  /** Star density */
  starDensity?: number;
  /** Larger means smaller and more numerous stars */
  starScale?: number;
  /** Gradient curve from zenith to horizon */
  gradientCurve?: number;
  /** Ground bounce color of the ambient light */
  groundTint?: ColorLike;
  /** Clouds in the sky (cloud cover follows the weather) */
  clouds?: { color?: ColorLike; shade?: ColorLike; coverage?: number; scale?: number; speed?: number[] };
  /** Panorama (equirectangular) replacing the gradient sky, asset name or path */
  skybox?: string;
  /** Shadows: mapSize resolution (pixels), extent coverage (meters), etc., see StyleShadow */
  shadow?: StyleShadow;
}

/** Sun shadow parameters (defaults are the current look) */
export interface StyleShadow {
  /** Shadow resolution (pixels), default 2048 */
  mapSize?: number;
  /** Coverage radius (meters), default 70 */
  extent?: number;
  /** Distance of the light from the shadow center (meters), default 160 */
  distance?: number;
  /** Anti shadow-acne bias, default -0.0006 */
  bias?: number;
  /** Normal-offset anti-acne, default 0.04 */
  normalBias?: number;
  /** Update shadows every N frames, default 1 (every frame); larger saves more, still updates promptly when the focus moves */
  updateEvery?: number;
  /** Shadow center snapping grid (meters), default 0.5; 'texel' snaps to shadow pixels (shadow edges do not shimmer while moving) */
  snap?: number | 'texel';
  /** How far ahead of the view direction the shadow center is shifted (meters), default 0 */
  ahead?: number;
  /**
   * Overrides used on low-tier devices (engine.tier 'low'), default { mapSize: 1024 }. updateEvery above 1 saves more but makes
   * wind-swayed shadows step visibly. sky({ shadow }) options replace the whole shadow block, low included.
   */
  low?: Omit<StyleShadow, 'low'>;
}

export interface StyleWeather {
  /** Rain / snow coverage (meters, centered on the camera) */
  area?: number;
  /** Target color the sky turns to when overcast */
  overcastColor?: ColorLike;
  /** Lightning brightness multiplier */
  lightningBrightness?: number;
  /** Rain: color, opacity, streak length (meters), fall speed (m/s), slant; texture uses a textured raindrop instead */
  rain?: { color?: ColorLike; opacity?: number; length?: number; speed?: number; slant?: number; texture?: string | null; size?: number; maxSize?: number };
  /** Snow: color, opacity, size, max pixels, fall speed (m/s), snowflake texture */
  snow?: { color?: ColorLike; opacity?: number; size?: number; maxSize?: number; speed?: number; texture?: string | null };
  /** Retune the look of weather types the game has (e.g. a darker storm); never adds a type: the list is the game's weather({ types }) */
  types?: Record<string, Partial<WeatherPreset>>;
}

export interface StyleWater {
  /**
   * Replace the whole water surface material (the built-in role 'water', waves and fresnel are skipped). Receives the shared
   * uniforms (uTime, uWave, uWaveScale, uWaveSpeed), the built-in wave patch and the scrolling normal map (null without one).
   * @example material: (engine, { waves }) => applyEffects(new THREE.MeshToonMaterial({ color: 0x3a8acf }), { clouds: false, patches: [waves] })
   */
  material?: (engine: Engine, ctx: { uniforms: Record<string, { value: any }>; waves: import('./generated/render/patches').ShaderPatch; normalMap: import('three').Texture | null }) => Material;
  color?: ColorLike;
  /** Opacity 0–1 */
  opacity?: number;
  /** Flat shading (low poly) */
  flat?: boolean;
  /** Wave height multiplier */
  waveHeight?: number;
  waveScale?: number;
  waveSpeed?: number;
  /** Grazing-angle reflection strength 0–1 */
  fresnel?: number;
  /** Normal map (asset name or path) */
  normalMap?: string;
  normalScale?: number;
  normalRepeat?: number;
  /** Normal map flow speed [x, z] */
  normalSpeed?: number[];
  shininess?: number;
  specular?: ColorLike;
  /** Global water mesh size (meters) and segment count */
  size?: number;
  segments?: number;
  /** Global water level (meters); if omitted, the terrain's water level is used */
  level?: number;
  /** false: do not draw the global water */
  sea?: boolean;
}

export interface StyleTerrain {
  /** Palette: color name → color (e.g. sand, meadowA, rock) */
  colors?: Record<string, ColorLike>;
  /** Landform → palette color name (two names are blended by noise) */
  biomeColors?: Record<string, string[]>;
  /** Color rule for steep slopes */
  steep?: SteepRule[];
  /** Default terrain parameters (overridden by terrain({...})) */
  config?: Partial<TerrainConfig>;
  /** Whole ground material: a Material or (engine) => Material (uv = world xz / chunk size; terrain({ material }) wins) */
  material?: Material | ((engine: Engine) => Material);
  /** Ground detail texture: texture asset name, scale repeats per meter, strength 0–1 */
  detail?: { texture: string; scale?: number; strength?: number };
}

/** UI template function: (data, helpers) => HTML string */
export type UITemplate = (data: any, tools: { esc: (s: any) => string; t: (key: string, params?: Record<string, any>) => string; icon?: (def: any) => string }) => string;

export interface StyleUI {
  /** Background color */
  bg?: string;
  /** Text color */
  fg?: string;
  /** Secondary text color */
  muted?: string;
  /** Accent color */
  accent?: string;
  /** Color for good news such as "done" */
  good?: string;
  /** Divider color */
  line?: string;
  /** Font (CSS font-family) */
  font?: string;
  /** Corner radius (CSS, e.g. '12px') */
  radius?: string;
  /** Loading screen background */
  loadingBg?: string;
  /** Window shadow (CSS) */
  shadow?: string;
  /** Height of the interaction prompt above the object (meters) */
  promptHeight?: number;
  /** Fade color for scene transitions (CSS), default '#000' */
  fadeBg?: string;
  /** Background / text / accent colors of objective markers, counters and progress bars (CSS) */
  hudBg?: string;
  hudFg?: string;
  hudAccent?: string;
  /**
   * Font asset names the UI uses (engine.assets.manifest({ fonts })); loaded at start(), then written in font: '"pixel", system-ui'. A style never holds
   * a font file path
   */
  fonts?: string[];
  /** Extra CSS (overrides .threedog-* classes) */
  css?: string;
  /** Replace the content of a window wholesale: inventory, quests, settings, loading, hudMarker, hudCounter, hudBar… */
  templates?: Record<string, UITemplate>;
  /** Other CSS variables (become --threedog-name) */
  [cssVar: string]: any;
}

export interface Style {
  /** Style pack name */
  name?: string;
  /** Exposure, default 1 (lowpoly: 1.05) */
  exposure?: number;
  /** Tone mapping, default 'neutral' (lowpoly: 'aces') */
  toneMapping?: Loose<'aces' | 'agx' | 'neutral' | 'none'>;
  /** Background color (when there is no sky module) */
  background?: ColorLike;
  /**
   * Post effects registered at startup, in any order (slot and order decide where each runs), e.g. [outline({ enabled: true }), bloom()] from
   * '@threedog/style-lowpoly'
   */
  post?: import('./generated/render/PostFX').PostEffect[];
  /**
   * Material per role (default, terrain, vegetation, character, water, building, pickup…): a spec, a three.js Material instance (cloned per use), or a
   * function (params, purpose) => Material
   */
  materials?: Record<string, MaterialSpec | import('three').Material | ((params: Record<string, any>, purpose: string) => import('three').Material)>;
  /**
   * Anti-aliasing: true = MSAA (also inside post-processing), false = off (pixel art, sharp edges). Default: on for desktop, off for low tier;
   * createEngine({ antialias }) wins
   */
  antialias?: boolean;
  /** Seasonal tint (multiplied onto the base color): { spring: { foliage, ground }, ... } */
  seasons?: Record<string, { foliage?: ColorLike; ground?: ColorLike }>;
  /** Cloud shadow: shadow darkest level 0–1 (default 0 = no cloud shadows; lowpoly 0.55), scale cloud size (smaller means bigger clouds), speed [x, z] */
  clouds?: { shadow?: number; scale?: number; speed?: number[] };
  /** Wind: frequency sway frequency multiplier */
  wind?: { frequency?: number };
  /** Terrain colors etc. */
  terrain?: StyleTerrain;
  /** Sky */
  sky?: StyleSky;
  /** Weather look */
  weather?: StyleWeather;
  /** Water look */
  water?: StyleWater;
  /**
   * Default look of pickups on the ground: color (the item's own color wins), size (meters), lift height above ground (meters), model(item, { color,
   * size }) builds the shape (a geometry gets materials.pickup; without model a plain box)
   */
  pickup?: { color?: ColorLike; size?: number; lift?: number; model?: (item: any, o: { color: ColorLike; size: number }) => Object3D | BufferGeometry };
  /**
   * Default character: colors palette; create(engine, colors) returns the procedural character (without it a gray capsule); model names a registered
   * model asset every character uses unless it passes its own model (the procedural body shows until it loads); animation.fade skeletal animation
   * transition seconds
   */
  character?: { model?: string; colors?: { body?: ColorLike; skin?: ColorLike; legs?: ColorLike; hair?: ColorLike }; create?: (engine: Engine, colors: Record<string, ColorLike>) => CharacterRig | null | undefined; animation?: { fade?: number } };
  /** UI colors, fonts, templates */
  ui?: StyleUI;
  /** Particle presets: name → parameters; default is the fallback for all effects */
  particles?: Record<string, ParticleOptions>;
  /** Trigger zone debug wireframe */
  triggers?: { debugColor?: ColorLike; debugOpacity?: number };
  /**
   * Grid placement (grids() module): preview ok / bad colors and opacity, tile lift (m), and per-layer tile colors { layer: { field: color } } (first
   * truthy field of a cell's data wins)
   */
  grid?: { ok?: ColorLike; bad?: ColorLike; previewOpacity?: number; previewHeight?: number; tileLift?: number; tiles?: Record<string, Record<string, ColorLike>> };
}
/**
 * What createEngine({ style }) takes: one style object, or a list of parts deep-merged left to right (plain objects merge, everything else replaces,
 * null removes; core/styleParts.js)
 */
export type StyleInput = Style | null | undefined | false | StyleInput[];


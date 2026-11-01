// Style pack (style): looks only (render / post, materials and shaders, sky, lighting, environment colors, particle looks, UI look). Every item is optional;
// the engine ships no art and falls back to neutral gray placeholders for what is omitted. Not here: sounds (createEngine({ audio })), model and texture
// files or generators (asset packs, engine.assets.manifest), gameplay data (content packs, engine.content.load), and anything that changes the world or
// the rules: water level / sea / size go to water({ level, sea, size }), terrain shape and size to terrain({...}) (a dev error says so). Swapping the style must
// never move the map. A style may be a list of parts (StyleInput).
// Example: the optional @threedog/style-lowpoly package (packages/styles/lowpoly/index.js).
import type { ColorLike, BufferGeometry, Object3D, Material, Loose } from './common';
import type { Engine } from './core';
import type { SteepRule, WeatherPreset, TerrainConfig, Sky } from './world';
import type { ParticleOptions, CharacterRig } from './gameplay';
import type { ShaderPatch } from './generated/render/patches';

/** Material finish: 'lambert' matte | 'phong' with highlights | 'standard' realistic | 'physical' | 'toon' cel-shaded steps | 'basic' unlit */
export type MaterialType = Loose<'lambert' | 'phong' | 'standard' | 'physical' | 'toon' | 'basic'>;
/** Material parameters for one role (other fields are set on the three.js material as is, e.g. roughness, shininess, specular) */
export interface MaterialSpec {
  /** Material type, default 'lambert' */
  type?: MaterialType;
  /** Number of light/dark steps for the toon type, default 3 */
  steps?: number;
  /** toon only: the light ramp, dark to light: grays 0-1 (light strength in the band) or colors (tint the band). Replaces steps */
  ramp?: (number | ColorLike)[];
  /** toon only, with ramp: 0 = hard bands, up to 1 = the bands melt into each other */
  soften?: number;
  color?: ColorLike;
  /**
   * Texture slots take an asset name: map, emissiveMap (sRGB), normalMap, roughnessMap, metalnessMap, aoMap, bumpMap, alphaMap, displacementMap... (linear).
   * Loaded through engine.assets.texture, a neutral stand-in until the image arrives; the key must be a slot the type has (roughnessMap needs 'standard').
   * A THREE.Texture also works. Example: { type: 'standard', map: 'rock.png', normalMap: 'rock_n.png', repeat: 4 }
   */
  map?: string | import('three').Texture;
  normalMap?: string | import('three').Texture;
  roughnessMap?: string | import('three').Texture;
  /** How many times the textures of this material repeat (a number, or [x, y]); default 1 */
  repeat?: number | [number, number];
  /** Texture wrapping: 'repeat' (default) | 'clamp' | 'mirror' */
  wrap?: Loose<'repeat' | 'clamp' | 'mirror'>;
  /** Grain, paper, strokes or a texture laid over the surface in world space (no UVs needed); off unless given */
  detail?: MaterialDetail;
  /** Extra light shaping (shadow tint, rim, wrap, your own GLSL); merged over style.lighting, false opts out */
  lighting?: MaterialLighting | false;
  [prop: string]: any;
}

/**
 * The `detail` surface patch. Source: texture (asset name) or noise ('grain' | 'paper' | 'stroke', default grain) or glsl (your own sampler
 * function). Effects: color (strength, mode), normal (relief height in meters), roughness (amount). Every number is a uniform, so many materials
 * with different values share one shader program. Channels (color / normal / roughness) are fixed when the material is made.
 */
export interface MaterialDetail {
  texture?: string | import('three').Texture;
  noise?: Loose<'grain' | 'paper' | 'stroke'>;
  /** Replaces the noise: `vec4 threedogDetailSample(vec2 p)` returns vec4(color rgb, height 0-1); p is scaled, turned, stretched */
  glsl?: string;
  /** Uniforms for glsl: numbers, colors, [x, y(, z, w)] arrays or textures */
  uniforms?: Record<string, any>;
  /** 'world' (default, looks straight down) | 'triplanar' (three axis planes blended by the surface normal; for walls and rocks) */
  projection?: Loose<'world' | 'triplanar'>;
  /** Repeats per meter, default 0.25 */
  scale?: number;
  /** Color effect 0-1, default 0.35 (0 turns the color part off) */
  strength?: number;
  /** How the color is applied: 'multiply' (default) | 'add' (lighter and darker) | 'mix' (towards the sample color) */
  mode?: Loose<'multiply' | 'add' | 'mix'>;
  /** Colors the sample (default white) */
  tint?: ColorLike;
  /** Degrees; turns the pattern (strokes run along it) */
  direction?: number;
  /** Stretches the pattern along direction (default 1, strokes 6) */
  stretch?: number;
  /** Noise layers 1-4, default 2 */
  octaves?: number;
  /** Relief height in meters (bumps the normal); needs a lit material */
  normal?: number;
  /** How much the sample moves roughness (standard / physical only) */
  roughness?: number;
}

/**
 * The `lighting` surface patch, on a spec (materials.x.lighting) or for all lit materials (style.lighting). three has no shadow color: a shadow only
 * removes the sun's light. These shape the summed light afterwards, from the first directional light (the sun) and its shadow for this pixel.
 * Limits: one directional light; point / spot lights are untouched; cloud shadows are not 'shadow' here. Values are uniforms (shared program).
 */
export interface MaterialLighting {
  /** Half-lambert: diffuse = (n.l + wrap) / (1 + wrap) from the sun; 0 = off, 0.5 soft, 1 full half-lambert. Ignores a toon ramp */
  wrap?: number;
  /** Shadowed (or sun-averted) parts shift hue towards this color at the same brightness: strength 0-1 (default 0.5),
   * soft = terminator width in n.l (default 0.3) */
  shadowTint?: { color: ColorLike; strength?: number; soft?: number };
  /** Fresnel edge light added to the ambient part: strength (0.4), power (3, higher = thinner rim),
   * shadowSide 0-1 (1 = only on the side away from the sun) */
  rim?: { color: ColorLike; strength?: number; power?: number; shadowSide?: number };
  /**
   * Your own shaping, replaces wrap / shadowTint / rim:
   * `void threedogLighting(inout ReflectedLight light, vec3 normal, vec3 viewDir, vec3 sunDir, float sunShadow, vec3 albedo)`
   */
  glsl?: string;
  uniforms?: Record<string, any>;
}

/** Sky keyframe: [time 0–1, zenith color, horizon color (= fog color), sun color, sun intensity, ambient intensity] */
export type SkyKeyframe = (number | ColorLike)[];

export interface StyleSeasons {
  mode?: Loose<'multiply' | 'mix'>;
  strength?: number;
  [season: string]: any;
}

export interface StyleSky {
  /** Colors and light intensities at each time of day */
  keyframes?: SkyKeyframe[];
  /**
   * A flat background color in place of the dome (no gradient, horizon line, sun / moon disk, stars or clouds), or (sky) => color per
   * frame. Drawn as written (no tone mapping); the keyframes still light the world; fog in its default horizon color follows it (a
   * fog.color of your own still wins). Leave out for the dome. Not with skybox. recipes/47
   * @example backdrop: sky => sky.isDay ? 0xefebe4 : 0x2c3346
   */
  backdrop?: ColorLike | ((sky: Sky) => ColorLike);
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
  /** Clouds in the sky (cloud cover follows the weather); see StyleSkyClouds */
  clouds?: StyleSkyClouds;
  /** Panorama (equirectangular) replacing the gradient sky, asset name or path */
  skybox?: string;
  /** Shadows: mapSize resolution (pixels), extent coverage (meters), etc., see StyleShadow */
  shadow?: StyleShadow;
  /** Environment lighting (scene.environment), off unless a source is given; see Sky.setEnvironment. A pack can give defaults, sky({ environment }) overrides */
  environment?: StyleEnvironment;
  /** Fog model and color (default: linear fog in the horizon color); see StyleFog */
  fog?: StyleFog;
  /** Extra dome layers drawn after the clouds and stars (rainbow, aurora), default none; see StyleSkyLayer */
  layers?: StyleSkyLayer[];
}

/**
 * Fog (modules/sky/fog.js). Defaults draw three's linear fog in the dome's horizon color, exactly as before.
 * @example fog: { kind: 'height', height: 2, falloff: 0.08, density: 0.02 }   // valley mist, thin above
 * @example fog: { kind: 'exp2', color: 0xb8c4d0 }   // own color: the dome's lower band fades to it so the horizon line does not show
 */
export interface StyleFog {
  /** 'linear' (default, near = 0.3 x far) | 'exp' | 'exp2' | 'height' (thick below `height`, thinning above it) */
  kind?: Loose<'linear' | 'exp' | 'exp2' | 'height'>;
  /** 'horizon' (default: the dome's horizon color) | a color | (sky) => color (e.g. to darken it at night) */
  color?: 'horizon' | ColorLike | ((sky: any) => ColorLike);
  /** Per meter, exp / exp2 / height (default: derived from engine.fogFar, so fog reaches the same distance as linear); weather fog divides it */
  density?: number;
  /** 'height': world y of the fog floor, default 0 */
  height?: number;
  /** 'height': how fast the fog thins above the floor, per meter, default 0.05 */
  falloff?: number;
  /**
   * Replace the fog math in every material (three's fog chunks, set at install):
   * `vec4 threedogFog(vec3 color, float depth, vec3 worldPos)` returns (fog rgb, amount 0..1). In scope: fogColor, cameraPosition,
   * fogNear / fogFar (kind 'linear') or fogDensity (other kinds), THREEDOG_FOG_HEIGHT, THREEDOG_FOG_FALLOFF. No custom uniforms (write constants)
   * @example glsl: `vec4 threedogFog(vec3 c, float depth, vec3 p){ float f = 1.0 - exp(-fogDensity * depth); return vec4(mix(c, vec3(1.0, 0.8, 0.6), f * 0.3), f); }`
   */
  glsl?: string;
}

/**
 * One extra sky layer (modules/sky/domeLayers.js)
 * @example layers: [{ blend: 'add', uniforms: { uAurora: [0.2, 1, 0.6] }, glsl: `vec4 threedogSkyLayer(vec3 d, float time, vec3 sunDir, float night){
 *   float band = smoothstep(0.25, 0.45, d.y) * (1.0 - smoothstep(0.55, 0.8, d.y)) * threedogNoise(vec2(d.x * 4.0 + time * 0.05, d.z * 2.0));
 *   return vec4(uAurora, band * night); }` }]
 */
export interface StyleSkyLayer {
  /** Defines `vec4 threedogSkyLayer(vec3 dir, float time, vec3 sunDir, float night)` returning (rgb, amount 0..1); renamed per layer, so layers never clash */
  glsl: string;
  /** Custom uniforms (numbers, THREE.Color, [x, y(, z, w)], THREE.Texture), live in engine.sky.dome.material.uniforms */
  uniforms?: Record<string, any>;
  /** Draw order among the layers, smaller first (default 0) */
  order?: number;
  /** 'mix' (default: mix(sky, rgb, amount)) | 'add' (sky + rgb * amount, for glows) */
  blend?: Loose<'mix' | 'add'>;
}

/** Environment lighting parameters */
export interface StyleEnvironment {
  /** 'sky' (built from the procedural sky) or an HDR / panorama asset name or path; omitted or null = off */
  source?: string | null;
  /** Light scale, default 1 */
  intensity?: number;
  /** Turn around Y, radians, default 0 */
  rotation?: number;
  /** Seconds between rebuilds of a 'sky' source (only when the sky changed), default 1 */
  interval?: number;
  /** Low-tier override: fields to replace there (a 'sky' source already rebuilds 4 times less often), or false to turn it off */
  low?: Omit<StyleEnvironment, 'low'> | false;
}

/** Sun shadow parameters (defaults are the current look) */
/**
 * Sky cloud layer. The defaults are the original look ('plane': one plane projected onto the sky, 3 noise layers), so a style
 * that sets nothing here draws what it always drew. Values below marked (plane) are the defaults of kind 'plane'.
 * @example clouds: { kind: 'cumulus', coverage: 1, scale: 0.5, color: 0xfff6ea, shade: 0x8fa0b8 }   // full-sky billowy clouds with sun-side light
 * @example clouds: { glsl: `vec4 threedogClouds(vec3 d, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cover){
 *   return vec4(lit, 0.5); }`, uniforms: { uBrush: 0.4 } }
 */
export interface StyleSkyClouds {
  color?: ColorLike; shade?: ColorLike;
  /** 0-1+, multiplies the weather cloud amount (default 1) */
  coverage?: number;
  /** Cloud cell size: larger = smaller clouds (plane 0.35) */
  scale?: number;
  /** Drift per second [x, z] (plane [0.004, 0.002]) */
  speed?: number[];
  /**
   * 'plane' (default): cheap, 3 noise samples, cells shrink and crowd towards the horizon.
   * 'cumulus': 8 noise samples per cloudy pixel, flatter projection (clouds fill the whole sky), sun-side light and shaded undersides.
   * Both are one 2D pass, no ray marching.
   */
  kind?: Loose<'plane' | 'cumulus'>;
  /** Added to dir.y in the plane projection: smaller = stronger crowding at the horizon (plane 0.08, cumulus 0.5) */
  horizon?: number;
  /** Horizon fade [from, to] in dir.y: clouds are invisible below `from` and full above `to` (plane [0, 0.18], cumulus [0, 0.12]) */
  fade?: number[];
  /** Cloud opacity 0-1 (plane 0.9, cumulus 0.95) */
  opacity?: number;
  /** Width of the cloud edge in noise units: larger = softer edge (plane 0.3, cumulus 0.35) */
  softness?: number;
  /** 'plane' only: the 3 noise layers. scales = frequency multipliers of layers 2 and 3 (default [2.7, 6.1]), weights = their mix (default [0.6, 0.3, 0.1]) */
  noise?: { scales?: number[]; weights?: number[] };
  /** 'cumulus' only: contrast of the sun-side light (default 5) */
  relief?: number;
  /**
   * Replace the cloud function with your own GLSL; overrides `kind`. Must define
   * `vec4 threedogClouds(vec3 dir, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cover)` returning (rgb, alpha).
   * See modules/sky/clouds.js for what is in scope.
   */
  glsl?: string;
  /**
   * Extra uniforms for `glsl`, declared for you: number, THREE.Color, THREE.Vector2/3/4, [x, y(, z, w)] array or THREE.Texture.
   * Change them later via engine.sky.dome.material.uniforms.<name>.value
   */
  uniforms?: Record<string, number | number[] | object>;
}

/**
 * Wind look. frequency multiplies the sway speed. glsl replaces the sway shape of every swaying material made through
 * vegetation.add (or applyEffects with the same object): define `void threedogWind(inout vec3 transformed, vec3 ip, vec3 position)` that moves
 * `transformed` (object space); ip = world position of this instance's origin (own phase per plant), position = the vertex. In scope: uTime, uWind
 * (weather multiplier), uWindFreq, THREEDOG_WIND_AMP (the species' amplitude), your `uniforms`. The shadow sways with it. The default is in
 * render/effects.js (threedog_wind_vertex): two sines, height-weighted, a lean with the wind strength.
 * @example wind: { glsl: `void threedogWind(inout vec3 t, vec3 ip, vec3 p){ float s = floor(sin(uTime * uWindFreq + ip.x) * 3.0) / 3.0; t.x += s * max(p.y, 0.0) * THREEDOG_WIND_AMP * uWind; }` }
 */
export interface StyleWind {
  frequency?: number;
  glsl?: string;
  /** Extra uniforms for glsl: number, THREE.Color, THREE.Vector2/3/4, [x, y(, z, w)] array or THREE.Texture */
  uniforms?: Record<string, number | number[] | object>;
}

/** engine.sky.shadow: the shadow params in use (Sky.setShadow changes them); field meanings as in StyleShadow */
export interface SkyShadowParams {
  bias: number; normalBias: number; updateEvery: number; snap: number | 'texel'; ahead: number; type: 'basic' | 'pcf' | 'vsm'; radius: number; blurSamples: number;
  cascades: number; maxFar: number; fade: boolean; lightMargin: number; split: StyleShadow['split'];
}

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
  /** Shadow filter: 'basic' (hard edge, cheapest) | 'pcf' (default, soft edge) | 'vsm' (softest, costliest). Default: the engine's shadowType option */
  type?: Loose<'basic' | 'pcf' | 'vsm'>;
  /** Edge softness for 'pcf' and 'vsm' (no effect on 'basic'), default 1 */
  radius?: number;
  /** Blur sample count, 'vsm' only, default 8 */
  blurSamples?: number;
  /**
   * Cascaded shadows (recipes/45): 1 (default) = one shadow map around the focus, the plain path; 2-4 split the sun's shadow along the view,
   * sharp near the camera and wide far away. Each cascade draws the casters once more. Low-tier devices stay at 1 unless low.cascades says so.
   * Switching recompiles every lit material once (the light count changes); extent / snap / ahead do not apply while cascades are on
   * @example shadow: { cascades: 3, maxFar: 150, low: { cascades: 2, fade: false } }   // low-tier devices: 2 cascades instead of one map
   */
  cascades?: number;
  /** Cascades: meters from the camera they cover (no sun shadow beyond), default 120 */
  maxFar?: number;
  /** Cascades: cross-fade at each border so no seam shows (two shadow lookups there), default true */
  fade?: boolean;
  /** Cascades: meters behind each cascade box toward the light still caught as casters (tall things outside the view), default 100 */
  lightMargin?: number;
  /** Cascades: where borders fall, 'practical' (default) | 'uniform' | 'logarithmic' | (count, near, far, out: number[]) => void (three CSM customSplitsCallback) */
  split?: Loose<'practical' | 'uniform' | 'logarithmic'> | ((count: number, near: number, far: number, out: number[]) => void);
  /**
   * Overrides used on low-tier devices (engine.tier 'low'), default { mapSize: 1024, cascades: 1 }. updateEvery above 1 saves more but makes
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
  /**
   * Lightning look: flash (1 at the strike, fading in a third of a second) -> sky flash amount; default flickers. Return 0 and draw your own bolt
   * on the weather:lightning event for a whole replacement
   * @example lightning: f => f * f * 0.8
   */
  lightning?: (flash: number, engine: Engine) => number;
  /** Rain particles (default streaks: color 0xc8c8c8, opacity 0.55, length 0.7 m, speed 22 m/s, slant 1); a texture or a sprite shape draws drops */
  rain?: StyleWeatherParticles;
  /** Snow particles (default round sprites: color 0xffffff, opacity 0.9, size 20, maxSize 5 px, speed 1.6 m/s, sway 1.5 m) */
  snow?: StyleWeatherSnow;
  /** Retune the look of weather types the game has (e.g. a darker storm); never adds a type: the list is the game's weather({ types }) */
  types?: Record<string, Partial<WeatherPreset>>;
}

/** Falling weather particles: style.weather.rain / snow and engine.weather.define(field, spec). See recipes/44-water-weather-look-hooks.md */
/** style.weather.snow: the snow particles' look plus the cover it leaves */
export interface StyleWeatherSnow extends StyleWeatherParticles {
  /** Snow lying on foliage / ground while it snows (StyleSnowCover); leave out for particles only */
  cover?: StyleSnowCover;
}

/**
 * Snow cover (style.weather.snow.cover): the season tint of foliage / ground (vegetation, terrain, materials with season) moves toward
 * these colors as the weather's snow amount rises, `strength` of the way at full snow, and melts back as it falls. Rides the season
 * patch (mix over style.seasons; a 'multiply' season gives way while snow lies). Leave it out and snow only draws particles.
 * The same cover for anything else (ash, frost): engine.sky.modify('ash', { groundCover: 0x555555, coverAmount: 0.6 }). recipes/47
 * @example cover: { foliage: 0xf2f4f6, ground: 0xeef0f2, strength: 0.8 }
 */
export interface StyleSnowCover {
  /** Snow color on foliage (leave out: foliage keeps its season color) */
  foliage?: ColorLike;
  /** Snow color on the ground (leave out: ground keeps its season color) */
  ground?: ColorLike;
  /** How far toward the color at full snow, 0-1, default 0.8 */
  strength?: number;
}

export interface StyleWeatherParticles {
  /** 'line' streaks slant with the wind; 'round' | 'soft' | 'square' sprites drift (sway) */
  shape?: Loose<'line' | 'round' | 'soft' | 'square'>;
  /** Sprite image (asset name), replaces the shape */
  texture?: string | null;
  color?: ColorLike;
  opacity?: number;
  /** Sprite size (pixels at 3 m) and its pixel cap */
  size?: number;
  maxSize?: number;
  /** Streak length (meters, lines) */
  length?: number;
  /** Fall speed (m/s) */
  speed?: number;
  /** Streak lean per unit of wind (lines) */
  slant?: number;
  /** Sprite drift (meters) */
  sway?: number;
  /** Particle count (default weather({ particles }); halved on low-tier devices) */
  count?: number;
  /** Weather amount 0..1 -> share of particles drawn (rain default a => min(1, a * 1.2), snow () => 1; opacity follows the amount too) */
  density?: (amount: number) => number;
  /**
   * Whole shader text (copy modules/weather/shaders.js). In scope: uCam uSize uFallOff uOpacity uColor, lines uWindDir uLen (attribute aEnd),
   * sprites uPx uMaxPx uSway uSwayAmp uMap uUseMap, and your uniforms (declared for you)
   */
  glsl?: { vertex?: string; fragment?: string };
  /** Uniforms for your glsl: numbers, colors, [x, y(, z, w)] arrays, textures; live in engine.weather.systems.get(field).uniforms */
  uniforms?: Record<string, any>;
  /** A system of your own instead (engine.weather.define only): the engine adds object, shows it while the amount is above 0.02, calls update */
  create?: (engine: Engine, ctx: { area: number; count: number }) => {
    object: Object3D; update?: (amount: number, ctx: { camera: any; time: number; wind: number }) => void };
}

export interface StyleWater {
  /**
   * Replace the whole water surface material (the built-in role 'water', waves and fresnel are skipped). Receives the shared
   * uniforms (uTime, uWave, uWaveScale, uWaveSpeed), the built-in wave patch, the surface patch (depthColor / foam / glsl.surface; null
   * without them; put it after waves) and the scrolling normal map (null without one). Reflections: recipes/44-water-weather-look-hooks.md
   * @example material: (engine, { waves }) => applyEffects(new THREE.MeshToonMaterial({ color: 0x3a8acf }), { clouds: false, patches: [waves] })
   */
  material?: (engine: Engine, ctx: { uniforms: Record<string, { value: any }>; waves: ShaderPatch; surface: ShaderPatch | null;
    normalMap: import('three').Texture | null }) => Material;
  /**
   * Water color from the view angle (by 'view', default: shallow looking down, deep at grazing angles) or the wave height (by 'wave': shallow on
   * crests); replaces color. curve shapes the blend (default 1)
   */
  depthColor?: StyleWaterDepth;
  /**
   * Crest foam from the wave height (start / end: fraction of glsl.waveMax where foam begins / is full, default 0.55 / 0.85); true = defaults.
   * Shore foam needs depth: recipes/44
   */
  foam?: StyleWaterFoam | true;
  /**
   * Your own GLSL. wave: `float threedogWaterWave(vec3 p, float t)` (p = world position * waveScale, t = time * waveSpeed) returns the height
   * before waveHeight; waveMax = its peak (default 0.29), which foam and depthColor 'wave' divide by. surface: `vec4 threedogWaterSurface(vec4
   * base, float wave, float facing, vec3 worldPos, float time)` returns the color and opacity lighting starts from (facing 1 = straight down)
   */
  glsl?: { wave?: string; surface?: string; waveMax?: number };
  /** Uniforms for your glsl, in both stages: numbers, colors, [x, y(, z, w)] arrays or textures; live in engine.water.material.uniforms */
  uniforms?: Record<string, any>;
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
  /** Mesh subdivision of the global water (quality, not the world; default 150) */
  segments?: number;
  // level, sea and size are not style: water({ level, sea, size }) (WaterOptions)
}

export interface StyleWaterDepth {
  shallow?: ColorLike;
  deep?: ColorLike;
  by?: Loose<'view' | 'wave'>;
  curve?: number;
}

export interface StyleWaterFoam {
  color?: ColorLike;
  start?: number;
  end?: number;
  /** 0-1, foam opacity on top of the water (default 1) */
  opacity?: number;
}

export interface StyleTerrain {
  /** Palette: color name → color (e.g. sand, meadowA, rock) */
  colors?: Record<string, ColorLike>;
  /** Landform → palette color name (two names are blended by noise) */
  biomeColors?: Record<string, string[]>;
  /** Color rule for steep slopes */
  steep?: SteepRule[];
  /**
   * How ground colors vary (plain data, sent to the terrain workers). Every default is the original look; set only what you want to change.
   * blend: the two-color noise (size = wavelength in meters, default 33; strength = contrast, default 1). jitter: per-cell brightness grain
   * (size = cell in meters, default 0.33; min = darkest multiplier 0.92; range = how much brighter it gets 0.12). patches: a second, much larger
   * layer for painted color blocks (size in meters, default 90; strength 0-1, default 0.15; levels > 0 snaps it to flat blocks; tint = pull
   * towards this color instead of lighten/darken).
   * @example variation: { blend: { size: 14 }, jitter: { range: 0.04 }, patches: { size: 60, strength: 0.25, levels: 4, tint: 0xb59a5a } }
   */
  variation?: {
    blend?: { size?: number; strength?: number };
    jitter?: { size?: number; min?: number; range?: number };
    patches?: { size?: number; strength?: number; levels?: number; tint?: number };
  };
  /**
   * Looks of the ground mesh only. shading: 'flat' one color and normal per triangle (facets) | 'smooth' (engine default) | 'texture' (per-chunk color
   * map, colors independent of the mesh); colorResolution: color map pixels per chunk edge; normals: 'smooth' | 'flat' lighting in texture mode;
   * normalFn: custom grid-point normal. Shape, size, seed, water level, resolution, diagonal: terrain({...}). See recipes/37-terrain-look-hooks.md
   */
  config?: { shading?: Loose<'flat' | 'smooth' | 'texture'>; colorResolution?: number; normals?: Loose<'smooth' | 'flat'>; normalFn?: TerrainConfig['normalFn'] };
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
  /**
   * Exposure, default 1 (lowpoly: 1.05): a number, or over the day [[time 0-1, exposure], ...] (sorted, wraps across midnight) or (sky) => number,
   * evaluated by the sky module every frame. engine.setExposure changes it at run time
   * @example exposure: [[0, 1.6], [0.3, 1], [0.75, 1.1]]   // brighter nights
   */
  exposure?: number | number[][] | ((sky: any) => number);
  /** Tone mapping, default 'neutral' (lowpoly: 'aces') */
  toneMapping?: Loose<'aces' | 'agx' | 'neutral' | 'none'>;
  /** Background color (when there is no sky module) */
  background?: ColorLike;
  /**
   * Post effects registered at startup, in any order (slot and order decide where each runs), e.g. [outline({ enabled: true }), bloom()] from
   * '@threedog/post-effects'
   */
  post?: (Omit<import('./generated/render/PostFX').PostEffect, 'slot'> & { slot?: Loose<import('./generated/render/PostFX').PostSlot> })[];
  /**
   * Material per role (default, terrain, vegetation, character, water, building, pickup…): a spec, a three.js Material instance (cloned per use), or a
   * function (params, purpose) => Material
   */
  materials?: Record<string, MaterialSpec | import('three').Material
    | ((params: Record<string, any>, purpose: string, engine: Engine) => import('three').Material)>;
  /**
   * Anti-aliasing: true = MSAA (also inside post-processing), false = off (pixel art, sharp edges). Default: on for desktop, off for low tier;
   * createEngine({ antialias }) wins
   */
  antialias?: boolean;
  /** Light shaping for every lit material of the pack (shadow tint, rim, wrap, glsl); a material's `lighting` wins, `lighting: false` opts out */
  lighting?: MaterialLighting;
  /**
   * Seasonal tint: { spring: { foliage, ground }, ... }. mode 'multiply' (default) multiplies the color onto the surface
   * (pick tints near white: orange times green is muddy); 'mix' moves the surface `strength` (0-1, default 0.5) of the
   * way to the color. Season names are the other keys, so none can be called mode or strength
   */
  seasons?: StyleSeasons;
  /** Cloud shadow: shadow darkest level 0–1 (default 0 = no cloud shadows; lowpoly 0.55), scale cloud size (smaller means bigger clouds), speed [x, z] */
  clouds?: { shadow?: number; scale?: number; speed?: number[] };
  /**
   * Named colors the procedural model generators read (trees, rocks, grass: a generator written with `function` gets them as this.palette; lowpoly keys:
   * bark, pine, leaf, rock, grassTip...). One place to retint all of them, e.g. style: [lowpoly, { palette: { leaf: 0xd98a3a } }]; keys left out keep the pack's values
   */
  palette?: Record<string, ColorLike>;
  /** Wind: frequency sway frequency multiplier */
  wind?: StyleWind;
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
   * size }, engine) builds the shape (a geometry gets materials.pickup; make materials with engine.makeMaterial; without model a plain box)
   */
  pickup?: { color?: ColorLike; size?: number; lift?: number; model?: (item: any, o: { color: ColorLike; size: number }, engine: Engine) => Object3D | BufferGeometry };
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


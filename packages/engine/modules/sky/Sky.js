// Sky module: dome shader (gradient + sun + moon + stars), sun/moon directional light, hemisphere ambient light and fog, all driven by time.
// Look (per-time colors, sun size, star density...) comes from style.sky in the style pack; the engine only holds neutral fallbacks.
//
// engine.use(sky({ time: 0.3, dayLength: 360 }));   // or sky(presets.calendar.cycle)
// sky() alone keeps a fixed time of day (dayLength Infinity): a day-night cycle is gameplay (a shooter or a dungeon has none), so the game sets
// dayLength or picks presets.calendar.cycle / fourSeasons.
// engine.sky.timeOfDay = 0.75;  engine.clock.timeScale = 10;  engine.sky.clock  // "18:00"
// Calendar: engine.sky.day (1-based); event day:start. Seasons are the game's choice and off by default (a soulslike or a shooter has none):
// sky({ seasons: ['spring', 'summer', 'autumn', 'winter'], daysPerSeason: 28 }), or each with its own length: [{ name: 'wet', days: 10 },
// { name: 'dry', days: 20 }]; then season, seasonProgress (0-1), dayOfSeason and the season:change event.
// Season tint: style pack seasons = { spring: { foliage: 0xffffff, ground: 0xffffff }, autumn: { foliage: 0xffb070 }, ... }, blended smoothly
// Clouds: style pack sky.clouds = { color, shade, coverage: 1, scale: 0.35, speed: [x, z], kind, glsl, ... } (coverage follows weather; see clouds.js)
// three.js objects: engine.sky.sun (DirectionalLight; moonlight at night, shadows live on it), hemi (HemisphereLight ambient), dome (dome Mesh),
//   sunDir (Vector3 toward the sun). Light color/intensity is recomputed every frame: adjust brightness through modify() layers (see modify), or
//   take a light over with sky({ sun: 'manual' | false, hemisphere: ... }) (look.js); fog kinds and dome layers: fog.js, domeLayers.js;
//   engine.sky.modifiers is the composite of all layers (read-only)
// Skybox: style pack sky.skybox = '/textures/sky.jpg' (equirectangular panorama) replaces the gradient sky; brightness follows time
import * as THREE from 'three';
import { NEUTRAL_KEYFRAMES, checkKeyframes, makeSkyUniforms, makeDome, loadSkybox } from './shader.js';
import { shadowMethods, shadowFor } from './shadow.js';
import { layerMethods, blankLayer } from './layers.js';
import { environmentMethods, environmentFor } from './environment.js';
import { updateSky, watchOwned } from './frame.js';
import { prepareLook } from './look.js';
import { makeFog, applyFogChunks } from './fog.js';
import { parseSeasons, seasonIndexOf, dayOfSeasonOf, seasonProgressOf, advance } from './calendar.js';
import { formatClock } from '../../core/dayTime.js';
import { Schedule } from './schedule.js';
/** @import { Object3D, Vector3 } from '../../types/common' */
/** @import { SkyOptions, SkyModifiers, SkyLayer, SkyAtOptions, SkyBetweenOptions, SkyEnvironmentInfo } from '../../types/world' */
/** @import { Handle } from '../../types/common' */
/** @import { SkyShadowParams } from '../../types/style' */
const STRINGS = {
  badDayLength: 'sky({ dayLength }): game seconds per day must be a number > 0 (Infinity = the time of day never moves); got {got}',
  noSeason: "sky.onSeason('{name}'): the calendar has no such season (seasons: {list}). " +
    "Seasons are off by default: sky({ seasons: ['spring', 'summer', 'autumn', 'winter'] })",
};
/** engine.sky */
export class Sky {
  /** @internal */
  constructor(engine, { time = 0.33, dayLength = Infinity, day = 1, daysPerSeason = 7, seasons = [], ...over } = {}) {
    /** @internal */ this.engine = engine;
    const st = { ...(engine.style.sky || {}), ...over };
    /**
     * Sky time of day: 0-1 (0 midnight, 0.25 6am, 0.5 noon, 0.75 6pm); one day = dayLength game seconds (the unit of engine.clock.now). Fixed-step seconds
     * (unaffected by timeScale) are engine.elapsed @type {number}
     */
    this.timeOfDay = time;
    if (!(dayLength > 0)) throw new Error(STRINGS.badDayLength.replace('{got}', String(dayLength)));
    /**
     * Game seconds per day (1 sky hour = dayLength / 24 game seconds; at timeScale 1 game seconds equal fixed-step seconds); Infinity = the time of day never
     * moves @type {number}
     */
    this.dayLength = dayLength;
    /** Day number (1-based) @type {number} */
    this.day = day;
    /** Days per season for seasons given by name only @type {number} */
    this.daysPerSeason = daysPerSeason;
    /** Season names, [] when the game has no seasons (the default) @type {string[]} */
    this.seasons = [];
    // kept as names plus the day each season ends (cumulative), so seasons of different lengths cost one short loop in the getters
    /** @internal */ this._ends = [];
    const parsed = parseSeasons(seasons, daysPerSeason);
    this.seasons.push(...parsed.names); this._ends.push(...parsed.ends);
    /** @internal */ this.seasonStyle = engine.style.seasons || null;
    /** @internal */ this._season = this.season;
    /** @internal */ this._sched = new Schedule(this);
    if (st.keyframes) checkKeyframes(st.keyframes);
    /** @internal */ this.kf = (st.keyframes || NEUTRAL_KEYFRAMES).map(k => [k[0], new THREE.Color(k[1]), new THREE.Color(k[2]), new THREE.Color(k[3]), k[4], k[5]]);
    /** @internal */ this.groundTint = new THREE.Color(st.groundTint ?? 0x4a4a4a);
    const scene = engine.scene;

    const look = prepareLook(this, st, over);   // light modes, fog, dome layers (look.js)
    /** @internal */ this.uniforms = { ...makeSkyUniforms(st, engine.uniforms), ...look.uniforms };
    /** Dome mesh @type {Object3D} */
    this.dome = makeDome(this.uniforms, st, look);
    scene.add(this.dome);
    // Skybox (panorama): replaces the gradient sky when present
    /** @internal */ this.skybox = null;
    if (st.skybox) loadSkybox(this, st.skybox);

    scene.fog = this._drive.fog === false ? null : makeFog(this._fog, engine.fogFar);
    /** @internal */ this._fogOff = this._drive.fog === false ? () => {} : applyFogChunks(this._fog);   // throws when another engine holds a different custom fog
    /** Hemisphere ambient light (engine.lights.hemi, driven by the sky) @type {any} */
    this.hemi = engine.lights.hemi;
    /** Sun directional light (engine.lights.sun driven by the sky; moonlight at night, shadows live on it) @type {any} */
    this.sun = engine.lights.sun;
    this.sun.castShadow = engine.shadows && this._drive.sun !== false;
    const sh = shadowFor(engine.tier, engine.style.sky?.shadow, over.shadow);
    this.sun.shadow.mapSize.set(sh.mapSize ?? 2048, sh.mapSize ?? 2048);
    const ext = sh.extent ?? 70;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 420 });
    /** Sun direction (unit vector toward the sun) @type {Vector3} */
    this.sunDir = new THREE.Vector3();
    /**
     * Sun orbit: tilt = north-south tilt, sway = east-west swing, distance = light distance (meters) @type {{ tilt: number, sway: number, distance: number }}
     */
    this.orbit = { tilt: st.orbitTilt ?? 0.45, sway: st.orbitSway ?? 0.8, distance: sh.distance ?? 160 };
    // Shadow update policy (default: every frame, center snapped to 0.5 m)
    /** Current shadow params (change via setShadow) @readonly @type {SkyShadowParams} */
    this.shadow = { bias: -0.0006, normalBias: 0.04, updateEvery: 1, snap: 0.5, ahead: 0, type: engine.shadowType, radius: 1, blurSamples: 8,
      cascades: 1, maxFar: 120, fade: true, lightMargin: 100, split: 'practical' };
    /** three's CSM (addons/csm) while shadow.cascades > 1, else null; its lights[0] is sun (recipes/45) @type {any} */
    this.csm = null;
    /** @internal */ this._shadowFrame = 0;
    /** @internal */ this._snapKey = '';
    this.setShadow(sh);
    /** Hours per day @type {number} */
    this.hoursPerDay = over.hoursPerDay ?? 24;   // gameplay timing (clock notation, schedules): a sky() option only, never read from the style pack
    // Modifier layers: weather and games each write their own layer (modify); sky composites them into modifiers every frame
    // and applies them on top of its own result (layers.js)
    /** @internal */ this._layers = new Map();
    /** @internal */ this._checked = new Map();   // owner -> the values object whose keys were last checked (layers.js)
    /** Composite of all modifier layers (read-only; use modify to adjust brightness) @readonly @type {SkyModifiers} */
    this.modifiers = blankLayer();
    /** @internal */ this._lightDir = new THREE.Vector3();
    /** @internal */ this._env = null;
    const env = environmentFor(engine.tier, engine.style.sky?.environment, over.environment);
    if (env) this.setEnvironment(env);
    // Per-frame recomputed properties: direct edits by games get overwritten, so warn once in dev (frame.js)
    /** @internal */ this._owned = watchOwned(this);
  }

  /**
   * Write a modifier layer (only the given fields; unwritten fields have no effect); values null removes the layer. Weather uses the 'weather' layer, games use
   * their own layer name.
   * Layers composite every frame: sun / ambient / fog multiply; tint blends weighted by tintAmount; flash takes the max
   * @example engine.sky.modify('cave', { sun: 0.3, ambient: 0.4 });  engine.sky.modify('cave', null);
   * @param {string} owner
   * @param {SkyLayer | null} values
   * @returns {this}
   */
  modify(owner, values) { return layerMethods.modify.call(this, owner, values); }

  /**
   * Shadow resolution (pixels)
   * @returns {number}
   */
  get shadowMapSize() { return this.sun.shadow.mapSize.x; }

  /** Clock text, e.g. "18:00" */
  get clock() { return formatClock(this.timeOfDay, this.hoursPerDay); }
  /** Sun elevation -1 (midnight) ... 0 (horizon) ... 1 (noon). Day/night is computed only here; other modules read isDay / daylight */
  get sunHeight() { return Math.sin((this.timeOfDay - 0.25) * Math.PI * 2); }
  /** Whether it is daytime (sun above the horizon) */
  get isDay() { return this.sunHeight > 0; }
  /** Daylight amount 0-1 (0 at night, 1 at noon); ambience etc. fade by it */
  get daylight() { return Math.max(0, this.sunHeight); }

  // ---------- Calendar ----------
  /** Current season index, -1 without seasons */
  get seasonIndex() { return seasonIndexOf(this); }
  /** Current season name, e.g. 'spring'; null without seasons @type {string | null} */
  get season() { return this.seasons[this.seasonIndex] ?? null; }
  /** Day within the season (1-based); 0 without seasons */
  get dayOfSeason() { return dayOfSeasonOf(this); }
  /** Fraction of the season elapsed, 0-1 (includes time of day); 0 without seasons */
  get seasonProgress() { return seasonProgressOf(this); }
  /** Total game time in days (fractional), for growth, cooldowns and the like */
  get totalDays() { return this.day - 1 + this.timeOfDay; }

  /**
   * Advance time (called by the module every fixed step)
   * @param {number} dt
   * @returns {void}
   * @internal
   */
  tick(dt) { advance(this, dt); }

  // ---------- Clock-time / season timers (read sky time of day; for "after N seconds" use engine.clock.after) ----------
  /**
   * Call fn every day at a clock time: at('18:00', fn) or at(0.75, fn).
   * Fires only when time moves forward across the clock time: natural flow, step fast-forward and setting timeOfDay later all count;
   * crossing several triggers at once is replayed per catchUp; rewinding time and loading a save do not fire, they only reset the baseline.
   * To hold a state during a time range (lights, shop door) use between
   * @param {string | number} clock  'HH:MM' or 0-1
   * @param {(day: number) => void} fn
   * @param {SkyAtOptions} [opts]
   * @returns {Handle}
   */
  at(clock, fn, opts) { return this._sched.at(clock, fn, opts); }
  /**
   * Time-range switch: on() while clock time is in [from, to), otherwise off() (from > to wraps midnight).
   * Aligns once immediately on registration, new game, load, applying a scenario and time rewind; afterwards it calls on/off when crossing a boundary
   * @example engine.sky.between('18:00', '06:00', { on: () => lamp.on(), off: () => lamp.off() })
   * @param {string | number} from
   * @param {string | number} to
   * @param {SkyBetweenOptions} opts
   * @returns {Handle}
   */
  between(from, to, opts) { return this._sched.between(from, to, opts); }
  /**
   * Call fn(day) at the start of each day (00:00)
   * @param {(day: number) => void} fn
   * @param {SkyAtOptions} [opts]
   * @returns {Handle}
   */
  daily(fn, opts) { return this._sched.at(0, fn, opts); }
  /**
   * Call fn(seasonName) on entering season name
   * @param {string} name
   * @param {(season: string) => void} fn
   * @returns {Handle}
   */
  onSeason(name, fn) {
    // a season the calendar does not have would never fire: say so now instead of waiting forever
    if (!this.seasons.includes(name))
      throw new Error(STRINGS.noSeason.replace('{name}', name).replace('{list}', this.seasons.length ? this.seasons.join(', ') : 'none'));
    return this._sched.onSeason(name, fn);
  }
  /**
   * Game seconds until the next clock mark (midnight, at times, between edges); engine.skip ends a segment there; Infinity when the time of day never moves
   * @internal
   */
  untilMark() { return Number.isFinite(this.dayLength) ? this._sched.untilNext() * this.dayLength : Infinity; }
  /** Number of registered clock-time / season timers, for engine.counts() @internal */
  get scheduled() { return this._sched.size; }

  /**
   * Update sky, lights and fog every frame (called by the module each frame)
   * @param {Vector3} focus
   * @returns {void}
   * @internal
   */
  update(focus) { updateSky(this, focus); }

  // Public shadow methods: implemented in shadow.js, declared here so type and doc tools see them (the rest is mixed in below)
  /**
   * Change shadow params (only the given fields): bias / normalBias prevent banding; updateEvery updates shadows every N frames (1 = every frame);
   * snap snap = shadow center snap grid (meters, or 'texel' to snap to shadow pixels); ahead = meters to shift the shadow center in front of the view;
   * type = 'basic' (hard edge) | 'pcf' | 'vsm' (soft, costlier; switching rebuilds the shadow map and recompiles materials, so do it rarely);
   * radius = edge softness (pcf, vsm; no effect on basic); blurSamples = blur quality (vsm only); cascades 2-4 = cascaded shadows, 1 = off (recipes/45)
   * @param {Partial<SkyShadowParams>} [opts]
   * @returns {this}
   */
  setShadow(opts) { return shadowMethods.setShadow.call(this, opts); }
  /**
   * Change shadow resolution (raise temporarily for photo mode)
   * @param {number} n  pixels
   * @returns {void}
   */
  setShadowMapSize(n) { return shadowMethods.setShadowMapSize.call(this, n); }
  /**
   * Environment lighting (scene.environment), separate from the background and off by default. source 'sky' builds it from the procedural sky (rebuilt at
   * most every `interval` seconds, only when the sky changed); an asset name or path (.hdr, .jpg, .ktx2) is an equirectangular panorama. intensity scales
   * the light (default 1), rotation turns it around Y (radians). Given fields change, the rest stay; null turns it off. Lambert surfaces get soft ambient
   * light from it (no reflections); lower the hemisphere ambient when you turn it on (recipes/09)
   * @example engine.sky.setEnvironment({ source: 'sky', intensity: 0.8 });  engine.sky.setEnvironment(null);
   * @param {{ source?: string | null, intensity?: number, rotation?: number, interval?: number } | null} [opts]
   * @returns {this}
   */
  setEnvironment(opts) { return environmentMethods.setEnvironment.call(this, opts); }
  /** Environment lighting now: { source, intensity, rotation, interval, builds }, null when off @type {SkyEnvironmentInfo | null} */
  get environment() { return environmentMethods._envInfo.call(this); }
}
// Mixed in from shadow.js and layers.js; methods the class already defines are kept
for (const [k, f] of Object.entries({ ...shadowMethods, ...layerMethods, ...environmentMethods })) if (!Object.hasOwn(Sky.prototype, k)) Sky.prototype[k] = f;

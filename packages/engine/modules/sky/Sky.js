// Sky module: dome shader (gradient + sun + moon + stars), sun/moon directional light, hemisphere ambient light and fog, all driven by time.
// Look (per-time colors, sun size, star density...) comes from style.sky in the style; the engine only holds neutral fallbacks.
//
// The time it draws is the calendar's (engine.calendar, modules/calendar): day, season and clock time are gameplay and live there, so a game
// without a sky (indoors) or with its own sky keeps its schedules. Without a calendar the sky draws one fixed time of day:
// engine.use(sky({ time: '17:30' }));                                    // a fixed sunset (arena, dungeon, a painted backdrop)
// engine.use(calendar({ time: 0.3, dayLength: 360 }), sky());            // a day-night cycle: the sky follows engine.calendar.timeOfDay
// Season tint: style seasons = { spring: { foliage: 0xffffff, ground: 0xffffff }, autumn: { foliage: 0xffb070 }, ... }, blended smoothly by the
//   calendar's season (season.js); no calendar or no seasons = no tint
// Clouds: style sky.clouds = { color, shade, coverage: 1, scale: 0.35, speed: [x, z], kind, glsl, ... } (coverage follows weather; see clouds.js)
// three.js objects: the lights it drives are engine.lights.sun (DirectionalLight; moonlight at night, shadows live on it) and engine.lights.hemi
//   (HemisphereLight ambient), dome (dome Mesh),
//   sunDir (Vector3 toward the sun). Light color/intensity is recomputed every frame: adjust brightness with engine.mod('sky.sunLight' | 'sky.ambient', { owner, mul }) (layers.js), or
//   take a light over with engine.look.lights.manual('sun' | 'hemi'), hide it with sky({ sun: false, hemisphere: false }) (look.js, core/owned.js); fog kinds and dome layers: fog.js, domeLayers.js;
//   engine.sky.modifiers is the composite of the sky.* mod entries (read-only)
// Skybox: style sky.skybox = '/textures/sky.jpg' (equirectangular panorama) replaces the gradient sky; brightness follows time
import * as THREE from 'three';
import { readParams } from '../../core/params.js';
import { renamed } from '../../core/validate.js';
import { NEUTRAL_KEYFRAMES, checkKeyframes, makeSkyUniforms, makeDome, loadSkybox } from './shader.js';
import { shadowMethods, shadowFor, SKY_BIAS } from './shadow.js';
import { defineSkyLook } from './lookSky.js';
import { defineFogLook } from './lookFog.js';
import { defineShadowLook } from './lookShadow.js';
import { layerMethods, blankLayer, defineSkyStacks } from './layers.js';
import { environmentMethods, environmentFor, defineEnvLook } from './environment.js';
import { updateSky, watchOwned, skyLight } from './frame.js';
import { prepareLook } from './look.js';
import { codedError } from '../../core/errorHints.js';
import { makeFog, setFogPatch, fogGameMaterials } from './fog.js';
import { ownedRow } from '../../core/owned.js';
import { parseClock } from '../../core/dayTime.js';
// style.sky.dim (types/style.d.ts StyleSky.dim): each look decision the sky makes for every game, on unless the style turns it off
const DIM_PARAMS = {
  tint: { type: 'bool', default: true, desc: 'a sky.tint color (weather grey, a cave tint) dims with the sky\'s own light, so a grey rain tint stays dark at night' },
  stars: { type: 'bool', default: true, desc: 'stars fade with the weather\'s cloud cover (uCloud), not only behind drawn clouds' },
};
/** @import { Object3D, Vector3 } from '../../types/common' */
/** @import { SkyOptions, SkyModifiers, SkyEnvironmentInfo } from '../../types/world' */
/** @import { Handle } from '../../types/common' */
/** @import { SkyShadowParams } from '../../types/style' */
/** engine.sky */
export class Sky {
  /** @internal */
  constructor(engine, { time = 0.33, ...over } = {}) {
    /** @internal */ this.engine = engine;
    const st = { ...(engine.style.sky || {}), ...over };
    /**
     * The time of day drawn while no calendar is installed (0-1; sky({ time: '17:30' }) or applyState({ time })); with engine.calendar the sky
     * draws the calendar's time and this is unused @type {number}
     */
    this.fixedTime = parseClock(time) % 1;
    /** @internal */ this.seasonStyle = engine.style.seasons || null;
    if (st.keyframes) checkKeyframes(st.keyframes);
    /** @internal */ this.kf = (st.keyframes || NEUTRAL_KEYFRAMES).map(k => [k[0], new THREE.Color(k[1]), new THREE.Color(k[2]), new THREE.Color(k[3]), k[4], k[5]]);
    // brightest row of the sky's ambient light (ambient column x the hemi color's brightness, frame.js skyLight): the sky's light now / this is
    // the 0-1 scale the sky.tint color (weather grey) follows
    /** @internal */ this._lightPeak = Math.max(...this.kf.map(k => skyLight(k[1], k[2], k[5])));
    /** @internal the sky.tint color dimmed by the sky's light this frame (frame.js) */ this._tintLit = new THREE.Color();
    // style.sky.dim: the look decisions the sky makes for every game unless the style turns them off (a fantasy sky can stay bright at night,
    // keep its stars through clouds). Booleans, default on; one option form for both, documented in types/style.d.ts StyleSky.dim
    /** @internal */ this.dim = readParams('style.sky.dim', DIM_PARAMS, st.dim ?? {});
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
    if (this._drive.fog !== false) setFogPatch(this, this._fog);   // exp / height: the 'fog' patch on this scene's materials (fog.js), not page-wide chunks
    ownedRow(engine, 'fog.patch', () => fogGameMaterials(this));
    defineFogLook(this, this._fogSpec);   // look.fog: style.sky.fog / sky({ fog }) is its style layer
    /** @internal engine.lights.hemi, driven by the sky (the one public name is engine.lights.hemi) @type {any} */
    this._hemi = engine.lights.hemi;
    /** @internal engine.lights.sun, driven by the sky (moonlight at night, shadows live on it; the one public name is engine.lights.sun) @type {any} */
    this._sun = engine.lights.sun;
    this._sun.castShadow = engine.shadows && this._drive.sun !== false;
    const sh = shadowFor(engine.tier, engine.style.sky?.shadow, over.shadow);
    this._sun.shadow.mapSize.set(sh.mapSize ?? 2048, sh.mapSize ?? 2048);
    const ext = sh.extent ?? 70;
    Object.assign(this._sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 420 });
    /** Sun direction (unit vector toward the sun) @type {Vector3} */
    this.sunDir = new THREE.Vector3();
    /**
     * Sun orbit: tilt = north-south tilt, sway = east-west swing, distance = light distance (meters) @type {{ tilt: number, sway: number, distance: number }}
     */
    this.orbit = { tilt: st.orbitTilt ?? 0.45, sway: st.orbitSway ?? 0.8, distance: sh.distance ?? 160 };
    // Shadow update policy (default: every frame, center snapped to 0.5 m)
    /** Current shadow params (change via look.shadow.set) @readonly @type {SkyShadowParams} */
    this.shadow = { bias: SKY_BIAS, normalBias: 0.04, updateEvery: 1, snap: 0.5, ahead: 0, type: engine.shadowType, radius: 1, blurSamples: 8,
      cascades: 1, maxFar: 120, fade: true, lightMargin: 100, split: 'practical', follow: 'focus', extent: ext };
    /** three's CSM (addons/csm) while shadow.cascades > 1, else null; its lights[0] is sun (recipes/45) @type {any} */
    this.csm = null;
    /** @internal */ this._shadowFrame = 0;
    /** @internal */ this._snapKey = '';
    defineShadowLook(this, sh);   // look.shadow: the style / options shadow is its style layer; look.shadow.set writes the game layer
    // Modifiers: weather and games each hold their own engine.mod entry on 'sky.sunLight' / 'sky.ambient' / 'sky.fog' / 'sky.flash' / 'sky.tint' /
    // 'sky.cover'; sky composites them into modifiers every frame and applies them on top of its own result (layers.js)
    /** @internal */ this._mods = defineSkyStacks(engine);
    /** Composite of the sky.* engine.mod entries (read-only; change it with engine.mod('sky.sunLight', { owner, mul })) @readonly @type {SkyModifiers} */
    this.modifiers = blankLayer();
    /** @internal */ this._lightDir = new THREE.Vector3();
    /** @internal */ this._env = null;
    const env = environmentFor(engine.tier, engine.style.sky?.environment, over.environment);
    defineEnvLook(this, env);   // look.env: the style / options environment is its style layer, look.env.replace writes the game layer
    defineSkyLook(this, st);   // look.sky: live cloud uniforms, backdrop, the clouds / layer:<name> hooks, skybox
    // the keyframes write these light keys every frame: describe().look shows them as style (driver sky) with the live value
    const D = this._drive;
    engine.look.lights.drive([...(D.sun === true ? ['sun.intensity', 'sun.color'] : []), ...(D.hemi === true ? ['hemi.intensity', 'hemi.color', 'hemi.ground'] : [])], 'sky');
    // Per-frame recomputed properties: direct edits by games get overwritten, so warn once in dev (frame.js)
    /** @internal */ this._owned = watchOwned(this);
  }

  /**
   * Shadow resolution (pixels)
   * @returns {number}
   */
  get shadowMapSize() { return this._sun.shadow.mapSize.x; }

  /** Time of day being drawn, 0-1: engine.calendar.timeOfDay, or fixedTime without a calendar. Read-only: the time itself is the calendar's */
  get drawnTime() { return this.engine.calendar?.timeOfDay ?? this.fixedTime; }
  /** Sun elevation -1 (midnight) ... 0 (horizon) ... 1 (noon) of the drawn sun (the calendar's daylight is the gameplay value) */
  get sunHeight() { return Math.sin((this.drawnTime - 0.25) * Math.PI * 2); }
  /** Whether the drawn sun is above the horizon (look functions: ({ sky }) => sky.isDay ? ...; gameplay reads engine.calendar.isDay) */
  get isDay() { return this.sunHeight > 0; }
  /** Daylight of the drawn sun 0-1 (0 at night, 1 at noon) */
  get daylight() { return Math.max(0, this.sunHeight); }

  /**
   * Update sky, lights and fog every frame (called by the module each frame)
   * @param {Vector3} focus
   * @returns {void}
   * @internal
   */
  update(focus) { updateSky(this, focus); }

  // Public shadow methods: implemented in shadow.js, declared here so type and doc tools see them (the rest is mixed in below)
  /**
   * Change shadow resolution (raise temporarily for photo mode)
   * @param {number} n  pixels
   * @returns {void}
   */
  setShadowMapSize(n) { return shadowMethods.setShadowMapSize.call(this, n); }
  /** Environment lighting now: { source, intensity, rotation, interval, builds }, null when off @type {SkyEnvironmentInfo | null} */
  get environment() { return environmentMethods._envInfo.call(this); }
}
// Mixed in from shadow.js and layers.js; methods the class already defines are kept
for (const [k, f] of Object.entries({ ...shadowMethods, ...layerMethods, ...environmentMethods })) if (!Object.hasOwn(Sky.prototype, k)) Sky.prototype[k] = f;
// Time moved to calendar() in 0.3: reading or writing these on the sky used to be silent (a stray own property that controls nothing), so in dev
// they throw naming engine.calendar. An explicit list of the names that actually moved (0.2's Sky had them): derived from the calendar contract
// it would also ban every future calendar name on the sky. The sky's own drawn isDay / daylight are not in it
renamed('engine.sky', Object.fromEntries(Object.entries({
  timeOfDay: 'engine.calendar.timeOfDay',
  day: 'engine.calendar.day',
  dayLength: 'engine.calendar.dayLength',
  daysPerSeason: 'engine.calendar.daysPerSeason',
  hoursPerDay: 'engine.calendar.hoursPerDay',
  seasons: 'engine.calendar.seasons',
  season: 'engine.calendar.season',
  seasonIndex: 'engine.calendar.seasonIndex',
  seasonProgress: 'engine.calendar.seasonProgress',
  dayOfSeason: 'engine.calendar.dayOfSeason',
  totalDays: 'engine.calendar.totalDays',
  clock: 'engine.calendar.clock',
  scheduled: 'engine.calendar.scheduled',
  at: 'engine.calendar.at',
  between: 'engine.calendar.between',
  daily: 'engine.calendar.daily',
  onSeason: 'engine.calendar.onSeason',
  untilMark: 'engine.calendar.untilMark'
}).map(([k, v]) => [k, `${v} (the sky only draws the calendar's time)`]))).on(Sky.prototype);

// Sky module: signals (engine.uniforms: uSunDir, uSunColor, uDaylight, uTimeOfDay, uSkyTop, uSkyHorizon, season, cover) and the dome (gradient + sun + moon + stars).
// It writes no light, fog, exposure or environment: the game's picture/ folder reads the signals and writes three.js (recipes/62).
// Per-time colors are sky({ keyframes }) / engine.sky.keyframes(rows); sun, moon, star and cloud numbers are engine.uniforms values (write .value, both renderers);
// the engine only holds neutral fallbacks.
//
// The time it draws is the calendar's (engine.calendar, modules/calendar): day, season and clock time are gameplay and live there, so a game
// without a sky (indoors) or with its own sky keeps its schedules. Without a calendar the sky draws one fixed time of day:
// engine.use(sky({ time: '17:30' }));                                    // a fixed sunset (arena, dungeon, a painted backdrop)
// engine.use(calendar({ time: 0.3, dayLength: 360 }), sky());            // a day-night cycle: the sky follows engine.calendar.timeOfDay
// Season tint: engine.sky.seasonTints = { spring: { foliage: 0xffffff, ground: 0xffffff }, autumn: { foliage: 0xffb070 }, ... }, blended smoothly by the
//   calendar's season (season.js); no calendar or no seasons = no tint
// Clouds: sky({ clouds: { color, shade, coverage: 1, scale: 0.35, speed: [x, z], kind, ... } }) (coverage follows weather; see clouds.js); your own function: engine.sky.clouds(spec)
// three.js objects: dome (dome Mesh), sunDir (Vector3 toward the sun). Dome layers: domeLayers.js
// Skybox: engine.sky.replace('sky.jpg') (equirectangular panorama) replaces the gradient sky; brightness follows time
import { engineOwned } from '../../core/things.js';
import * as THREE from 'three';
import { readParams } from '../../core/params.js';
import { NEUTRAL_KEYFRAMES, checkKeyframes, makeSkyUniforms, makeDome, loadSkybox } from './shader.js';
import { defineSkyPoints } from './tint.js';
import { environmentMethods } from './environment.js';
import { codedError } from '../../core/errorHints.js';
import { updateSky, watchOwned, skyLight } from './frame.js';
import { prepareDome, domeEntries } from './dome.js';
import { parseClock } from '../../core/dayTime.js';
import { onRendererSwap } from '../../render/backend.js';
// sky({ dim }) (SkyPictureOptions.dim in types/world.d.ts): each picture decision the sky makes for every game, on unless the game turns it off (engine.sky.dim is the live value)
const DIM_PARAMS = {
  tint: { type: 'bool', default: true, desc: 'a sky.tint color (weather grey, a cave tint) dims with the sky\'s own light, so a grey rain tint stays dark at night' },
  stars: { type: 'bool', default: true, desc: 'stars fade with the weather\'s cloud cover (uCloud), not only behind drawn clouds' },
};
/** @import { Object3D, Vector3 } from '../../types/common' */
/** @import { SkyOptions } from '../../types/world' */
/** @import { Handle } from '../../types/common' */
/** engine.sky */
export class Sky {
  /** @internal */
  constructor(engine, { time = 0.33, ...over } = {}) {
    /** @internal */ this.engine = engine;
    const st = over;
    if (st.environment) throw codedError('sky-option', 'sky({ environment }) is gone: call engine.sky.environment({ into: engine.scene }) for the sky as a map; an asset map is plain three.js (recipes/34)');
    /**
     * The time of day drawn while no calendar is installed (0-1; sky({ time: '17:30' }) or applyState({ time })); with engine.calendar the sky
     * draws the calendar's time and this is unused @type {number}
     */
    this.fixedTime = parseClock(time) % 1;
    /**
     * What each calendar season tints the plants and ground, read every frame, or null for no tint: plain data the game's picture/ code writes
     * @type {import('../../types/world').SeasonTints | null}
     */
    this.seasonTints = null;
    if (st.keyframes) checkKeyframes(st.keyframes);
    this._setKeyframes(st.keyframes || NEUTRAL_KEYFRAMES);
    /** @internal the sky.tint color dimmed by the sky's light this frame (frame.js) */ this._tintLit = new THREE.Color();
    /**
     * What the sky dims for every game, plain fields read each frame (a fantasy sky can stay bright at night, keep its stars through clouds):
     * tint false keeps a sky.tint color at full strength at any hour, stars false keeps the stars through the weather's cover @type {{ tint: boolean, stars: boolean }}
     */
    this.dim = readParams('sky.dim', DIM_PARAMS, st.dim ?? {});
    /** Zenith color over the keyframes, any THREE.Color input (null = the keyframes); read each frame @type {any} */
    this.top = null;
    /** Horizon color over the keyframes, any THREE.Color input (null = the keyframes); read each frame. The color drawn: engine.uniforms.uSkyHorizon @type {any} */
    this.horizon = null;
    const scene = engine.scene;

    const domeParts = prepareDome(this, st);   // backdrop, dome layers (dome.js)
    /** @internal */ this.uniforms = { ...makeSkyUniforms(st, engine.uniforms), ...domeParts.uniforms };
    /** Dome mesh @type {Object3D} */
    this.dome = makeDome(this.uniforms, st, domeParts, engine);
    scene.add(engineOwned('sky', this.dome));
    // fallback 'webgl': what the sky built for the WebGPURenderer start() then replaced is built again for the renderer in use: the dome
    // (with the hooks set so far, not only the options'). Why: any node object left behind either throws in the backend check or is silently not drawn.
    /** @internal */ this._swap = onRendererSwap(engine, () => {
      const old = this.dome, at = old.parent, vis = old.visible;
      this.dome = makeDome(this.uniforms, st, domeParts, engine);
      this.dome.visible = vis;
      at?.remove(old); at?.add(this.dome);
      old.geometry?.dispose(); [old.material].flat().forEach(m => m?.dispose());
      this._entries?.reapply();
      this._envSwap();
    });
    // Skybox (panorama): replaces the gradient sky when present
    /** @internal */ this.skybox = null;
    if (st.skybox) loadSkybox(this, st.skybox);

    /** Sun direction (unit vector toward the sun) @type {Vector3} */
    this.sunDir = new THREE.Vector3();
    /**
     * Sun orbit: tilt = north-south tilt, sway = east-west swing, distance = light distance (meters) @type {{ tilt: number, sway: number, distance: number }}
     */
    this.orbit = { tilt: st.orbitTilt ?? 0.45, sway: st.orbitSway ?? 0.8, distance: 160 };
    // the engine's own box on its placeholder sun, the sky's one job there: what is written on that light stays (render/lights.js holds the defaults).
    // createEngine({ lights: false }): the sun is not in the scene, nothing to place
    const box = engine.lights.sun.parent ? engine.shadows.sunBox({ follow: 'focus', snap: 0.5, ahead: 0 }, () => this.orbit.distance) : null;
    /** @internal */ this._shadowOff = () => box?.remove();
    /** @internal sky.flash / sky.tint / ground.cover (tint.js) */ this._points = defineSkyPoints(engine);
    /** @internal the tint holders blended this frame */ this._tintNow = { color: new THREE.Color(0x888888), amount: 0, horizon: 0 };
    /** @internal */ this._env = null;
    // what the sky still moves on its own, each yielding to a direct write (frame.js)
    /** @internal */ this._owned = watchOwned(this);
    /** @internal clouds / layer / replace (dome.js) */ this._entries = domeEntries(this, st);
  }

  /** The day's rows as colors (start, keyframes()) @internal */
  _setKeyframes(rows) {
    /** @internal */ this.kf = rows.map(k => [k[0], new THREE.Color(k[1]), new THREE.Color(k[2]), new THREE.Color(k[3]), k[4]]);
    // brightest row of the sky's ambient light (ambient column x the hemi color's brightness, frame.js skyLight): the sky's light now / this is
    // the 0-1 scale the sky.tint color (weather grey) follows
    /** @internal */ this._lightPeak = Math.max(...this.kf.map(k => skyLight(k[1], k[2], k[4])));
  }

  /**
   * The day's colors, live: rows [time, zenith, horizon, sunColor, ambient] sorted from 0 to 1 (the same rows as sky({ keyframes })).
   * Throws, changing nothing, on rows that are not sorted from 0 to 1.
   * @example engine.sky.keyframes([[0, 0x101828, 0x202838, 0x8090b0, 0.3], [0.5, 0x4080c0, 0xc0d8e8, 0xffffff, 1.2], [1, 0x101828, 0x202838, 0x8090b0, 0.3]]);
   * @param {any[][]} rows
   * @returns {void}
   */
  keyframes(rows) { checkKeyframes(rows); this._setKeyframes(rows); }

  /**
   * Your own cloud function on the dome: glsl defines `vec4 threedogClouds(vec3 dir, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cover)`,
   * tsl is its WebGPURenderer form (ctx) => vec4 node; each renderer needs its own form (modules/sky/clouds.js). null gives the built-in kind back.
   * Recompiles the dome once: a scene change, not every frame.
   * @example engine.sky.clouds({ glsl: 'vec4 threedogClouds(vec3 d, float t, vec3 s, float night, vec3 lit, vec3 shade, float cover){ return vec4(lit, step(0.5, threedogNoise(d.xz * 4.0)) * cover); }' });
   * @param {string | { glsl?: string, tsl?: Function, uniforms?: object } | null} spec
   * @returns {void}
   */
  clouds(spec) { this._entries.clouds(spec); }

  /**
   * Add, change or remove (null) a named dome layer drawn after the clouds and stars: glsl defines `vec4 threedogSkyLayer(vec3 dir, float time, vec3 sunDir, float night)`
   * returning (rgb, amount), tsl is its WebGPURenderer form (modules/sky/domeLayers.js). Recompiles the dome once.
   * @example engine.sky.layer('aurora', { glsl: 'vec4 threedogSkyLayer(vec3 d, float t, vec3 s, float n){ return vec4(0.2, 1.0, 0.5, n * smoothstep(0.1, 0.6, d.y) * 0.4); }', blend: 'add' });
   * @param {string} name
   * @param {string | { glsl?: string, tsl?: Function, uniforms?: object, order?: number, blend?: 'mix' | 'add' } | null} spec
   * @returns {void}
   */
  layer(name, spec) { this._entries.layer(name, spec); }

  /**
   * Replace or hide the dome: a skybox asset name (equirectangular panorama), a THREE.Texture / CubeTexture, or your own THREE.Object3D sky; null gives the dome back.
   * The engine never writes your object: it hides the dome, adds your object to the scene only when it has no parent, puts a plain texture's panorama
   * mapping on a clone, and keeps feeding engine.uniforms (uSunDir, uDaylight, uTimeOfDay, uWind ...).
   * @example engine.sky.replace(new SkyMesh());
   * @example engine.sky.replace(null);
   * @param {string | import('three').Texture | Object3D | null} sky
   * @returns {void}
   */
  replace(sky) { this._entries.replace(sky); }

  /**
   * One flat color in place of the dome, a THREE.Color while on, else null (sky({ backdrop }) starts with one). Set any THREE.Color input, null gives the dome back.
   * @type {any}
   */
  get backdrop() { return this._backdrop?.color ?? null; }
  set backdrop(v) { this._entries.backdrop(v); }

  /** Time of day being drawn, 0-1: engine.calendar.timeOfDay, or fixedTime without a calendar. Read-only: the time itself is the calendar's */
  get drawnTime() { return this.engine.calendar?.timeOfDay ?? this.fixedTime; }
  /** Sun elevation -1 (midnight) ... 0 (horizon) ... 1 (noon) of the drawn sun (the calendar's daylight is the gameplay value) */
  get sunHeight() { return Math.sin((this.drawnTime - 0.25) * Math.PI * 2); }
  /** Whether the drawn sun is above the horizon (picture functions: ({ sky }) => sky.isDay ? ...; gameplay reads engine.calendar.isDay) */
  get isDay() { return this.sunHeight > 0; }
  /** Daylight of the drawn sun 0-1 (0 at night, 1 at noon) */
  get daylight() { return Math.max(0, this.sunHeight); }

  /**
   * Update the signals and the dome every frame (called by the module each frame)
   * @returns {void}
   * @internal
   */
  update() { updateSky(this); }

  /**
   * Render the sky into an environment map. Only after this call is anything built: a PMREM target, rebuilt when the sky changed and interval seconds passed
   * (default 1, 4 times longer on a low-tier device). With into, that object's .environment gets the map at each rebuild (a map you wrote there yourself stays); without it nothing
   * is written anywhere and you read handle.texture. handle.remove() takes the map off and frees it. One at a time. Intensity and rotation are three.js: scene.environmentIntensity.
   * @example const env = engine.sky.environment({ into: engine.scene });
   * @example env.remove();
   * @param {{ into?: { environment: any }, interval?: number }} [options]
   * @returns {{ readonly texture: import('three').Texture | null, remove(): void }}
   */
  environment(options) { return environmentMethods._envStart.call(this, options); }
}
// Mixed in from shadow.js and environment.js; methods the class already defines are kept
for (const [k, f] of Object.entries(environmentMethods)) if (!Object.hasOwn(Sky.prototype, k)) Sky.prototype[k] = f;

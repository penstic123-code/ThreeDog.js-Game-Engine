// Sky environment lighting part (mixed into Sky.prototype): scene.environment from a procedural sky or an HDR / panorama asset.
//
// What three 0.187 does with scene.environment on a MeshLambertMaterial (read from the source, not assumed):
//   - WebGLPrograms.getParameters hands scene.environment to Standard, Lambert and Phong materials (usePMREM is true for Lambert without its own envMap).
//   - lights_fragment_maps adds getIBLIrradiance(normal) = PI * (the PMREM's blurriest mip in the world normal's direction) * envMapIntensity
//     to the diffuse light, so a Lambert surface gets soft, direction-dependent ambient light that is coloured by the environment.
//   - There is no specular term for Lambert with a PMREM map: the cube reflection mix in envmap_fragment only runs for ENVMAP_TYPE_CUBE.
//   - envMapIntensity comes from scene.environmentIntensity and the lookup direction is turned by scene.environmentRotation.
//   - Adding or removing scene.environment changes the program key of every Lambert material: one recompile at the switch, none after.
//   - The hemisphere light adds on top of it (a sky's own map; the room map shares the ambient column with it instead, render/lights.js roomShare).
// The sky builds no sky environment by default: the baseline is the neutral room environment (render/lights.js refreshRoom), built
// lazily once a material that reads scene.environment is in the scene, and under a sky it is a share of the style's ambient (look.lights
// env.share = the share, the hemisphere light gets the rest; ambient column x the hemi color's brightness x the weather's sky.ambient,
// frame.js / render/lights.js roomShare): one diffuse budget, not a second fill on top. Why it follows the day at all: a fixed room map lit every PBR
// surface as by day at midnight (demo finding 2026-11-02). look.env.replace('sky' | asset) swaps in the sky's own map (the sky map darkens by
// itself at night; an asset map is a fixed photo and does not follow).
import * as THREE from 'three';
import { warnOnce } from '../../core/validate.js';
import { defineLookPart, REPLACE } from '../../core/look/part.js';
import { defineOwned } from '../../core/owned.js';
import { refreshRoom, dropRoomEnvironment, followRoomEnvironment, isRoomEnvironment, roomEnvironmentInfo } from '../../render/lights.js';
import { codedError } from '../../core/errorHints.js';

const KEYS = ['source', 'intensity', 'rotation', 'interval'];
const DEFAULT_INTERVAL = 1;   // seconds between regenerations of a procedural environment (only when the sky actually changed)
/** The Texture behind a look.env.replace value that is not a string: a Texture / CubeTexture, or a render target (PMREM result) */
const texOf = v => (v?.isTexture ? v : v?.texture?.isTexture ? v.texture : null);
const STRINGS = {
  noSource: "look.env.replace(source): source is missing. Use 'sky' (built from the procedural sky) or the name of an HDR / panorama asset, " +
    "or look.env.replace(false) to turn the environment lighting off",
  badSource: "look.env.replace(source): source must be 'sky', an asset name / path (.hdr, .jpg, .ktx2...), a THREE.Texture / CubeTexture / PMREM render target, or null; got {got}. Example: engine.look.env.replace(myPmremTarget)",
};

/**
 * The environment settings to start with: the style's sky.environment overridden by sky({ environment }). On a low-tier device a procedural
 * environment regenerates 4 times less often, the style's environment.low overrides that, and low: false turns it off there. Returns null when off
 */
export function environmentFor(tier, styleEnv, optEnv) {
  const { low, ...env } = { ...styleEnv, ...optEnv };
  if (!env.source) return null;
  if (tier !== 'low') return env;
  return low === false ? null : { ...env, interval: (env.interval ?? DEFAULT_INTERVAL) * 4, ...low };
}

// Numbers that decide how the procedural sky looks right now: when they stay put the environment is not rebuilt
function skyKey(u) {
  const f = x => Math.round(x * 400);
  return [...u.uTop.value.toArray(), ...u.uHorizon.value.toArray(), ...u.uSunDir.value.toArray(), ...u.uSunColor.value.toArray(), u.uNight.value, u.uCloud.value].map(f).join(',');
}

/**
 * look.env: environment lighting as a look part. set({ intensity, rotation, interval }) tunes it, replace(source) swaps the map ('sky', an asset
 * name, or false = off), replace(null) gives it back to the style. The style layer is style.sky.environment merged with sky({ environment }).
 * Why the asset stays a name: loading belongs to engine.assets; the part only says which map to use.
 * @param {any} sky @param {object | null} env environmentFor(...) at start
 */
export function defineEnvLook(sky, env) {
  const e = sky.engine, scene = e.scene;
  let src = null, vals = { intensity: 1, rotation: 0, interval: DEFAULT_INTERVAL };
  const sync = () => (src ? sky._envApply({ source: src, ...vals }) : sky._envOff());
  // scene.environment is rebuilt from the sky on a timer: a game that sets its own map takes it (core/owned.js), the rebuilds stop
  sky._oEnv = defineOwned(e, { id: 'env', part: 'env', key: 'env', objects: [scene], read: () => [scene.environment, scene.environmentIntensity],
    levels: { manual: 'engine.look.env.manual()', set: 'engine.look.env.set({ intensity: 0.8 })', replace: "engine.look.env.replace('sky' | 'assetName' | false)" } });
  const { source, low, ...tune } = env ?? {};
  defineLookPart(e, {
    id: 'env', group: 'atmosphere', module: 'sky', object: () => scene.environment, docs: ['recipes/52-look.md'],
    params: {
      intensity: { type: 'number', default: 1, min: 0, neutral: true, cost: 'uniform', desc: 'scene.environmentIntensity' },
      rotation: { type: 'number', default: 0, neutral: true, cost: 'uniform', desc: 'turns the map around Y (radians)' },
      interval: { type: 'number', default: DEFAULT_INTERVAL, min: 0, neutral: true, cost: 'gpu', desc: "seconds between rebuilds of a 'sky' map (only when the sky changed)" },
    },
    style: () => ({ ...tune, ...(source ? { [REPLACE]: source } : {}) }),
    read: () => (src ? { intensity: scene.environmentIntensity, rotation: scene.environmentRotation.y } : {}),
    apply(v) { vals = v; sync(); },
    replace: { accepts: "'sky' (built from the procedural sky) | an asset name or path (.hdr, .jpg, .ktx2) | a THREE.Texture (equirect), CubeTexture or PMREM target of yours (used as is, never disposed) | false (off)", loses: ['nothing: intensity and rotation still apply to your map'] },
    applyReplace(impl) {
      if (impl != null && impl !== false && typeof impl !== 'string' && !texOf(impl)) throw codedError('sky-option', STRINGS.badSource.replace('{got}', String(impl)));
      src = impl || null; sync();
    },
    noPatch: 'environment lighting has no GLSL hook: it is a texture; swap it with look.env.replace(...) or tune it with look.env.set({ intensity })',
    info: () => ({ source: sourceInfo(sky) }),
  });
}

/**
 * describe().look.env.source: which map lights PBR now and whether it follows the time of day. Why: the old describe showed only
 * "intensity 1 (engine)", which read as "environment fine" while a fixed room map lit the street at midnight.
 * room = the engine's neutral generated map (look.lights env.share x the sky's ambient curve, or the absolute env.intensity a game wrote); sky = built from the dome; asset / texture =
 * the game's map through look.env.replace; game = scene.environment written directly; none
 */
function sourceInfo(sky) {
  const e = sky.engine, s = e.scene, o = sky._oEnv, env = sky._env;
  const writer = o.on ? 'engine' : o.info().writer, intensity = Math.round(s.environmentIntensity * 1000) / 1000;
  if (env) {
    const value = env.source === 'sky' ? 'sky' : typeof env.source === 'string' ? `asset:${env.source}` : 'texture';
    return { value, writer, followsTime: value === 'sky', intensity,
      ...(value === 'sky' ? {} : { note: "a fixed map: it does not dim at night; look.env.replace('sky') follows the sky, or set look.env.set({ intensity }) from your own onFrame"}) };
  }
  const room = roomEnvironmentInfo(e);
  if (isRoomEnvironment(e)) {
    const share = room.mode === 'share';
    return { value: 'room', writer, mode: room.mode, followsTime: o.on && share, intensity, ...(share ? { share: room.share } : { base: room.base }),
      note: !o.on ? 'neutral generated map; the game took scene.environmentIntensity, so it no longer follows the day'
        : share ? "neutral generated map, look.lights env.share of the style's ambient (ambient keyframes x sky color); the hemisphere light gets the rest"
        : 'neutral generated map at the absolute look.lights env.intensity the game wrote (does not follow the day; the hemisphere light keeps the whole ambient)' };
  }
  if (s.environment) return { value: 'game', writer, followsTime: false, intensity };
  return { value: room.pending ? 'room (built once a Standard / Lambert / Phong material is in the scene)' : 'none', writer, followsTime: room.pending };
}

export const environmentMethods = {
  // (the environment is changed through engine.look.env.replace(source) / .set({ intensity, rotation, interval }))
  // Apply settings to the scene (look.env's apply): a changed source rebuilds or reloads the map, the same source only retunes it
  _envApply(o) {
    const cur = this._env;
    const next = { source: cur?.source, intensity: cur?.intensity ?? 1, rotation: cur?.rotation ?? 0, interval: cur?.interval ?? DEFAULT_INTERVAL };
    for (const k of KEYS) if (o[k] !== undefined) next[k] = o[k];
    if (!next.source) throw codedError('sky-option', STRINGS.noSource);
    if (typeof next.source !== 'string' && !texOf(next.source)) throw codedError('sky-option', STRINGS.badSource.replace('{got}', String(next.source)));
    const scene = this.engine.scene, changed = next.source !== cur?.source;
    scene.environmentIntensity = next.intensity;
    scene.environmentRotation.set(0, next.rotation, 0);
    this._env = { ...next, key: null, since: 0, builds: cur?.builds ?? 0, token: (cur?.token ?? 0) + (changed ? 1 : 0), target: cur?.target ?? null, deferred: !this._envFramed };
    if (changed && typeof next.source !== 'string') this._envFromTexture(texOf(next.source));
    else if (changed && next.source !== 'sky') this._envFromAsset(next.source, this._env.token);
    else if (changed && this._envFramed) this._envBuild();
    return this;
  },

  // Each frame (updateSky): the room map follows the sky's light (frame.js skyLight). Only while look.env has no map of its own (that map has its own
  // intensity) and the engine still owns scene.environment (a direct write or look.env.manual() stops it, core/owned.js)
  _envFollow(scale) {
    const e = this.engine;
    if (this._env || !isRoomEnvironment(e)) { followRoomEnvironment(e, scale, false); return; }   // not built yet: syncRoomEnvironment builds it at this scale
    this._oEnv.check();
    if (this._oEnv.on) followRoomEnvironment(e, scale);
    this._oEnv.mark();
  },

  // Snapshot behind sky.environment (builds = times a procedural environment was generated); null when off
  _envInfo() {
    const e = this._env;
    return e ? { source: e.source, intensity: e.intensity, rotation: e.rotation, interval: e.interval, builds: e.builds } : null;
  },

  // Each frame: rebuild a procedural environment when its interval has passed and the sky moved (the first build waits for the first frame's colors)
  _envFrame(dt) {
    this._envFramed = true;
    const e = this._env;
    if (!e || e.source !== 'sky') return;
    e.since += dt;
    if (!e.deferred && e.since < e.interval) return;
    e.since = 0; e.deferred = false;
    this._oEnv.check();   // only here: the one moment the engine would overwrite scene.environment on its own
    if (this._oEnv.on && skyKey(this.uniforms) !== e.key) this._envBuild();
  },

  // Render the dome alone into a cube and prefilter it (PMREM). The dome mesh follows the camera, so a copy sharing its material is rendered
  _envBuild() {
    const e = this._env, r = this.engine.renderer;
    this._pmrem ??= new THREE.PMREMGenerator(r);
    if (!this._envScene) { this._envScene = new THREE.Scene(); this._envScene.add(new THREE.Mesh(this.dome.geometry, this.dome.material)); }
    const mesh = this._envScene.children[0];
    mesh.onBeforeRender = (rr, sc, cam) => { mesh.scale.setScalar(cam.far * 0.9); mesh.updateMatrixWorld(); };
    mesh.frustumCulled = false; mesh.renderOrder = -1000;
    this._envSet(this._pmrem.fromScene(this._envScene, 0, 0.1, 100, { size: 256 }));
    e.builds++; e.key = skyKey(this.uniforms);
  },

  // Panorama asset (.hdr goes through HDRLoader in the asset loader). A newer look.env.replace call makes the token stale and the late result is dropped
  _envFromAsset(name, token) {
    this.engine.assets.texture(name).then(t => {
      if (this._env?.token !== token || this.engine.disposed) return;
      t.mapping = THREE.EquirectangularReflectionMapping;
      this._pmrem ??= new THREE.PMREMGenerator(this.engine.renderer);
      this._envSet(this._pmrem.fromEquirectangular(t));
    }).catch(err => warnOnce(err.message));
  },

  // The game's own map (look.env.replace(texture)). Why not PMREM an already prefiltered one: a PMREM result from the game (isPMREMTexture; three 0.187 no longer exports CubeUVReflectionMapping) is used as is;
  // an equirect image / CubeTexture is prefiltered by the engine into a new one (engine-owned, released on replace); the game's original texture is never disposed, and none of its parameters other than mapping are touched
  _envFromTexture(t) {
    if (t.isPMREMTexture) { this._envSet({ texture: t, dispose() {} }); return; }
    this._pmrem ??= new THREE.PMREMGenerator(this.engine.renderer);
    if (t.isCubeTexture) { this._envSet(this._pmrem.fromCubemap(t)); return; }
    t.mapping = THREE.EquirectangularReflectionMapping;
    this._envSet(this._pmrem.fromEquirectangular(t));
  },

  _envSet(target) {
    this._env.target?.dispose();
    this._env.target = target;
    this.engine.scene.environment = target.texture;
    this._oEnv.mark();
  },

  _envOff() {
    if (!this._env && !this._pmrem) return;
    this._env?.target?.dispose();
    const e = this.engine, scene = e.scene;
    if (scene.environment === this._env?.target?.texture) {
      // back to what look.lights says (the room map of the render baseline at env.share / env.intensity), not to "nothing": the room
      // map was replaced by the sky's, and switching the sky's off must not leave PBR metals black where they were lit before
      // engine.dispose runs this from the sky's dispose hook: clear it then, never rebuild the room map that core frees right after
      scene.environment = null;
      if (!e.disposed) refreshRoom(e); else dropRoomEnvironment(e);   // set at once when built, else when a material reads it
      this._oEnv?.mark();   // the engine's own write, not the game's
    }
    this._env = null;
    this._pmrem?.dispose(); this._pmrem = null; this._envScene = null;
  },
};

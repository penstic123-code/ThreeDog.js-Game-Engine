// Sky environment lighting part (mixed into Sky.prototype): scene.environment from a procedural sky or an HDR / panorama asset.
//
// What three 0.187 does with scene.environment on a MeshLambertMaterial (read from the source, not assumed):
//   - WebGLPrograms.getParameters hands scene.environment to Standard, Lambert and Phong materials (usePMREM is true for Lambert without its own envMap).
//   - lights_fragment_maps adds getIBLIrradiance(normal) = PI * (the PMREM's blurriest mip in the world normal's direction) * envMapIntensity
//     to the diffuse light, so a Lambert surface gets soft, direction-dependent ambient light that is coloured by the environment.
//   - There is no specular term for Lambert with a PMREM map: the cube reflection mix in envmap_fragment only runs for ENVMAP_TYPE_CUBE.
//   - envMapIntensity comes from scene.environmentIntensity and the lookup direction is turned by scene.environmentRotation.
//   - Adding or removing scene.environment changes the program key of every Lambert material: one recompile at the switch, none after.
//   - The hemisphere light adds on top of it. A style that turns the environment on usually lowers its ambient column of sky.keyframes.
// The engine sets no environment by default, so the plain low-poly Lambert look is unchanged until a style or the game asks for one.
import * as THREE from 'three';
import { checkOptions, warnOnce } from '../../core/validate.js';

const KEYS = ['source', 'intensity', 'rotation', 'interval'];
const DEFAULT_INTERVAL = 1;   // seconds between regenerations of a procedural environment (only when the sky actually changed)
const STRINGS = {
  noSource: "sky.setEnvironment({ source }): source is missing. Use 'sky' (built from the procedural sky) or the name of an HDR / panorama asset, " +
    "or sky.setEnvironment(null) to turn the environment lighting off",
  badSource: "sky.setEnvironment({ source }): source must be 'sky', an asset name / path (.hdr, .jpg, .ktx2...) or null; got {got}",
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

export const environmentMethods = {
  /**
   * Environment lighting for the scene, separate from the background. Fields given change, the rest stay; null or { source: null } turns it off.
   * source 'sky' builds it from the procedural sky (rebuilt at most every `interval` seconds, and only when the sky changed); an asset name or path
   * (.hdr, .jpg, .ktx2) is an equirectangular panorama. intensity scales the light (default 1), rotation turns it around Y (radians)
   */
  setEnvironment(o) {
    const cur = this._env;
    if (o == null || o === false || o.source === null) { this._envOff(); return this; }
    checkOptions('sky.setEnvironment()', o, KEYS);
    const next = { source: cur?.source, intensity: cur?.intensity ?? 1, rotation: cur?.rotation ?? 0, interval: cur?.interval ?? DEFAULT_INTERVAL };
    for (const k of KEYS) if (o[k] !== undefined) next[k] = o[k];
    if (!next.source) throw new Error(STRINGS.noSource);
    if (typeof next.source !== 'string') throw new Error(STRINGS.badSource.replace('{got}', String(next.source)));
    const scene = this.engine.scene, changed = next.source !== cur?.source;
    scene.environmentIntensity = next.intensity;
    scene.environmentRotation.set(0, next.rotation, 0);
    this._env = { ...next, key: null, since: 0, builds: cur?.builds ?? 0, token: (cur?.token ?? 0) + (changed ? 1 : 0), target: cur?.target ?? null, deferred: !this._envFramed };
    if (changed && next.source !== 'sky') this._envFromAsset(next.source, this._env.token);
    else if (changed && this._envFramed) this._envBuild();
    return this;
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
    if (skyKey(this.uniforms) !== e.key) this._envBuild();
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

  // Panorama asset (.hdr goes through HDRLoader in the asset loader). A newer setEnvironment call makes the token stale and the late result is dropped
  _envFromAsset(name, token) {
    this.engine.assets.texture(name).then(t => {
      if (this._env?.token !== token || this.engine.disposed) return;
      t.mapping = THREE.EquirectangularReflectionMapping;
      this._pmrem ??= new THREE.PMREMGenerator(this.engine.renderer);
      this._envSet(this._pmrem.fromEquirectangular(t));
    }).catch(err => warnOnce(err.message));
  },

  _envSet(target) {
    this._env.target?.dispose();
    this._env.target = target;
    this.engine.scene.environment = target.texture;
  },

  _envOff() {
    if (!this._env && !this._pmrem) return;
    this._env?.target?.dispose();
    if (this.engine.scene.environment === this._env?.target?.texture) this.engine.scene.environment = null;
    this._env = null;
    this._pmrem?.dispose(); this._pmrem = null; this._envScene = null;
  },
};

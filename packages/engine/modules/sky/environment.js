// The sky as an environment map (mixed into Sky.prototype): engine.sky.environment({ into?, interval? }) renders the dome into a PMREM target, only once the
// game calls it. Nothing is written anywhere without `into`; asset maps, intensity and rotation are plain three.js (recipes/34).
//
// What three 0.187 does with scene.environment on a MeshLambertMaterial (read from the source, not assumed):
//   - WebGLPrograms.getParameters hands scene.environment to Standard, Lambert and Phong materials (usePMREM is true for Lambert without its own envMap).
//   - lights_fragment_maps adds getIBLIrradiance(normal) = PI * (the PMREM's blurriest mip in the world normal's direction) * envMapIntensity
//     to the diffuse light, so a Lambert surface gets soft, direction-dependent ambient light that is coloured by the environment.
//   - There is no specular term for Lambert with a PMREM map: the cube reflection mix in envmap_fragment only runs for ENVMAP_TYPE_CUBE.
//   - envMapIntensity comes from scene.environmentIntensity and the lookup direction is turned by scene.environmentRotation.
//   - Adding or removing scene.environment changes the program key of every Lambert material: one recompile at the switch, none after.
//   - The hemisphere light adds on top of it.
import * as THREE from 'three';
import { codedError } from '../../core/base/errorHints.js';
import { isWebGPU, webgpuPart } from '../../render/backend.js';

const DEFAULT_INTERVAL = 1;   // seconds between rebuilds (only when the sky actually changed)
const LOW_TIER_SLOWER = 4;    // by default a low-tier device rebuilds this many times less often (an interval the game gives stands): the cube cannot be made smaller (256 px is PMREMGenerator's floor)

// Numbers that decide how the procedural sky looks right now: when they stay put the environment is not rebuilt
function skyKey(u) {
  const f = x => Math.round(x * 400);
  return [...u.uTop.value.toArray(), ...u.uHorizon.value.toArray(), ...u.uSunDir.value.toArray(), ...u.uSunColor.value.toArray(), u.uNight.value, u.uWeatherCloud.value].map(f).join(',');
}

export const environmentMethods = {
  // engine.sky.environment(): the first build waits for the first frame's colors, later calls build at once
  _envStart({ into = null, interval = this.engine.tier === 'low' ? DEFAULT_INTERVAL * LOW_TIER_SLOWER : DEFAULT_INTERVAL, ...rest } = {}) {
    const bad = Object.keys(rest)[0];
    if (bad) throw codedError('sky-option', `engine.sky.environment({ ${bad} }): the options are into and interval. Intensity and rotation are plain three.js: scene.environmentIntensity, scene.environmentRotation`);
    if (into !== null && typeof into !== 'object') throw codedError('sky-option', 'engine.sky.environment({ into }): into is the object whose .environment is written, usually engine.scene');
    if (typeof interval !== 'number' || !(interval >= 0)) throw codedError('sky-option', `engine.sky.environment({ interval }): interval is seconds, 0 or more; got ${JSON.stringify(interval)}`);
    this._envOff();   // a second call replaces the first (a new interval, hot reload, another scene); the old handle's remove() then does nothing
    const env = this._env = { into, interval, key: null, since: 0, builds: 0, target: null, deferred: !this._envFramed };
    if (!env.deferred) this._envBuild();
    // a lost context takes the map's pixels with it, and the key cannot see that: with the sky standing still (a fixed hour) the map would stay black
    env.restored = this.engine.events.on('page:contextrestored', () => { env.key = null; env.deferred = true; });
    const sky = this;
    return { get texture() { return env.target?.texture ?? null; }, remove() { if (sky._env === env) sky._envOff(); } };
  },

  // Each frame: rebuild when the interval has passed and the sky moved (the first build waits for the first frame's colors)
  _envFrame(dt) {
    this._envFramed = true;
    const e = this._env;
    if (!e) return;
    e.since += dt;
    if (!e.deferred && e.since < e.interval) return;
    e.since = 0; e.deferred = false;
    if (skyKey(this.uniforms) !== e.key) this._envBuild();
  },

  // Render the dome alone into a cube and prefilter it (PMREM). The dome mesh follows the camera, so a copy sharing its material is rendered
  _envBuild() {
    const e = this._env, r = this.engine.renderer;
    // WebGPURenderer needs three/webgpu's PMREMGenerator (registered by threedog/tsl)
    this._pmrem ??= new (isWebGPU(r) ? webgpuPart('classes', 'engine.sky.environment').PMREMGenerator : THREE.PMREMGenerator)(r);
    if (!this._envScene) {
      this._envScene = new THREE.Scene();
      const copy = new THREE.Mesh(this.dome.geometry, this.dome.material);
      copy.onBeforeRender = (rr, sc, cam) => { copy.scale.setScalar(cam.far * 0.9); copy.updateMatrixWorld(); };
      copy.frustumCulled = false; copy.renderOrder = -1000;
      this._envScene.add(copy);
    }
    /** @type {any} */ (this._envScene.children[0]).material = this.dome.material;   // a game may have set engine.sky.dome.material
    const old = e.target, next = this._pmrem.fromScene(this._envScene, 0, 0.1, 100, { size: 256 });
    // a map the game wrote there since the last build is the game's: a direct three.js write takes the value over
    if (e.into && (!old || e.into.environment === old.texture)) e.into.environment = next.texture;
    e.target = next; old?.dispose();
    e.builds++; e.key = skyKey(this.uniforms);
  },

  // Renderer swap (fallback 'webgl'): the generator and the map belong to the old renderer, so the next frame builds them again on the new one
  _envSwap() {
    this._pmrem = null; this._envScene = null;
    if (this._env) { this._env.key = null; this._env.deferred = true; }
  },

  // handle.remove() and module dispose: what the engine wrote comes off, the GPU memory is released
  _envOff() {
    const e = this._env;
    e?.restored.remove();
    if (e?.into && e.target && e.into.environment === e.target.texture) e.into.environment = null;
    e?.target?.dispose();
    this._env = null;
    this._pmrem?.dispose(); this._pmrem = null; this._envScene = null;
  },
};

// Dome shader (gradient + sun + moon + stars + clouds), its uniforms, and neutral fallback keyframes. Look params come from style.sky.
import * as THREE from 'three';
import { warnOnce } from '../../core/validate.js';
import { NOISE_GLSL } from '../../render/effects.js';
import { resolveClouds, cloudUniforms, CLOUD_UNIFORM_DECL } from './clouds.js';
import { codedError } from '../../core/errorHints.js';

// Keyframes: [time 0-1, zenith color, horizon color (= fog color), light color, light intensity, ambient intensity]
// Neutral fallback when no style: pure gray (no hue), only brightness changes with time. Night holds from 19:12 to 04:48 (rows 0.2 / 0.8):
// with only the midnight row, 21:30 was halfway between dusk and midnight and read as late afternoon (demo finding 2026-11-02)
export const NEUTRAL_KEYFRAMES = [
  [0.00, 0x161616, 0x2a2a2a, 0xa8a8a8, 0.4, 0.35],
  [0.20, 0x161616, 0x2a2a2a, 0xa8a8a8, 0.4, 0.35],
  [0.25, 0x7c7c7c, 0xb4b4b4, 0xe4e4e4, 1.8, 0.8],
  [0.50, 0x989898, 0xd4d4d4, 0xffffff, 3.0, 1.2],
  [0.75, 0x7c7c7c, 0xb4b4b4, 0xe4e4e4, 1.8, 0.8],
  [0.80, 0x161616, 0x2a2a2a, 0xa8a8a8, 0.4, 0.35],
  [1.00, 0x161616, 0x2a2a2a, 0xa8a8a8, 0.4, 0.35],
];

/**
 * Check keyframes: sorted by time, from 0 to 1, no duplicate times. Anything else would extrapolate (black sky) or divide by
 * zero (NaN colors), so it throws with the fix.
 */
export function checkKeyframes(kf) {
  const times = Array.isArray(kf) ? kf.map(k => k?.[0]) : [];
  const bad = times.length < 2 || times[0] !== 0 || times[times.length - 1] !== 1
    || kf.some(k => !Array.isArray(k) || k.length < 6) || times.some((t, i) => i > 0 && !(t > times[i - 1]));
  if (bad) throw codedError('sky-option', `style.sky.keyframes must be [time, zenith, horizon, lightColor, lightIntensity, ambientIntensity] rows sorted by time, starting at 0 and ending at 1, with no time repeated; got times [${times.join(', ')}]`);
}

/** Dome uniforms from the style (st = style.sky + sky() options); time and cloud cover are the engine's (engine.uniforms) */
export function makeSkyUniforms(st, engineUniforms) {
  const cl = resolveClouds(st.clouds);   // throws on a bad kind / glsl / custom uniform before anything is built
  return {
    ...cloudUniforms(st.clouds, cl.kind), ...cl.uniforms,
    uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
    uSunDir: engineUniforms.uSunDir, uSunColor: { value: new THREE.Color() }, uNight: { value: 0 },
    uSunSize: { value: st.sunSize ?? 900 }, uSunGlow: { value: st.sunGlow ?? 0.18 }, uSunPower: { value: st.sunBrightness ?? 6 }, uMoonPower: { value: st.moonBrightness ?? 3 },
    uMoonSize: { value: st.moonSize ?? 1400 }, uMoonColor: { value: new THREE.Color(st.moonColor ?? 0xdcdcdc) },
    uTime: engineUniforms.uTime, uCloud: engineUniforms.uCloud, uCloudCover: { value: st.clouds?.coverage ?? (st.clouds ? 1 : 0) },
    uCloudScale: { value: st.clouds?.scale ?? 0.35 }, uCloudSpeed: { value: new THREE.Vector2(...(st.clouds?.speed ?? [0.004, 0.002])) },
    uCloudColor: { value: new THREE.Color(st.clouds?.color ?? 0xf4f4f4) }, uCloudShade: { value: new THREE.Color(st.clouds?.shade ?? 0xaaaaaa) },
    uStars: { value: st.starDensity ?? 0.0025 }, uStarScale: { value: st.starScale ?? 260 }, uCurve: { value: st.gradientCurve ?? 0.55 },
  };
}

/**
 * The sky dome: a back-faced sphere that follows the camera and is scaled to 0.9 of its far plane (drawn first, no depth).
 * extra = { decl, body }: GLSL added by fog.js (fog-colored horizon band) and domeLayers.js (style layers); empty keeps the plain shader text
 */
export function makeDome(uniforms, st, extra = { decl: '', body: '' }) {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: domeFragment(resolveClouds(st.clouds), extra), uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false }));
  dome.frustumCulled = false; dome.renderOrder = -1000; dome.userData.budgetTag = 'sky';
  dome.onBeforeRender = (r, sc, cam) => {
    dome.position.copy(cam.position); dome.scale.setScalar(/** @type {THREE.PerspectiveCamera} */ (cam).far * 0.9); dome.updateMatrixWorld();
  };
  return dome;
}

/** Panorama skybox (style sky.skybox): hides the gradient dome once the texture is wanted, becomes the scene background when loaded */
export function loadSkybox(sky, name) {
  const e = sky.engine;
  sky.dome.visible = false;
  e.assets.texture(name).then(t => { t.mapping = THREE.EquirectangularReflectionMapping; e.scene.background = t; sky.skybox = t; sky._oBg?.mark(); })
    .catch(err => warnOnce(err.message));
}

const vert = `varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
export const domeFragment = (cl, x) => `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight;
uniform float uSunSize; uniform float uSunGlow; uniform float uSunPower; uniform float uMoonPower; uniform float uMoonSize; uniform vec3 uMoonColor; uniform float uStars; uniform float uStarScale; uniform float uCurve;
uniform float uTime; uniform float uCloud; uniform float uCloudCover; uniform float uCloudScale; uniform vec2 uCloudSpeed; uniform vec3 uCloudColor; uniform vec3 uCloudShade;
${CLOUD_UNIFORM_DECL}
${cl.decl}${x.decl ? '\n' + x.decl : ''}
varying vec3 vDir;
float h3(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
${NOISE_GLSL}
${cl.glsl}
void main(){
  vec3 d = normalize(vDir);
  float y = max(d.y, 0.0);
  vec3 col = d.y < 0.0 ? uHorizon : mix(uHorizon, uTop, pow(y, uCurve));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, uSunSize) * uSunPower + pow(sd, 12.0) * uSunGlow) * step(0.0, uSunDir.y + 0.05);
  float md = max(dot(d, -uSunDir), 0.0);
  col += uMoonColor * pow(md, uMoonSize) * uMoonPower * uNight;
  vec3 g = floor(d * uStarScale);
  // Clouds: threedogClouds() is the style's (or a built-in kind's) cloud function, see clouds.js; coverage follows weather
  float cov = uCloud * uCloudCover, clA = 0.0;
  if (d.y > 0.0 && cov > 0.01) {
    vec4 cl = threedogClouds(d, uTime, uSunDir, uNight, uCloudColor, uCloudShade, cov);
    col = mix(col, cl.rgb, cl.a); clA = cl.a;
  }
  // Stars sit behind the clouds (hidden where a cloud is drawn) and dim with the weather's cloud cover (uCloud): a rainy / overcast night has
  // no clear sky between the drawn clouds either, and a style with sparse cloud art must not show a starry sky in a storm. Relative to the
  // weather value, no extra constant: uCloud 0 = every star, 1 = none
  col += vec3(step(1.0 - uStars, h3(g)) * uNight * smoothstep(0.0, 0.25, d.y) * (1.0 - clA) * (1.0 - clamp(uCloud, 0.0, 1.0)));${x.body}
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

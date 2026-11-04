// @ts-check
// Plain-picture sky and fog: a big gradient sphere drawn behind everything (the engine's dome is hidden; this one is the game's), with the fog in the horizon color.
import { THREE } from '../../../index.js';
import { DAY, NIGHT, nightOf } from './palette.js';

/** @param {any} engine */
export function createSky(engine) {
  const { scene } = engine;
  scene.fog = new THREE.Fog(0x000000, 20, 140);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // colorspace_fragment: the uniforms hold linear colors; without it the gradient comes out much darker than the hex values in palette.js
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vDir;
      void main(){ float h = smoothstep(-0.05, 0.45, vDir.y); gl_FragColor = vec4(mix(uHorizon, uTop, h), 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
  skyDome.renderOrder = -1;
  scene.add(skyDome);
  if (engine.sky) engine.sky.dome.visible = false;

  const top = new THREE.Color(), horizon = new THREE.Color(), tmp = new THREE.Color();
  return {
    /** @param {any} signals engine.uniforms */
    update(signals) {
      const day = signals.uDaylight.value, night = nightOf(day), rain = signals.uRain.value;
      top.copy(NIGHT.top).lerp(DAY.top, day);
      horizon.copy(NIGHT.horizon).lerp(DAY.horizon, day).lerp(tmp.copy(signals.uSkyHorizon.value), 0.15);   // follow the engine's sky a little (dusk tints)
      if (rain) { top.lerp(tmp.set(0x4a4a58), rain * 0.6); horizon.lerp(tmp.set(0x5a5a66), rain * 0.6); }
      skyMat.uniforms.uTop.value.copy(top); skyMat.uniforms.uHorizon.value.copy(horizon);
      if (scene.fog instanceof THREE.Fog) { scene.fog.color.copy(horizon); scene.fog.near = 30 - 14 * night - rain * 10; scene.fog.far = 160 - 60 * night - rain * 60; }
    },
  };
}

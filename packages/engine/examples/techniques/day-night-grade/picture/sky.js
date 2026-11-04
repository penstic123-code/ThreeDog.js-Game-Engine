// @ts-check
// The sky is the game's: a gradient sphere from the keyframes, with fog in the horizon color. The engine's dome is hidden.
import { THREE } from 'threedog';
import { skyColor } from './palette.js';

/** @param {any} engine */
export function createSky(engine) {
  const { scene } = engine;
  scene.fog = new THREE.Fog(0x000000, 180, 600);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // tonemapping_fragment: the sky takes the same curve and exposure as the street, so a dusk horizon and a dusk wall stay in one picture
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vDir;
      void main(){ gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(-0.05, 0.45, vDir.y)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
  dome.renderOrder = -1;
  scene.add(dome);
  if (engine.sky) engine.sky.dome.visible = false;
  return {
    /** @param {any} s engine.uniforms */
    update(s) {
      const t = s.uTimeOfDay.value, u = skyMat.uniforms;
      skyColor(u.uTop.value, 1, t); skyColor(u.uHorizon.value, 2, t);
      /** @type {THREE.Fog} */ (scene.fog).color.copy(u.uHorizon.value);
    },
  };
}

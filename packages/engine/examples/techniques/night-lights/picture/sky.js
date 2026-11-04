// @ts-check
// The sky is this page's: a gradient sphere in place of the engine's dome, with fog in the horizon color.
import { THREE } from 'threedog';
import { DAY, FOG, NIGHT, dayLevel } from './palette.js';

/** @param {any} engine */
export function createSky(engine) {
  const { scene } = engine, fog = new THREE.Fog(0x000000, FOG.near, FOG.far);
  scene.fog = fog;
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // tonemapping_fragment: the sky takes the same curve as the street, with or without the post chain (?bloom=0 draws straight to the canvas)
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

  const day = new THREE.Color();
  return {
    /** @param {any} s engine.uniforms */
    update(s) {
      const k = dayLevel(s.uDaylight.value), { uTop, uHorizon } = skyMat.uniforms;
      uTop.value.set(NIGHT.top).lerp(day.set(DAY.top), k);
      uHorizon.value.set(NIGHT.horizon).lerp(day.set(DAY.horizon), k);
      fog.color.copy(uHorizon.value);
    },
  };
}

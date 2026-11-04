// @ts-check
// The sky is the game's: a gradient sphere and fog in its horizon color, blended by daylight. The engine's dome is hidden. The environment is
// three's RoomEnvironment: soft fill with some direction, no asset; the zones write its strength.
import { THREE } from 'threedog';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FOG, SKY } from './palette.js';

/** @param {any} engine */
export function createSky(engine) {
  const { scene, renderer } = engine;
  scene.fog = new THREE.Fog(SKY.day.horizon, FOG.near, FOG.far);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // tonemapping_fragment: the sky takes the room's curve and exposure, so the window runs bright indoors and calms down outside, as the zones intend
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
  const day = { top: new THREE.Color(SKY.day.top), horizon: new THREE.Color(SKY.day.horizon) }, night = { top: new THREE.Color(SKY.night.top), horizon: new THREE.Color(SKY.night.horizon) };
  return {
    /** @param {any} s engine.uniforms */
    update(s) {
      const light = s.uDaylight.value, u = skyMat.uniforms;
      u.uTop.value.copy(night.top).lerp(day.top, light);
      u.uHorizon.value.copy(night.horizon).lerp(day.horizon, light);
      /** @type {THREE.Fog} */ (scene.fog).color.copy(u.uHorizon.value);
    },
  };
}

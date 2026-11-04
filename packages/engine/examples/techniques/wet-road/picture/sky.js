// @ts-check
// The sky is the game's: a gradient sphere, fog in its horizon color, and the same sphere baked once into scene.environment so wet gloss has something
// to reflect by day. The engine's dome is hidden.
import { THREE } from 'threedog';
import { ENV, FOG, SKY } from './palette.js';

/** @param {any} engine */
export function createSky(engine) {
  const { scene, renderer } = engine;
  const fog = scene.fog = new THREE.Fog(SKY.dayHorizon, FOG.near, FOG.far);
  const day = { top: new THREE.Color(SKY.dayTop), horizon: new THREE.Color(SKY.dayHorizon) };
  const night = { top: new THREE.Color(SKY.nightTop), horizon: new THREE.Color(SKY.nightHorizon) };
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: day.top.clone() }, uHorizon: { value: day.horizon.clone() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // tonemapping_fragment: the sky takes the same curve and exposure as the street, so fogged walls and the horizon behind them stay one color
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vDir;
      void main(){ gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(-0.05, 0.45, vDir.y)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
  dome.renderOrder = -1;

  // baked once, in day colors: at night ENV.night dims it, one number per frame where a re-bake would cost six renders and a blur
  const pmrem = new THREE.PMREMGenerator(renderer), room = new THREE.Scene();
  room.add(dome);
  scene.environment = pmrem.fromScene(room, 0, 1, 1000).texture;   // far past the sphere: the default far of 100 clips it away
  pmrem.dispose();
  scene.add(dome);
  if (engine.sky) engine.sky.dome.visible = false;

  return {
    /** @param {any} s engine.uniforms @param {number} level the lamps' level, 0 day .. 1 night */
    update(s, level) {
      const u = skyMat.uniforms;
      u.uTop.value.copy(day.top).lerp(night.top, level);
      u.uHorizon.value.copy(day.horizon).lerp(night.horizon, level);
      fog.color.copy(u.uHorizon.value);
      fog.near = FOG.near * s.uWeatherFog.value; fog.far = FOG.far * s.uWeatherFog.value;
      scene.environmentIntensity = ENV.day + (ENV.night - ENV.day) * level;
    },
  };
}

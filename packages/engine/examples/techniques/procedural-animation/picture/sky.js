// @ts-check
// A gray gradient sphere in place of the engine's dome. No fog: the floor ends at 30 m, too near for fog to show.
import { THREE } from 'threedog';
import { SKY } from './palette.js';

/** @param {any} engine */
export function createSky(engine) {
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vDir;
      void main(){ gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(0.0, 0.6, vDir.y)), 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY.radius, 32, 16), skyMat);
  dome.renderOrder = -1;
  engine.scene.add(dome);
  engine.sky.dome.visible = false;
  const day = new THREE.Color(), night = new THREE.Color(), { uTop, uHorizon } = skyMat.uniforms;
  return {
    /** @param {any} s engine.uniforms */
    update(s) {
      const light = s.uDaylight.value;
      uTop.value.copy(night.set(SKY.nightTop)).lerp(day.set(SKY.dayTop), light);
      uHorizon.value.copy(night.set(SKY.nightHorizon)).lerp(day.set(SKY.dayHorizon), light);
      dome.position.copy(engine.camera.position);   // the camera walks with the creature; the sky must not come closer
    },
  };
}

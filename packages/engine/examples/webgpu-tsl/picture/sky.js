// @ts-check
// The sky is the game's: a gradient sphere in a TSL node material (a ShaderMaterial does not run on this route), with fog in the horizon color.
// The engine's dome is hidden; its signals still drive the day.
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { mix, normalize, positionLocal, smoothstep, uniform } from 'three/tsl';
import { FOG, SKY, dayLevel } from './palette.js';

/** @param {any} engine */
export function createSky(engine) {
  const { scene } = engine;
  const fog = scene.fog = new THREE.Fog(SKY.day.horizon, FOG.near, FOG.far);
  const top = new THREE.Color(), horizon = new THREE.Color(), c = new THREE.Color();
  const mat = new MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  mat.colorNode = mix(uniform(horizon), uniform(top), smoothstep(-0.05, 0.45, normalize(positionLocal).y));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  dome.name = 'sky';
  dome.renderOrder = -1;
  scene.add(dome);
  if (engine.sky) engine.sky.dome.visible = false;
  return {
    /** @param {any} s engine.uniforms */
    update(s) {
      const day = dayLevel(s.uDaylight.value);
      top.set(SKY.night.top).lerp(c.set(SKY.day.top), day);
      horizon.set(SKY.night.horizon).lerp(c.set(SKY.day.horizon), day);
      fog.color.copy(horizon);
    },
  };
}

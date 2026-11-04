import * as THREE from 'three';
const a = new THREE.Color(0x101020), b = new THREE.Color(0x8090a0);
export function createSky(engine) {
  engine.scene.fog = new THREE.Fog(0x101020, 5, 50);
  let t = 0;
  return { update() {
    t += 0.01;
    const fog = engine.scene.fog;
    fog.color.copy(a);
    fog.color.lerp(b, 0.5 + 0.5 * Math.sin(t));   // two lines, one function: a value computed in steps, no fight
    if (window.mode === 'fight') fog.far = 40;
    if (window.mode === 'dayOnly') fog.near = 8;
  } };
}

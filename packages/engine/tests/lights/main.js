// Test scene for the light pool (tests/specs/lights.mjs): a 200 m corridor with 40 torches along it and a pool of 4 real point lights.
// Headless: the spec moves the camera with engine.step and reads renderer.info.programs and the scene's lights.
import { createEngine, lightPool, THREE } from '../../index.js';
import { neutralMaterial } from '../../render/neutral.js';
import { lightSetup } from '../../core/inspect/lightWatch.js';

const engine = createEngine({ canvas: document.getElementById('view'), headless: true, ui: { loading: false }, saveKey: 'threedog-lights-test' });
engine.use(lightPool({ point: 4, fade: 0.2 }));
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 220), neutralMaterial('terrain'));
floor.rotation.x = -Math.PI / 2; floor.position.z = -100;
engine.add(floor);
const torches = [], halos = [];
for (let i = 0; i < 40; i++) {
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2, 0.2), neutralMaterial('prop'));
  pole.position.set(i % 2 ? 4 : -4, 1, -i * 5);
  // the halo stands in for the light while the torch has none: its own material, so each torch fades on its own
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), neutralMaterial('default', { emissive: 0xffa040, emissiveIntensity: 2 }));
  halo.position.y = 1.2; pole.add(halo);
  engine.add(pole);
  torches.push(engine.lightPool.add(halo, { name: 'torch' + i, color: 0xffa040, intensity: 4, distance: 8, glow: halo.material,
    flicker: (t, n) => 0.85 + 0.15 * Math.sin(t * 13 + n) }));
  halos.push(halo);
}
engine.camera.position.set(0, 1.7, 5);
window.threedogTest = { THREE, torches, halos, lightSetup };
window.engine = engine;
engine.start();

// `threedog stress` in a game: the part that runs in the game's own page (stress.mjs injects it). The load goes on top of the game's scene and draws through the game's own
// renderer, so the answer is "this game, on this renderer, drops at this load". Same `window.stress` shape as the neutral page tests/stress/main.js, which stays for the engine's
// docs/testing/perf.md table and keeps the axes that depend on a picture (shadows, post effects): in a game those are the game's own choice, so they are not ramped here. What the two share is
// stress-load.js.
import * as THREE from 'three';
import { boxes, tiles, instances, lights, freeLoad, meter } from './stress-load.js';

const e = window.engine, camera = e.camera;
e.haltLoop();   // a live loop would draw between the measured steps

const gray = new THREE.MeshStandardMaterial({ color: 0xa0a0a0, roughness: 0.8 }), box = new THREE.BoxGeometry(1, 1, 1);
let load = null;
/** A fresh group filling the view 20 m ahead of the camera, facing it: every game has its own scale and camera, and load the camera cannot see would be culled and cost nothing */
function fresh() {
  if (load) { load.removeFromParent(); freeLoad(load, box); }
  const dir = camera.getWorldDirection(new THREE.Vector3()), far = 20;
  load = new THREE.Group();
  load.position.copy(camera.getWorldPosition(new THREE.Vector3())).addScaledVector(dir, far);
  load.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
  const tall = 2 * far * Math.tan(THREE.MathUtils.degToRad(camera.fov ?? 50) / 2);
  load.scale.setScalar(Math.min(tall * (camera.aspect ?? 1.7) / 90, tall / 66));   // the field fits both ways: what falls outside is culled while the load column still counts it
  e.scene.add(load);
}
const AXES = {
  drawCalls: { unit: 'extra meshes', start: 250, cap: 256000, build(n) { boxes(load, n, box, gray); } },
  triangles: { unit: 'extra triangles', start: 5e5, cap: 128e6, build(n) { tiles(load, n, gray); } },
  instances: { unit: 'extra instances', start: 50000, cap: 12.8e6, build(n) { instances(load, n, box, gray); } },
  lights: { unit: 'extra point lights', start: 2, cap: 512, build(n) { lights(load, n); } },
};

window.stress = {
  axes: Object.fromEntries(Object.entries(AXES).map(([k, a]) => [k, { unit: a.unit, start: a.start, cap: a.cap, ladder: false }])),
  set(axis, n) { fresh(); AXES[axis].build(n); },
  next: (axis, n) => n * 2,
  measure: meter(e),
  maxTexture: () => Infinity,
  ready: true,
};

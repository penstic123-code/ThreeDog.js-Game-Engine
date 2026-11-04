// Test scene for lightmaps: a sunlit floor and a red wall marked static, one instanced row marked static (the bake must skip it), one unmarked crate (left out).
// tests/specs/lightmap.mjs uses it with a small hand-made file; `threedog bake light --page /tests/lightmap/index.html` bakes it for real on a GPU.
// ?webgpu=1 draws it on WebGPURenderer, ?map=<path> loads a baked file: the real-GPU run compares the two pictures. ?ambient=1 keeps the hemisphere on.
import * as TG from 'three/webgpu';
import 'threedog/tsl';
import { createEngine, THREE } from '../../index.js';

const url = new URLSearchParams(location.search), gpu = url.has('webgpu');
const engine = createEngine({ canvas: document.getElementById('view'), headless: !gpu && !url.has('map'), ui: { loading: false }, saveKey: 'threedog-lightmap-test', pixelRatio: 1, adaptiveResolution: false, urlState: false, ...(gpu ? { renderer: 'webgpu' } : {}) });
const std = c => new (gpu ? TG.MeshStandardNodeMaterial : THREE.MeshStandardMaterial)({ color: c });
const mesh = (name, g, c, x, y, z, fixed = true) => { const m = new THREE.Mesh(g, std(c)); m.name = name; m.position.set(x, y, z); m.userData.static = fixed; engine.add(m); return m; };
const floor = mesh('floor', new THREE.BoxGeometry(12, 0.2, 12), 0xcccccc, 0, -0.1, 0);
const wall = mesh('wall', new THREE.BoxGeometry(0.4, 4, 12), 0xcc2010, 5.8, 2, 0);
const back = mesh('back', new THREE.BoxGeometry(12, 4, 0.4), 0x1040cc, 0, 2, -5.8);
const crate = mesh('crate', new THREE.BoxGeometry(1, 1, 1), 0x888888, -2, 0.5, 2, false);
const row = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), std(0x44aa44), 4);
row.name = 'row'; row.userData.static = true;
for (let i = 0; i < 4; i++) row.setMatrixAt(i, new THREE.Matrix4().makeTranslation(-4 + i, 0.25, -3));
engine.add(row);
const hemi = new THREE.HemisphereLight(0xbcd0ff, 0x404040, 2); hemi.name = 'skyFill';
const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(-6, 10, 6);
engine.scene.add(hemi, sun, sun.target);
engine.camera.position.set(-5, 5, 9); engine.camera.lookAt(1, 1, -1);
window.threedogTest = { THREE, floor, wall, back, crate, row, hemi, sun };
window.engine = engine;
await engine.start();
if (url.get('map')) {
  window.threedogTest.map = await engine.loadLightmap(url.get('map'));
  if (!url.has('ambient')) hemi.intensity = 0;
}
window.lightmapReady = true;

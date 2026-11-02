// Parity page (tests/specs/owned.mjs): the same small scene drawn by plain three.js and by the engine with its look shortcuts off
// (no sky, no engine lights, no post, no style), on the same render baseline. Same pixels = the engine adds nothing hidden
// (no patch on game materials, no extra light, no hidden pass). The baseline itself (AgX, sRGB output, shadows, neutral room environment)
// is what the engine documents for every engine-owned renderer; the plain renderer is set up the same way by hand, as a game without the engine would.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createEngine } from '../../index.js';

const W = 160, H = 120;

/** The game's scene content, built twice (once per renderer): plain three.js objects and materials only */
function build(scene) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x7a8a6a, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: 0xc04030, roughness: 0.5, metalness: 0.2 }));
  box.position.set(-1.5, 1, 0); box.castShadow = true;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshLambertMaterial({ color: 0x3060c0 }));
  ball.position.set(1.8, 1, 0.5); ball.castShadow = true;
  ball.userData.batch = false; box.userData.batch = false;   // parity is about look, not the batching optimization
  const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(5, 10, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
  scene.add(ground, box, ball, sun, new THREE.AmbientLight(0xffffff, 0.3));
}
const place = cam => { cam.fov = 50; cam.aspect = W / H; cam.near = 0.1; cam.far = 200; cam.position.set(0, 5, 10); cam.lookAt(0, 0.5, 0); cam.updateProjectionMatrix(); };

const engine = window.engine = createEngine({ canvas: document.getElementById('view'), lights: false, pixelRatio: 1, adaptiveResolution: false,
  ui: { loading: false }, saveKey: 'test-parity', urlState: false });
build(engine.scene);
await engine.start();
engine.pause();

/** Render both, return { mean, max, lit } over RGBA bytes (lit: share of pixels brighter than black, so a blank canvas cannot pass) */
window.parity = () => {
  const R = engine.renderer;
  place(engine.camera);
  engine.step(1 / 60);
  const a = new Uint8Array(W * H * 4), gl = R.getContext();
  engine.step(1 / 60); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a);

  // plain three.js: the same baseline settings a careful three.js setup would use
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const r = new THREE.WebGLRenderer({ canvas, antialias: false });
  r.setPixelRatio(1); r.setSize(W, H, false);
  r.toneMapping = THREE.AgXToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true; r.shadowMap.type = R.shadowMap.type;
  // the engine tone-maps a Color background like any other pixel (render/PostFX.js _direct: drawn as a 1x1 linear texture, so effects on / off
  // agree); the documented baseline, done here by hand the same way (plain three would leave a clear color untone-mapped)
  const bgc = engine.scene.background, bgt = new THREE.DataTexture(new Float32Array([bgc.r, bgc.g, bgc.b, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  bgt.colorSpace = THREE.LinearSRGBColorSpace; bgt.needsUpdate = true;
  const scene = new THREE.Scene(); scene.background = bgt;
  const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = engine.scene.environmentIntensity;
  build(scene);
  const cam = new THREE.PerspectiveCamera(); place(cam);
  r.render(scene, cam);
  const b = new Uint8Array(W * H * 4), g2 = r.getContext(); g2.readPixels(0, 0, W, H, g2.RGBA, g2.UNSIGNED_BYTE, b);
  let sum = 0, max = 0, lit = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > max) max = d; }
  for (let i = 0; i < a.length; i += 4) if (a[i] + a[i + 1] + a[i + 2] > 30) lit++;
  r.dispose(); pm.dispose(); bgt.dispose();
  return { mean: +(sum / a.length).toFixed(3), max, lit: +(lit / (W * H)).toFixed(2),
    engine: { tone: R.toneMapping, env: !!engine.scene.environment, envI: engine.scene.environmentIntensity, size: [R.domElement.width, R.domElement.height] } };
};

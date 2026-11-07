// Parity page (tests/specs/owned.mjs): the same small scene drawn by plain three.js and by the engine with its picture shortcuts off
// (no sky, no engine lights, no post, no style), on the same render baseline. Same pixels = the engine adds nothing hidden
// (no patch on game materials, no extra light, no hidden pass). The baseline itself (three.js's own tone mapping default, sRGB output, shadows; the neutral room environment
// only with the engine's lights on, so not here: lights: false) is what the engine documents for every engine-owned renderer; the plain renderer is set up the same way by hand, as a game without the engine would.
// ?backend=webgpu: the same check on the WebGPU route, createEngine({ renderer: 'webgpu' }) against a plain WebGPURenderer on the backend the
// engine actually got (webgpu, or webgl2 where the browser has no WebGPU), so the comparison is never WebGPU against WebGL2 drivers.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createEngine } from '../../index.js';

const W = 160, H = 120;
const GPU = new URLSearchParams(location.search).get('backend') === 'webgpu';
// three/webgpu only on the WebGPU variant: the WebGL page stays a plain WebGL game (threedog/tsl is what a WebGPU game imports first)
const TG = GPU ? (await import('threedog/tsl'), await import('three/webgpu')) : null;

/** The game's scene content, built twice (once per renderer): plain three.js objects and materials only */
function build(scene) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x7a8a6a, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: 0xc04030, roughness: 0.5, metalness: 0.2 }));
  box.position.set(-1.5, 1, 0); box.castShadow = true;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshLambertMaterial({ color: 0x3060c0 }));
  ball.position.set(1.8, 1, 0.5); ball.castShadow = true;
  ball.userData.batch = false; box.userData.batch = false;   // parity is about the picture, not the batching optimization
  const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(5, 10, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
  scene.add(ground, box, ball, sun, new THREE.AmbientLight(0xffffff, 0.3));
}
const place = cam => { cam.fov = 50; cam.aspect = W / H; cam.near = 0.1; cam.far = 200; cam.position.set(0, 5, 10); cam.lookAt(0, 0.5, 0); cam.updateProjectionMatrix(); };

const engine = window.engine = createEngine({ canvas: document.getElementById('view'), lights: false, pixelRatio: 1, adaptiveResolution: false,
  ui: { loading: false }, saveKey: 'test-parity', urlState: false, ...(GPU && { renderer: 'webgpu' }) });
build(engine.scene);
await engine.start();
engine.haltLoop();

/** RGBA bytes of a canvas just drawn (same task, before the browser presents it); the one read for both sides of the WebGPU variant */
function canvasPixels(c) {
  const g = /** @type {CanvasRenderingContext2D} */ (Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d', { willReadFrequently: true }));
  g.drawImage(c, 0, 0, W, H);
  return new Uint8Array(g.getImageData(0, 0, W, H).data.buffer);
}

/** The plain renderer with the baseline a careful three.js setup would use, set by hand @param {HTMLCanvasElement} canvas @returns {Promise<any>} */
async function plainRenderer(canvas) {
  const R = engine.renderer;
  // the engine turns MSAA on by tier: the plain side asks the same, or every edge differs on a machine in a high tier
  const antialias = engine.post.antialias;
  const r = GPU ? new TG.WebGPURenderer({ canvas, antialias, forceWebGL: engine.describe().renderer.backend === 'webgl2' }) : new THREE.WebGLRenderer({ canvas, antialias });
  if (GPU) await r.init();
  r.setPixelRatio(1); r.setSize(W, H, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true; r.shadowMap.type = R.shadowMap.type;
  return r;
}

/** Render both, return { mean, max, lit } over RGBA bytes (lit: share of pixels brighter than black, so a blank canvas cannot pass) */
window.parity = async () => {
  const R = engine.renderer;
  place(engine.camera);
  engine.step(1 / 60);
  let a;
  if (GPU) { engine.step(1 / 60); a = canvasPixels(R.domElement); }
  else { a = new Uint8Array(W * H * 4); const gl = R.getContext(); engine.step(1 / 60); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a); }

  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const r = await plainRenderer(canvas);
  // the engine tone-maps a Color background like any other pixel (render/PostFX.js _direct: drawn as a 1x1 linear texture, so effects on / off
  // agree); the documented baseline, done here by hand the same way (plain three would leave a clear color untone-mapped)
  const bgc = engine.scene.background, bgt = new THREE.DataTexture(new Float32Array([bgc.r, bgc.g, bgc.b, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  bgt.colorSpace = THREE.LinearSRGBColorSpace; bgt.needsUpdate = true;
  const scene = new THREE.Scene(); scene.background = bgt;
  let pm = null;
  if (engine.scene.environment) {   // none with lights: false; kept so the page shows the baseline again if that ever changes
    pm = GPU ? new TG.PMREMGenerator(r) : new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = engine.scene.environmentIntensity;
  }
  build(scene);
  // the one thing the engine adds on WebGPU: a Lambert / Phong material gets scene.environment's diffuse fill, as three's WebGLRenderer gives
  // it and plain WebGPURenderer does not (render/fx/patchNodes.tsl.js environmentDiffuse). Written out here by hand with WebGL's formula
  // (PI * roughest PMREM level along the world normal * environmentIntensity, times Lambert's albedo / PI), so the rest stays compared 1:1
  if (GPU && scene.environment) {
    const T = await import('three/tsl'), ball = scene.children.find(o => o.material?.isMeshLambertMaterial), env = scene.environment;
    const m = new TG.MeshLambertNodeMaterial({ color: ball.material.color });
    m.emissiveNode = T.pmremTexture(env, T.normalWorld, T.float(1)).rgb.mul(scene.environmentIntensity).mul(T.materialColor.rgb);
    ball.material = m;
  }
  const cam = new THREE.PerspectiveCamera(); place(cam);
  r.render(scene, cam);
  let b;
  if (GPU) { r.render(scene, cam); b = canvasPixels(canvas); }   // read right after a render, in the same task, like the engine side
  else { b = new Uint8Array(W * H * 4); const g2 = r.getContext(); g2.readPixels(0, 0, W, H, g2.RGBA, g2.UNSIGNED_BYTE, b); }
  let sum = 0, max = 0, lit = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > max) max = d; }
  for (let i = 0; i < a.length; i += 4) if (a[i] + a[i + 1] + a[i + 2] > 30) lit++;
  // where pixels differ (debug aid in the result): count over 8 and their box
  let bad = 0, box = [W, H, -1, -1];
  for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 8) {
    bad++; const x = (i / 4) % W, y = Math.floor(i / 4 / W); box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
  }
  r.dispose(); pm?.dispose(); bgt.dispose();
  return { mean: +(sum / a.length).toFixed(3), max, lit: +(lit / (W * H)).toFixed(2), bad, box: bad ? box : null, backend: engine.describe().renderer.backend,
    engine: { tone: R.toneMapping, tier: engine.tier, msaa: engine.post.antialias, env: !!engine.scene.environment, envI: engine.scene.environmentIntensity, size: [R.domElement.width, R.domElement.height] } };
};

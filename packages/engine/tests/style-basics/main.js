// Style basics page (tests/specs/style-basics.mjs): what a stylized NodeMaterial really draws. One sphere and one tall box on a ground under a sun,
// read as pixels: three's toon with a gray and with a colored ramp, celLighting with the same ramps, and a positionNode that moves a caster.
// Plain three.js scene on a hand-made WebGPURenderer: forceWebGL here, real-webgpu.mjs removes the word.
import * as THREE from 'three';
import { WebGPURenderer, MeshToonNodeMaterial, MeshLambertNodeMaterial } from 'three/webgpu';
import { positionLocal, vec3 } from 'three/tsl';
import { celLighting } from 'threedog/tsl';
import { createEngine, rampTexture } from '../../index.js';

const W = 240, H = 180;
// the test runner waits for window.engine; the scene below is plain three.js and never touches it
const engine = window.engine = createEngine({ canvas: document.getElementById('view'), lights: false, pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, saveKey: 'test-style-basics', urlState: false });
await engine.start();
engine.haltLoop();
const r = new WebGPURenderer({ canvas: Object.assign(document.createElement('canvas'), { width: W, height: H }), antialias: false, forceWebGL: true });
await r.init();
r.setPixelRatio(1); r.setSize(W, H, false);
r.toneMapping = THREE.NoToneMapping; r.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
sun.position.set(6, 8, 3); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 30 });
scene.add(sun, new THREE.AmbientLight(0xffffff, 0.4));
const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100); camera.position.set(0, 7, 11); camera.lookAt(0, 0.6, 0); camera.updateMatrixWorld();

const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24)); ball.position.set(2, 1, 0);
const post = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1)); post.position.set(-2, 1.5, 0);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2));
ball.castShadow = post.castShadow = true; ball.receiveShadow = ground.receiveShadow = true;
scene.add(ball, post, ground);

const read = () => { const c = Object.assign(document.createElement('canvas'), { width: W, height: H }), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(r.domElement, 0, 0); return x.getImageData(0, 0, W, H).data; };
const pxOf = w => { const v = new THREE.Vector3(...w).project(camera); return [Math.round((v.x + 1) / 2 * W), Math.round((1 - v.y) / 2 * H)]; };
const at = (img, w) => { const [x, y] = pxOf(w), i = (y * W + x) * 4; return [img[i], img[i + 1], img[i + 2]]; };

// the sun stands at +x +z, so the box's shadow falls to -x -z (first spot); the second spot is open ground; the third is the ball's side turned from the sun
const shadowSpot = [-3.6, 0, -0.7], openSpot = [3.5, 0, 3], turnedAway = [1.1, 1.2, 0.38];
// three redraws a shadow map once per node frame, and only its animation loop or the engine (backend.js) advances that frame
const draw = () => { r._nodes.nodeFrame.update(); r.render(scene, camera); };
const shot = mat => { for (const m of [ball, post, ground]) m.material = mat; draw(); return read(); };
/** Colors covering a square on the ball, each quantized to 64 levels; a color needs 8 pixels to count, so edge pixels do not */
const bandsOf = img => {
  const [x0, y0] = pxOf(ball.position.toArray()), seen = new Map();
  for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) { const i = ((y0 + dy) * W + x0 + dx) * 4, k = [img[i] >> 2, img[i + 1] >> 2, img[i + 2] >> 2].join(); seen.set(k, (seen.get(k) ?? 0) + 1); }
  return [...seen.values()].filter(n => n >= 8).length;
};
const spots = img => ({ shadow: at(img, shadowSpot), open: at(img, openSpot), away: at(img, turnedAway), bands: bandsOf(img) });

const gray = rampTexture([0.25, 0.6, 1]), colored = rampTexture([0x3040c0, 0x9098e0, 0xffffff]);
const toon = map => new MeshToonNodeMaterial({ color: 0xffffff, gradientMap: map });
const cel = map => { const m = toon(map); m.setupLightingModel = celLighting; return m; };

window.styleBasics = async () => {
  const out = { backend: r.backend.constructor.name };
  out.toonGray = spots(shot(toon(gray)));
  out.toonColored = spots(shot(toon(colored)));
  out.celGray = spots(shot(cel(gray)));
  out.celColored = spots(shot(cel(colored)));
  out.celNoRamp = spots(shot(cel(null)));
  ball.receiveShadow = false;
  out.celNoReceive = spots(shot(cel(colored)));
  ball.receiveShadow = true;
  // a point light that casts: the model must take the shadow out of a light color that also holds distance falloff
  sun.visible = false;
  const lamp = new THREE.PointLight(0xffffff, 60); lamp.position.set(5, 5, 4); lamp.castShadow = true; scene.add(lamp);
  out.celPoint = spots(shot(cel(colored)));
  scene.remove(lamp); sun.visible = true;
  // a caster moved only by positionNode, sharing its geometry with a plain one: its shadow must leave the old spot
  const plain = new MeshLambertNodeMaterial({ color: 0xffffff }), moved = new MeshLambertNodeMaterial({ color: 0xffffff });
  moved.positionNode = positionLocal.add(vec3(0, 0, 6));
  ball.material = ground.material = post.material = plain;
  draw(); out.casterStill = at(read(), shadowSpot);
  const other = post.clone(); other.material = moved; post.visible = false; scene.add(other);
  draw(); out.casterMoved = at(read(), shadowSpot);
  return out;
};

// Picture freedom page (tests/specs/picture-freedom.mjs). Why: a game picks its own look with plain three.js (pixel art, wireframe, node materials, a module
// that edits a material), and the engine must neither pick for it nor undo it across its own lifecycle. The page only builds the engine and reads pixels;
// the spec decides what to do to it. URL: route=webgpu (+ fallback=webgl2, the default for the test machine) picks WebGPURenderer, else WebGL.
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import * as TSL from 'three/tsl';
import 'threedog/tsl';
import { createEngine, world, content, inventory } from '../../index.js';

const q = new URLSearchParams(location.search), K = 4;
const engine = window.engine = createEngine({ canvas: document.getElementById('c'), lights: false, ui: { loading: false }, urlState: false, saveKey: 'test-picture-freedom',
  adaptiveResolution: false, pixelSize: K, ...(q.get('route') === 'webgpu' ? { renderer: 'webgpu', fallback: q.get('fallback') ?? 'webgl2' } : {}) });
engine.use(world(), content(), inventory());
await engine.start();
engine.haltLoop();
engine.scene.background = new THREE.Color(0x000000);
engine.camera.position.set(0, 0, 8); engine.camera.lookAt(0, 0, 0);

/** Draw one frame and read the canvas in the same task (renderOnce, then drawImage, as webgpu-tsl does) */
const read = () => {
  engine.renderOnce();
  const src = engine.renderer.domElement, c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0);
  return { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
};
/** Pixels inside a mesh's on-screen box (shrunk by `inset` so its edge is not counted) as [r,g,b] rows (row-major, `.w` pixels per row); mesh.userData.half is its half size in meters */
const inside = (s, mesh, inset = 0.2) => {
  const v = mesh.position.clone().project(engine.camera), cx = (v.x + 1) / 2 * s.w, cy = (1 - v.y) / 2 * s.h;
  const px = mesh.userData.half * (1 - inset) * s.h / (2 * 8 * Math.tan(engine.camera.fov * Math.PI / 360)), out = [];
  out.w = 0;
  for (let y = Math.floor(cy - px); y < cy + px; y++) for (let x = Math.floor(cx - px); x < cx + px; x++) { if (y === Math.floor(cy - px)) out.w++; const i = (y * s.w + x) * 4; out.push([s.d[i], s.d[i + 1], s.d[i + 2]]); }
  return out;
};
window.freedom = { THREE, TG, TSL, engine, K, read, inside, createEngine, world, content };
window.ready = true;

// renderOnce / photo / probe bake page (tests/specs/render-once.mjs), run on a WebGL engine and on a renderer: 'webgpu' engine (webgpu, or its
// webgl2 fallback headless). Why two pictures in one task: WebGPURenderer draws a RenderPipeline's scene pass (pass()) once per node frame and
// advances that frame only in its own requestAnimationFrame tick, so a second render in the same task showed the first picture again
// (docs/plans/2026-11-03-webgpu-phase2.md section 3, known issue 2). Every canvas read happens in the task of its render: no preserveDrawingBuffer.
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import 'threedog/tsl';   // what a WebGPU game imports first
import { vignette, bloom } from '@threedog/post-effects';
import { createEngine, photo } from '../../index.js';

const W = 160, H = 120;
const base = { lights: true, pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, urlState: false };
const canvas = () => { const c = Object.assign(document.createElement('canvas'), { width: W, height: H }); c.style.cssText = `width:${W}px;height:${H}px`; document.body.appendChild(c); return c; };
// the page's own engine (the test runner waits for window.engine); the cases below build one engine per backend
const engine = window.engine = createEngine({ canvas: canvas(), ...base, lights: false, saveKey: 'test-render-once' });
await engine.start();
engine.pause();

/** A small scene: three colored unlit boxes in a row and a red wall on +x (the probe bake must see red) */
function fill(e) {
  const box = (x, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, 0.5, 0); return m; };
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 20), new THREE.MeshBasicMaterial({ color: 0xff0000 })); wall.position.set(3.6, 3, 0);
  e.scene.add(box(-2, 0x2050ff), box(0, 0x20ff50), box(2, 0xffffff), wall);
  e.scene.background = new THREE.Color(0x101418);
}
const cam = x => { const c = new THREE.PerspectiveCamera(50, W / H, 0.1, 100); c.position.set(x, 2, 5); c.lookAt(x, 0.5, 0); c.updateMatrixWorld(); return c; };
/** Point the engine camera at x (left box -2, right box 2) */
const aim = (e, x) => { e.camera.position.set(x, 2, 5); e.camera.lookAt(x, 0.5, 0); };

/** Pixels of a render target (WebGPU: async read-back) */
async function readTarget(r, rt) {
  if (r.isWebGPURenderer) return new Uint8Array(await r.readRenderTargetPixelsAsync(rt, 0, 0, W, H));
  const b = new Uint8Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, b); return b;
}
/** An image source (canvas, img) as pixels, read now (for a canvas: call in the task that drew it) */
const pixels = src => { const c = Object.assign(document.createElement('canvas'), { width: W, height: H }), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
/** % of pixels that differ by more than a small step */
const changed = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) d++; return +(100 * d / (a.length / 4)).toFixed(2); };
/** The same pixels with the rows in the other order */
const flipRows = a => { const o = new Uint8Array(a.length), row = W * 4; for (let y = 0; y < H; y++) o.set(a.subarray(y * row, y * row + row), (H - 1 - y) * row); return o; };
const mean = a => { let s = 0; for (let i = 0; i < a.length; i += 4) s += a[i] + a[i + 1] + a[i + 2]; return +(s / (a.length / 4 * 3)).toFixed(2); };
/** Size and brightness spread of a data: URL image: spread 0 is a blank (one-color) picture */
async function imageSpread(url) {
  const img = new Image(); img.src = url; await img.decode();
  const px = pixels(img);
  let lo = 765, hi = 0; for (let i = 0; i < px.length; i += 4) { const v = px[i] + px[i + 1] + px[i + 2]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return { w: img.naturalWidth, h: img.naturalHeight, spread: hi - lo };
}
/** Every record in the game layer of every drawing part, as 'part:owner: keys' */
const gameRecords = e => { const out = e.stacks.list().filter(n => n.startsWith('post.')).flatMap(n => e.stacks.get(n).holders().map(h => `${n}:${h.owner}`)); return out; };
/** Two engine-camera frames through post in one task, camera moved in between: % of pixels that changed */
const postPair = e => { aim(e, -2); e.renderOnce(); const p1 = pixels(e.renderer.domElement); aim(e, 2); e.renderOnce(); return changed(p1, pixels(e.renderer.domElement)); };

/** One engine's cases on the backend opts asks for */
async function cases(opts) {
  const e = createEngine({ canvas: canvas(), ...base, saveKey: `test-render-once-${opts.renderer ?? 'webgl'}`, ...opts });
  e.use(photo());
  fill(e);
  await e.start();
  e.pause();
  const r = e.renderer, out = { backend: e.describe().renderer.backend };
  const Target = r.isWebGPURenderer ? TG.RenderTarget : THREE.WebGLRenderTarget;

  // 1. two cameras into two targets in one task, read after both: the second render must not repeat the first
  const a = new Target(W, H), b = new Target(W, H);
  e.renderOnce(a, cam(-2)); e.renderOnce(b, cam(2));
  const pa = await readTarget(r, a), pb = await readTarget(r, b);
  out.targets = { changed: changed(pa, pb), meanA: mean(pa), meanB: mean(pb) };
  a.dispose(); b.dispose();

  // 2. through post (vignette on: on WebGPU a RenderPipeline with a pass() scene pass), the engine camera moved between two calls in one task
  const vig = e.post.add(vignette({ enabled: true }));
  out.post = { active: e.post.active, changed: postPair(e) };
  // 2b. renderOnce(target) through post: the finished frame lands in the target with the canvas's pixels (the WebGL chain's last pass
  // writes to the canvas, so this needs post.render(dt, target)); read both orientations, since a WebGL target reads bottom row first
  aim(e, -2); e.renderOnce(); const onCanvas = pixels(r.domElement);
  const t = new Target(W, H); e.renderOnce(t); const inT = await readTarget(r, t); t.dispose();
  const straight = changed(onCanvas, inT), flipped = changed(onCanvas, flipRows(inT));
  out.postTarget = { straight, flipped, best: Math.min(straight, flipped), mean: mean(inT), canvasMean: mean(onCanvas) };
  // 3. the loop's own frame right after a renderOnce() in the same task (step renders at the end) draws its camera, not the earlier picture
  aim(e, -2); e.renderOnce(); const before = pixels(r.domElement);
  aim(e, 2); e.step(1 / 60, { describe: false }); out.stepAfter = changed(before, pixels(r.domElement));

  // 4. a photo on this backend, post included: a real picture, not blank
  out.photo = await imageSpread(e.photo.take({ format: 'image/png' }).url);
  // 4b. a photo that forces bloom on for the shot: bloom applies for the shot only and leaves no record in any drawing part's game layer
  vig.remove(); e.post.add(bloom({ enabled: false })); e.post.add(vignette({ enabled: true }));
  const records0 = gameRecords(e);
  e.photo.take({ bloom: true });
  out.photoPicture = { before: records0, after: gameRecords(e), bloomAfter: e.post.get('bloom').enabled };

  // 5. a probe bake on this backend: the red wall on +x reaches the probes (DC red above DC blue)
  const set = await e.bakeProbes({ bounds: { min: [-1, 0.5, -1], max: [1, 1.5, 1] }, spacing: 2, resolution: 8 });
  // the grid has to reach a lit pixel on this renderer, baked and from its file: a lit slab in the grid, grid off then on
  const slab = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), new (r.isWebGPURenderer ? TG.MeshLambertNodeMaterial : THREE.MeshLambertMaterial)({ color: 0xffffff }));
  slab.position.set(0, 1, 0); e.scene.add(slab); aim(e, 0);
  const shot = async () => { const rt = new (r.isWebGPURenderer ? TG.RenderTarget : THREE.WebGLRenderTarget)(W, H); e.renderOnce(rt); const m = mean(await readTarget(r, rt)); rt.dispose(); return m; };
  set.grid.visible = false; const off = await shot();
  set.grid.visible = true; const on = await shot();
  const json = JSON.parse(JSON.stringify(set.toJSON()));
  set.remove();
  const file = e.loadProbes(json), fromFile = await shot();
  out.probes = { count: set.count, finite: set.sh.every(Number.isFinite), red: set.sh[0], blue: set.sh[2], half: file.grid.texture.type === THREE.HalfFloatType, off, on, fromFile, dc: Array.from({ length: 8 }, (_, i) => [set.sh[i * 27], set.sh[i * 27 + 2], set.sh[i * 27 + 3]].map(v => +v.toFixed(3))) };
  file.remove(); slab.removeFromParent();
  e.dispose();
  return out;
}

/** The control run: case 2 on the WebGPU route with three's node frame frozen (what one task looks like without engine.renderOnce's frame
 *  advance). It must repeat the first picture, or the guard above would pass on a backend where the bug cannot happen */
async function control() {
  const e = createEngine({ canvas: canvas(), ...base, saveKey: 'test-render-once-control', renderer: 'webgpu' });
  fill(e); await e.start(); e.pause();
  e.post.add(vignette({ enabled: true }));
  e.renderOnce();   // build the pipeline outside the frozen part
  const f = e.renderer._nodes.nodeFrame, update = f.update;
  f.update = () => {};
  try { return { changed: postPair(e) }; } finally { f.update = update; e.dispose(); }
}

window.renderOnceCases = async () => ({ webgl: await cases({}), webgpu: await cases({ renderer: 'webgpu' }), control: await control() });

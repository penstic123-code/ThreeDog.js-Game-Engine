// A game assigns a real three.js camera to engine.camera (tests/specs/native-camera.mjs). Each measure runs on WebGLRenderer and on WebGPURenderer (its WebGL2 backend here):
// the picture, the post chain, a pick, a cascaded shadow, a resize and a swap back, under a real OrthographicCamera and a real PerspectiveCamera. Why a page of its own: every
// holder of the camera has to be seen drawing from the new one, so the measures read pixels at the spot the assigned camera projects to.
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import 'threedog/tsl';
import { createEngine, sky, followCamera } from '../../index.js';
import { fitOrtho } from '../../core/scene/view.js';
import { vignette, outline } from '@threedog/post-effects';

const W = 160, H = 120;
const noDome = { name: 'test-no-dome', type: 'rules', install(e) { e.sky.dome.removeFromParent(); return {}; } };   // the dome is GLSL: the WebGPU route refuses it, shadows need none

function canvasOf() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `width:${W}px;height:${H}px`;
  document.body.append(canvas);
  return canvas;
}
function engineOn(route, more = []) {
  const canvas = canvasOf(), o = { pixelRatio: 1, adaptiveResolution: false, antialias: false, ui: { loading: false }, urlState: false, saveKey: 'test-native-camera' };
  let renderer = null;
  if (route === 'webgpu') { renderer = new TG.WebGPURenderer({ canvas, antialias: false, forceWebGL: true }); renderer.shadowMap.enabled = true; }
  const e = createEngine(renderer ? { ...o, renderer } : { ...o, canvas });
  e.use(sky({ time: '10:00' }), noDome, ...more);
  return e;
}
const read = c => {
  const x = Object.assign(document.createElement('canvas'), { width: c.width, height: c.height }).getContext('2d', { willReadFrequently: true });
  x.drawImage(c, 0, 0); return { d: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
};
/** one frame drawn and read in the same task (no preserveDrawingBuffer needed) */
const shot = e => { e.step(1 / 30, { describe: false }); return read(e.renderer.domElement); };
const px = (s, x, y) => { const i = (y * s.w + x) * 4; return [s.d[i], s.d[i + 1], s.d[i + 2]]; };
/** Mean color around where the camera projects a world point, and its NDC */
function spot(s, cam, p) {
  const v = new THREE.Vector3(...p).project(cam), cx = Math.round((v.x + 1) / 2 * (s.w - 1)), cy = Math.round((1 - v.y) / 2 * (s.h - 1)), m = [0, 0, 0];
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) px(s, cx + x, cy + y).forEach((c, i) => { m[i] += c / 9; });
  return { rgb: m.map(Math.round), ndc: [v.x, v.y] };
}
/** Share of pixels (%) changed by more than tol, and how many of them lie within r pixels of a screen point */
function changed(a, b, tol = 12, near = null, r = 16) {
  let n = 0, close = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const p = px(a, x, y), q = px(b, x, y);
    if (Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2])) <= tol) continue;
    n++;
    if (near && Math.hypot(x - near[0], y - near[1]) <= r) close++;
  }
  return { share: +(100 * n / (a.w * a.h)).toFixed(2), close };
}
const corner = s => { const a = px(s, 2, 2), b = px(s, s.w - 3, 2); return (a[0] + a[1] + a[2] + b[0] + b[1] + b[2]) / 6; };
const code = fn => { try { fn(); return null; } catch (err) { return err.code ?? String(err.message); } };
const RED = [-4, 1, 0], BLUE = [4, 1, 0];

function world(e) {
  const lit = c => new THREE.MeshLambertMaterial({ color: c }), add = (geo, mat, p, name) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.name = name; e.scene.add(m); return m; };
  const ground = add(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), lit(0xb0b0b0), [0, 0, 0], 'ground');
  ground.receiveShadow = true;
  const box = new THREE.BoxGeometry(2, 2, 2), red = add(box, lit(0xff2010), RED, 'red'), blue = add(box, lit(0x1030ff), BLUE, 'blue');
  const caster = add(new THREE.BoxGeometry(3, 1, 3), lit(0x30d040), [0, 4, 3], 'caster');
  for (const m of [red, blue]) { m.castShadow = true; e.rays.addStatic(m); }
  return { caster };
}

/** What one camera shows: the two boxes, the pick, a shadow, the post chain */
function measure(e, { caster }) {
  const cam = e.camera, s = shot(e), red = spot(s, cam, RED), blue = spot(s, cam, BLUE);
  const hit = n => e.pick(n[0], n[1])?.object?.name ?? null;
  caster.castShadow = false; const free = shot(e);
  caster.castShadow = true; const dark = shot(e);
  const shadow = changed(free, dark, 6).share;
  const fx = e.post.get('vignette'), line = e.post.get('outline');
  const lit = corner(dark);
  fx.enabled = true; const dim = corner(shot(e));
  fx.enabled = false;
  const at = new THREE.Vector3(...RED).project(cam), screen = [(at.x + 1) / 2 * (s.w - 1), (1 - at.y) / 2 * (s.h - 1)];
  line.enabled = true; const lined = changed(dark, shot(e), 12, screen);
  line.enabled = false;
  return { red: red.rgb, blue: blue.rgb, pickRed: hit(red.ndc), pickBlue: hit(blue.ndc), shadow, vignette: +(lit - dim).toFixed(1), outline: lined,
    projection: e.describe().camera.projection, real: cam.constructor === THREE.OrthographicCamera || cam.constructor === THREE.PerspectiveCamera };
}

window.nativeCamera = async route => {
  const e = engineOn(route);
  e.post.add(vignette({ strength: 0.9 })); e.post.add(outline());
  e.post.get('vignette').enabled = false; e.post.get('outline').enabled = false;
  const w = world(e);
  e.shadows.cascades(e.lights.sun);
  await e.start();
  e.haltLoop();
  const out = {};
  const own = e.camera;
  own.position.set(0, 12, 12); own.lookAt(0, 0, 0);
  out.base = measure(e, w);
  const before = shot(e);

  // a square frustum on a 4:3 canvas: the height stays and the width follows the canvas
  const ortho = new THREE.OrthographicCamera(-9, 9, 9, -9, 0.1, 120);
  ortho.position.set(0, 12, 12); ortho.lookAt(0, 0, 0);
  e.camera = ortho;
  out.assigned = { same: e.camera === ortho, instance: e.camera instanceof THREE.OrthographicCamera, height: ortho.top - ortho.bottom, shape: (ortho.right - ortho.left) / (ortho.top - ortho.bottom) };
  out.ortho = measure(e, w);
  e.viewFar(9000); e._oFov.drive(70);
  out.left = { far: ortho.far, fov: 'fov' in ortho, aspect: 'aspect' in ortho };

  const canvas = e.renderer.domElement;
  canvas.style.width = `${H * 2}px`; e._resize();
  const s = shot(e);
  out.resized = { canvas: [canvas.width, canvas.height], height: ortho.top - ortho.bottom, shape: (ortho.right - ortho.left) / (ortho.top - ortho.bottom), red: spot(s, ortho, RED).rgb, blue: spot(s, ortho, BLUE).rgb };
  canvas.style.width = `${W}px`; e._resize();
  out.owned = Object.fromEntries(['view.far', 'view.fov', 'view.aspect'].map(k => [k, e.describe().owned[k].writer]));

  const persp = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  persp.position.set(0, 13, 13); persp.lookAt(0, 0, 0);
  e.camera = persp;
  out.persp = measure(e, w);
  out.perspAspect = persp.aspect;

  e.camera = own;
  out.back = measure(e, w);
  out.backDiff = changed(before, shot(e)).share;
  out.backAspect = own.aspect;

  class Mine extends THREE.PerspectiveCamera {}
  out.refused = [new Mine(), new THREE.ArrayCamera(), new THREE.Object3D(), null].map(c => code(() => { e.camera = c; }));
  out.afterRefused = e.camera === own;

  const mine = new THREE.OrthographicCamera(-9, 9, 9, -9, 0.1, 120), kept = e.autoView.manual('aspect');
  e.camera = mine;
  out.manual = (mine.right - mine.left) / (mine.top - mine.bottom);
  e.camera = own; kept.remove();

  // a chain running across the assignment, nothing toggled: toggling an effect rebuilds the chain, which would hide a pass that kept the old camera. The truth is a chain built fresh
  e.post.get('outline').enabled = true; shot(e);
  const top = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 120);
  top.position.set(2, 20, 1); top.lookAt(2, 0, 0);
  e.camera = top;
  const through = shot(e);
  out.running = { red: spot(through, top, RED).rgb, blue: spot(through, top, BLUE).rgb };
  e.post.get('outline').remove(); e.post.add(outline());
  out.running.diff = changed(through, shot(e)).share;
  e.post.get('outline').enabled = false;
  e.camera = own; shot(e);

  // a chain the game owns stays the game's until the hand-back
  e.post.get('vignette').enabled = true;
  shot(e); e.post.own();
  const chain = route === 'webgl' ? e.post.object().passes[0] : null;
  e.camera = ortho; shot(e);
  out.ownedChain = chain ? chain.camera === own : null;
  e.post.own(false); shot(e);
  out.handedBack = chain ? chain.camera === ortho : null;
  e.dispose(); e.renderer.domElement.remove();
  return out;
};

window.nativeRig = async route => {
  const e = engineOn(route, [followCamera({ projection: 'orthographic', pixelSnap: { pixelsPerMeter: 8 }, pitch: 0.6, yaw: 0.8, distance: 20, ground: 'none', mouseLook: false, smoothing: 1000 })]);
  world(e);
  await e.start();
  e.haltLoop();
  const target = new THREE.Object3D(), rig = e.cameraRig, own = e.camera, snap = rig.pixelSnap, grid = snap.grid, canvas = e.renderer.domElement;
  rig.follow(target);
  shot(e);
  const row = () => { const d = e.describe().camera, s = shot(e); return { pixelSnap: d.pixelSnap, height: 2 / e.camera.projectionMatrix.elements[5], rows: canvas.height / 8, pos: e.camera.position.toArray(), red: spot(s, e.camera, RED).rgb, projection: d.projection }; };
  const out = { engine: row() };

  const real = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 200);
  e.camera = real;
  target.position.set(0.37, 0, 0.11); shot(e); shot(e);
  out.real = row();
  out.sameGrid = rig.pixelSnap.grid === grid && grid.camera === real;
  out.onGrid = (() => { const c = grid.toScreen(real.position), low = [c.x - canvas.width / 16, c.y - canvas.height / 16]; return low.map(v => Math.abs(v * 8 - Math.round(v * 8))); })();
  out.cameraWriter = e.describe().owned.camera.writer;
  canvas.style.width = `${W * 1.5}px`; e._resize(); shot(e);
  out.resized = { ...row(), shape: (real.right - real.left) / (real.top - real.bottom), canvas: [canvas.width, canvas.height] };
  canvas.style.width = `${W}px`; e._resize();

  const persp = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  e.camera = persp;
  shot(e);
  out.perspective = { agrees: snap.agrees, moved: persp.position.length() > 1, writer: e.describe().owned.camera.writer };
  out.rigKept = e.cameraRig === rig && !!e.cameraRig.pixelSnap;
  e.camera = own; shot(e);
  out.back = row();

  // a rig that asks for orthographic over the game's perspective camera: the rigs' own stands in, and the game's comes back with the next perspective view
  e.camera = persp;
  e.setCamera('follow', { projection: 'orthographic', size: 10 });
  out.asked = { real: e.camera.constructor === THREE.OrthographicCamera, height: e.camera.top - e.camera.bottom };
  e.setCamera('follow', { projection: 'perspective' });
  out.handedBack = e.camera === persp;
  e.dispose(); canvas.remove();
  return out;
};

/** A rig's projection against the camera the game really assigned: a camera assigned during a shot stays, the next shot asks for its view, and no frame ever throws */
window.nativeProjection = async route => {
  const e = engineOn(route, [followCamera({ ground: 'none', mouseLook: true, smoothing: 1000, distance: 20, minDistance: 10, maxDistance: 40 })]);
  world(e);
  await e.start();
  e.haltLoop();
  const out = {}, own = e.camera, warns = [], warn = console.warn;
  console.warn = (...x) => { warns.push(x.join(' ')); warn(...x); };
  const target = new THREE.Object3D(), view = { position: [0, 12, 12], lookAt: [0, 0, 0], projection: 'orthographic' };
  const persp = new THREE.PerspectiveCamera(40, 1, 0.1, 200), ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 200);
  const height = () => ortho.top - ortho.bottom, wheel = n => { e.input.look.zoom = n; shot(e); };

  // a perspective rig on a real orthographic camera: the wheel moves what the view shows
  e.cameraRig.follow(target);
  e.camera = ortho; shot(e);
  const h0 = height();
  wheel(1); out.wheelOut = height() / h0;
  wheel(-1); wheel(-1); out.wheelIn = height() / h0;
  for (let i = 0; i < 30; i++) wheel(1);
  out.wheelMax = height() / h0;
  for (let i = 0; i < 60; i++) wheel(-1);
  out.wheelMin = height() / h0;
  out.distanceStill = e.cameraRig.distance;
  fitOrtho(ortho, 10);

  // a size on a real perspective camera: the rigs' own orthographic camera stands in, and the game's comes back with the next perspective view
  e.camera = persp;
  e.setCamera('fixed', { ...view, size: 10 });
  out.oneShot = { real: e.camera.constructor === THREE.OrthographicCamera, height: e.camera.top - e.camera.bottom };
  e.setCamera('follow');
  out.oneShotBack = e.camera === persp;

  // the same rig with the camera changing under it: nothing throws, per frame or by itself
  e.camera = ortho;
  e.setCamera('fixed', { shots: { wide: { ...view, size: 10 }, close: { ...view, position: [30, 12, 12], size: 6 }, plain: { position: [-60, 8, 8], lookAt: [0, 0, 0] } }, start: 'wide', auto: 'nearest', autoInterval: 0.01, hysteresis: 0 });
  const fixed = e.cameraRig;
  fixed.follow(target);
  shot(e);
  out.onOrtho = height();
  e.camera = persp;
  warns.length = 0;
  const go = (x, z) => { target.position.set(x, 0, z); for (let i = 0; i < 5; i++) shot(e); };
  let threw = null;
  try {
    go(0, 0);
    out.assigned = { stays: e.camera === persp, placed: persp.position.toArray(), shot: fixed.current };
    go(30, 12);   // the nearest shot wants orthographic: a shot change asks for its view
    out.moved = { shot: fixed.current, ortho: !!e.camera.isOrthographicCamera, height: e.camera.top - e.camera.bottom };
    go(-60, 8);
    out.plain = { shot: fixed.current, back: e.camera === persp };
    e.events.emit('trigger:enter', { tag: 'camera:wide' });
    out.zone = { shot: fixed.current, height: e.camera.top - e.camera.bottom };
  } catch (err) { threw = err.message; }
  out.frames = { threw, error: e.error?.message ?? null, told: warns.filter(w => w.includes('camera-option')).length };
  e.camera = ortho;
  fixed.auto = false; fixed.cut('close');
  out.backHeight = height();

  console.warn = warn;
  e.camera = own; shot(e);
  e.dispose(); e.renderer.domElement.remove();
  return out;
};

/** A rig's projection is a swap of real cameras: neither one ever pretends to be the other, and what the view carries goes with it, there and back */
window.nativeSwap = async route => {
  const e = engineOn(route, [followCamera({ ground: 'none', mouseLook: false, smoothing: 1000 })]);
  e.post.add(vignette({ strength: 0.9 }));
  world(e);
  await e.start();
  e.haltLoop();
  const out = {}, own = e.camera, hung = new THREE.Object3D(), at = { position: [0, 12, 12], lookAt: [0, 0, 0] };
  const fov0 = own.fov;
  e.scene.add(own); own.add(hung); own.layers.enable(3); own.zoom = 1.25; own.updateProjectionMatrix();
  const fixed = e.setCamera('fixed', { start: 'lens', shots: { lens: { ...at, fov: 30 }, plain: at, flat: { ...at, projection: 'orthographic', size: 18 }, small: { ...at, projection: 'orthographic', size: 9 } } });
  shot(e);

  fixed.cut('flat');
  const made = e.camera, s = shot(e), red = spot(s, made, RED), blue = spot(s, made, BLUE);
  out.flat = { real: made.constructor === THREE.OrthographicCamera, swapped: made !== own, red: red.rgb, blue: blue.rgb, pick: e.pick(red.ndc[0], red.ndc[1])?.object?.name ?? null,
    projection: e.describe().camera.projection, orthoSize: e.describe().camera.orthoSize, height: made.top - made.bottom, shape: (made.right - made.left) / (made.top - made.bottom) };
  out.flags = { perspectiveIsNot: own.isOrthographicCamera === undefined && own.isPerspectiveCamera === true, orthoIsNot: made.isPerspectiveCamera === undefined && made.isOrthographicCamera === true };
  out.carried = { hung: hung.parent === made, parent: made.parent === e.scene && own.parent === null, layer: made.layers.isEnabled(3), zoom: made.zoom, pos: made.position.distanceTo(own.position) < 1e-6 };
  e.viewFar(9000);
  out.far = made.far;
  fixed.blend('small', { seconds: 1 }); e.step(0.5, { describe: false });
  out.mid = made.top - made.bottom;
  e.step(1, { describe: false });
  out.end = made.top - made.bottom;
  out.same = e.camera === made;
  fixed.cut('plain'); shot(e); shot(e);
  out.back = { own: e.camera === own, far: own.far, hung: hung.parent === own, parent: own.parent === e.scene && made.parent === null, layer: own.layers.isEnabled(3), fov: own.fov, fov0, aspect: own.aspect, canvas: e.renderer.domElement.width / e.renderer.domElement.height };
  fixed.cut('flat');
  out.reused = e.camera === made;
  fixed.cut('lens'); shot(e);
  out.owned = Object.fromEntries(['camera', 'view.far', 'view.fov', 'view.aspect'].map(k => [k, e.describe().owned[k].writer]));
  e.dispose(); e.renderer.domElement.remove();
  return out;
};

/** A real camera beside what a game draws itself: offscreen targets, a split view, one final output, resize, and a hook or a draw that throws holding borrowed state */
window.nativePipeline = async route => {
  const e = engineOn(route);
  e.post.add(vignette({ strength: 0.9 }));
  const fx = e.post.get('vignette'), r = e.renderer, canvas = r.domElement;
  fx.enabled = false;
  const { caster } = world(e);
  caster.visible = false;
  await e.start();
  e.haltLoop();
  const out = {};
  const ortho = new THREE.OrthographicCamera(-9, 9, 9, -9, 0.1, 120);
  ortho.position.set(0, 12, 12); ortho.lookAt(0, 0, 0);
  e.camera = ortho;
  const plain = shot(e);

  // every draw onto the canvas in one frame: what writes the final picture, and how often
  const finals = fn => {
    const own = r.render; let n = 0;
    r.render = function (...a) { if (r.getRenderTarget() === null) n++; return own.apply(this, a); };
    try { fn(); } finally { r.render = own; }
    return n;
  };
  out.finals = { plain: finals(() => shot(e)) };
  fx.enabled = true; out.finals.post = finals(() => shot(e)); const vignetted = shot(e); fx.enabled = false; shot(e);

  // offscreen: into a target from a hook, with this camera and with one of its own. The hook does not put the target back: the frame does
  const target = () => route === 'webgpu' ? new TG.RenderTarget(W, H) : new THREE.WebGLRenderTarget(W, H);
  const rtMain = target(), rtTop = target(), top = new THREE.OrthographicCamera(-6, 6, 4.5, -4.5, 0.1, 120);
  top.position.set(-4, 20, 0); top.lookAt(-4, 0, 0);
  let hookCamera = null;
  const off = e.onRender(({ renderer, scene, camera }) => {
    hookCamera = camera;
    renderer.setRenderTarget(rtTop); renderer.render(scene, top);
    renderer.setRenderTarget(rtMain); renderer.render(scene, camera);
  });
  let drawn; out.finals.offscreen = finals(() => { drawn = shot(e); });
  fx.enabled = true; out.finals.offscreenPost = finals(() => shot(e)); fx.enabled = false; shot(e);
  off.remove();
  const rtSpot = async (rt, cam, p) => {
    const px = route === 'webgpu' ? await r.readRenderTargetPixelsAsync(rt, 0, 0, W, H) : (() => { const b = new Uint8Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, b); return b; })();
    const v = new THREE.Vector3(...p).project(cam), row = H === 0 ? 0 : px.length / H, x = Math.round((v.x + 1) / 2 * (W - 1)), y = Math.round((v.y + 1) / 2 * (H - 1));
    const at = yy => [...px.slice(yy * row + x * 4, yy * row + x * 4 + 3)];
    return [at(y), at(H - 1 - y)];   // either way up: which way a target's rows run is the backend's, what is checked is what it holds
  };
  out.off = { main: await rtSpot(rtMain, ortho, RED), top: await rtSpot(rtTop, top, RED), canvasDiff: changed(plain, drawn).share, camera: hookCamera === ortho, target: r.getRenderTarget() === null };

  // a split view over the picture, the usual three.js lines, from a hook after the frame
  const inset = new THREE.OrthographicCamera(-6, 6, 4.5, -4.5, 0.1, 120);
  inset.position.set(4, 20, 0); inset.lookAt(4, 0, 0);
  const iw = W / 2, ih = H / 2;
  const split = () => e.onRender(({ renderer, scene }) => {
    const size = renderer.getSize(new THREE.Vector2()), x = size.x - iw, y = 0;
    renderer.setViewport(x, y, iw, ih); renderer.setScissor(x, y, iw, ih); renderer.setScissorTest(true);
    const auto = renderer.autoClear; renderer.autoClear = true;
    renderer.render(scene, inset);
    renderer.autoClear = auto; renderer.setScissorTest(false); renderer.setViewport(0, 0, size.x, size.y);
  }, { when: 'after' });
  const h = split(), s2 = (shot(e), shot(e));
  // three's two renderers count a viewport's y from opposite edges: this corner is the bottom one on WebGLRenderer, the top one on WebGPURenderer
  const v = new THREE.Vector3(...BLUE).project(inset), bx = Math.round(W - iw + (v.x + 1) / 2 * iw), by = Math.round((1 - v.y) / 2 * ih) + (route === 'webgpu' ? 0 : H - ih), left = spot(s2, ortho, RED);
  out.split = { insetBlue: px(s2, bx, by), mainRed: left.rgb, yielded: !!e._ownFrame?.yielded, diffLeftHalf: (() => { let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) if (Math.abs(px(s2, x, y)[0] - px(plain, x, y)[0]) > 12) n++; return n; })() };
  // resize with all of it running: the main view and the corner both follow the new canvas
  canvas.style.width = `${W * 2}px`; e._resize();
  const big = shot(e);
  out.resized = { canvas: [canvas.width, canvas.height], red: spot(big, ortho, RED).rgb, blue: spot(big, ortho, BLUE).rgb, shape: (ortho.right - ortho.left) / (ortho.top - ortho.bottom) };
  h.remove();
  canvas.style.width = `${W}px`; e._resize();
  out.afterSplit = changed(plain, shot(e)).share;

  // a hook that throws holding what it borrowed: the next frame draws the same picture, and the game's own setting of those is not touched
  const clear = () => { e.error = null; e.stacks.get('freeze').release('error'); };
  const held = () => { const v = r.getViewport(new THREE.Vector4()); return { target: r.getRenderTarget() === null, viewport: v.toArray(), scissor: r.getScissorTest(), override: e.scene.overrideMaterial === null, layers: ortho.layers.mask, autoClear: r.autoClear }; };
  const before = held(), grey = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const thrower = when => e.onRender(({ renderer, scene, camera }) => {
    renderer.setRenderTarget(rtMain); renderer.setViewport(0, 0, 8, 8); renderer.setScissor(0, 0, 8, 8); renderer.setScissorTest(true);
    renderer.autoClear = false; scene.overrideMaterial = grey; camera.layers.set(7);
    throw new Error('pipeline hook boom');
  }, { when });
  for (const when of ['before', 'after']) {
    const t = thrower(when);
    shot(e);
    t.remove(); clear();
    // a moved box, read where it went: a frame clipped to a corner leaves the old picture in the buffer, and that would read as whole
    const red = e.scene.getObjectByName('red');
    red.position.x += 5; red.updateMatrixWorld();
    const moved = spot(shot(e), ortho, [RED[0] + 5, RED[1], RED[2]]).rgb, state = held();
    red.position.x -= 5; red.updateMatrixWorld();
    shot(e);
    out[when] = { state, moved };
    // what the broken hook left is the frame's to clean whichever way the test ends
    r.setRenderTarget(null); r.setViewport(0, 0, W, H); r.setScissorTest(false); r.autoClear = before.autoClear; e.scene.overrideMaterial = null; ortho.layers.mask = before.layers;
  }
  out.before0 = before;

  // a draw that throws inside the frame, with the post chain on and off: the frame after it is whole
  for (const on of [false, true]) {
    fx.enabled = on;
    const clean = shot(e);
    const red = e.scene.getObjectByName('red'), once = () => { red.onBeforeRender = () => {}; throw new Error('pipeline draw boom'); };
    red.onBeforeRender = once;
    shot(e);
    delete red.onBeforeRender;
    clear();
    red.position.x += 5; red.updateMatrixWorld();
    const next = shot(e), moved = spot(next, ortho, [RED[0] + 5, RED[1], RED[2]]).rgb;
    red.position.x -= 5; red.updateMatrixWorld();
    out[on ? 'drawPost' : 'draw'] = { moved, diff: changed(clean, shot(e)).share };
  }
  fx.enabled = false;

  // the sound listener sits where a real orthographic camera is and looks where it looks
  const param = () => ({ v: null, setValueAtTime(x) { this.v = x; } });
  const listener = Object.fromEntries(['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'].map(k => [k, param()]));
  const realCtx = e.audio.ctx, voice = { playing: true };
  e.audio.ctx = { currentTime: 0, listener }; e.audio._spatial.add(voice);
  shot(e);
  const dir = ortho.getWorldDirection(new THREE.Vector3());
  out.listener = { at: ['positionX', 'positionY', 'positionZ'].map(k => listener[k].v), want: ortho.position.toArray(), look: ['forwardX', 'forwardY', 'forwardZ'].map(k => listener[k].v), wantLook: dir.toArray() };
  e.audio._spatial.delete(voice); e.audio.ctx = realCtx;

  rtMain.dispose(); rtTop.dispose(); grey.dispose();
  e.dispose(); canvas.remove();
  return out;
};

// the test runner waits for window.engine; each measure makes its own engine
window.engine = engineOn('webgl');
await window.engine.start();
window.engine.haltLoop();

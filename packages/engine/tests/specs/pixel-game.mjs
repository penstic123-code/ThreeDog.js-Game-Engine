// [guard] One art pixel grid (core/scene/pixel.js). The clamp-then-round order has no published source: this file is its proof. Everything is read back from real screenshots
// of a turned orthographic view, one colour per thing, in art pixels. Each measure has a control that must fail, so it is known to bite: the view without pixelSnap, a
// plane tilted toward the camera. A WebGPU row that fell back says so and proves nothing about WebGPU.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '@threedog/tools/browser';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PAGE = '/tests/pixel-size/index.html';
const K = 2, ODD = { width: 962, height: 542 };   // 481 x 271 art pixels: odd on both axes, where a view's center is on half a pixel
const J = JSON.stringify;

/** Engine sources that work out a camera's right or up axis apart from core/scene/pixel.js: a second copy of the art grid */
function secondGrid() {
  const hits = [];
  const walk = d => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/^(pixel|.*Camera).*\.js$/.test(n)) readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
        if (/Math\.round\(|\.round\(\)/.test(l) && !/^\s*(\/\/|\*)/.test(l)) hits.push(`${relative(ROOT, p).replaceAll('\\', '/')}:${i + 1}`);
      });
    }
  };
  walk(join(ROOT, 'modules/camera'));
  return hits;
}

/** In the page: helpers, and the scene. Colours: wall blue, sprite yellow and green stripes, marker red */
function setup() {
  window.artPixels = async (b64, k) => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = new OffscreenCanvas(img.width, img.height).getContext('2d', { willReadFrequently: true });
    c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, img.width, img.height).data, W = Math.floor(img.width / k), H = Math.floor(img.height / k), out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = ((y * k) * img.width + x * k) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      out.push(r > 200 && g > 200 && b < 90 ? 'y' : g > 200 && r < 90 && b < 90 ? 'g' : r > 200 && g < 90 && b < 90 ? 'r' : b > 200 && r < 90 && g < 90 ? 'b' : '.');
    }
    return { W, H, at: (x, y) => out[y * W + x], count: c => out.filter(v => v === c).length, cells: c => out.flatMap((v, i) => (v === c ? [[i % W, Math.floor(i / W)]] : [])) };
  };
  engine.scene.background = new THREE.Color(0);
  /** A sheet of one 16 x 32 frame: columns alternate yellow and green, so a texel that is not one art pixel shows as a wider or missing stripe */
  window.stripes = () => {
    const w = 16, h = 32, data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set(i % w % 2 ? [0, 255, 0, 255] : [255, 255, 0, 255], i * 4);
    const t = new THREE.DataTexture(data, w, h); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true;
    return new THREE.MeshBasicMaterial({ map: t, alphaTest: 0.5, toneMapped: false });
  };
  /** A wall crossing the world 0.6 rad off the camera's own facing, behind the origin */
  window.wall = () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshBasicMaterial({ color: 0x0000ff, side: THREE.DoubleSide, toneMapped: false }));
    return m;
  };
  window.basic = color => new THREE.MeshBasicMaterial({ color, toneMapped: false });
}

async function open(browser, origin, query, size = ODD) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${origin}${PAGE}?k=${K}&pixel=1&${query}`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 90000 });
  await page.evaluate(setup);
  return page;
}
const shot = async page => (await page.screenshot({ type: 'png' })).toString('base64');

/** (1) The head is not cut by a wall behind it that is not parallel to the sprite. The tilted plane is the control: same size, same feet, leaning back through the wall */
async function headCheck(check, browser, origin, route) {
  const p = await open(browser, origin, `route=${route}`);
  await p.evaluate(async () => {
    const e = engine, g = e.cameraRig.pixelSnap.grid, focus = new THREE.Object3D();
    e.scene.add(focus); e.cameraRig.follow(focus);
    await frames(3);
    const f = g.axes().forward, yaw = Math.atan2(-f.x, -f.z), off = 0.6, n = new THREE.Vector3(Math.sin(yaw + off), 0, Math.cos(yaw + off));
    const w = wall(); w.rotation.y = yaw + off; w.position.copy(n).multiplyScalar(-0.5); e.scene.add(w);   // 0.5 m behind the feet, more than (w / 2) sin 0.6 = 0.14
    const hero = window.hero = pixelSprite({ grid: g, material: stripes(), width: 16, height: 32 }); e.scene.add(hero);
    await frames(4);
  });
  const backend = await p.evaluate(() => engine.describe().renderer?.backend ?? null);
  const a = await p.evaluate(async b => { const s = await artPixels(b, 2); return { y: s.count('y'), g: s.count('g'), blue: s.count('b') }; }, await shot(p));
  await p.evaluate(async () => {
    const g = engine.cameraRig.pixelSnap.grid, f = g.axes().forward, cos = Math.hypot(f.x, f.z);
    hero.visible = false;
    const tilted = window.tilted = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1).translate(0, 0.5, 0), stripes());
    tilted.quaternion.copy(engine.camera.quaternion); engine.scene.add(tilted);
    await frames(4);
  });
  const c = await p.evaluate(async b => { const s = await artPixels(b, 2); return { y: s.count('y'), g: s.count('g') }; }, await shot(p));
  // the limit the recipe names: feet nearer the wall than (w / 2) |sin 0.6| = 0.14 m, the far edge of the plane goes in
  await p.evaluate(async () => { tilted.visible = false; hero.visible = true; hero.position.copy(engine.scene.children.find(o => o.geometry?.parameters?.width === 40).position).multiplyScalar(0.9); await frames(4); });
  const n = await p.evaluate(async b => { const s = await artPixels(b, 2); return s.count('y') + s.count('g'); }, await shot(p));
  console.log(`  ${route} (${backend}) head: upright yellow ${a.y} green ${a.g} of 256 each, wall ${a.blue}; tilted control ${c.y + c.g} of 512; feet 0.05 m from the wall ${n} of 512`);
  check(`${route} (${backend}): every texel of the upright sprite shows, one art pixel each, the wall on screen behind it`, a.y === 256 && a.g === 256 && a.blue > 1000, J(a));
  check(`${route} (${backend}): control, the same plane tilted to the camera loses its head in that wall`, c.y + c.g < 512, J(c));
  check(`${route} (${backend}): the documented limit is real, feet closer than (w / 2) |sin| to the wall lose an edge`, n < 512 && n > 256, J(n));
  if (route === 'webgpu' && backend !== 'webgpu') console.log('  NOT real WebGPU: this browser fell back');
  await p.context().close();
}

/** (2) Sliding along a bound: the marker's whole shape only ever moves by a whole number of art pixels. Exact shape match; the marker is a turned box, so any sub-pixel move changes it */
async function slide(browser, origin, query) {
  const p = await open(browser, origin, query);
  await p.evaluate(async () => {
    const e = engine, focus = window.focus = new THREE.Object3D(), g = window.g = pixelGrid({ camera: e.camera, pixelsPerMeter: 32 });
    e.scene.add(focus); e.cameraRig.follow(focus);
    await frames(3);
    // the rectangle's right edge on screen, and the camera x that bound holds: the box stands where the held view shows it. Control: no bound, the same x asked for directly
    const bounds = { minX: -14, maxX: 14, minZ: -14, maxZ: 14 }, R = g.axes().right, edge = Math.max(...[-14, 14].flatMap(x => [-14, 14].map(z => R.x * x + R.z * z)));
    window.held = edge - e.renderer.domElement.width / 64;
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 0.7), basic(0xff0000)); box.rotation.y = 0.3; box.position.copy(g.toWorld({ x: held + 0.31, y: 0.2, z: 0.17 })); e.scene.add(box);
    if (e.cameraRig.pixelSnap) e.cameraRig.pixelSnap.bounds = bounds;
    await frames(3);
  });
  const masks = [], cams = [];
  for (let i = 0; i < 12; i++) {
    // past the bound on the screen's x the whole way, moving on y by an odd fraction of an art pixel: the camera slides along that bound
    await p.evaluate(async i => { focus.position.copy(g.toWorld({ x: held + (engine.cameraRig.pixelSnap ? 3 : 0), y: i * 0.0373, z: 0 })); await frames(3); }, i);
    masks.push(await p.evaluate(async b => (await artPixels(b, 2)).cells('r'), await shot(p)));
    cams.push(await p.evaluate(() => { const c = engine.camera.position, s = engine.cameraRig.pixelSnap; return s ? [...s.grid.toScreen(c).toArray().slice(0, 2).map(v => v * 32), s.error.x, s.error.y] : [c.x, c.y, c.z]; }));
  }
  await p.context().close();
  const key = m => { const x0 = Math.min(...m.map(c => c[0])), y0 = Math.min(...m.map(c => c[1])); return m.map(([x, y]) => `${x - x0},${y - y0}`).sort().join(' '); };
  const shapes = new Set(masks.map(key)), at = masks.map(m => [Math.min(...m.map(c => c[0])), Math.min(...m.map(c => c[1]))]);
  return { shapes: shapes.size, cells: masks[0].length, at, cams };
}

export const specs = [
  {
    name: '[guard] pixel grid: one copy of the math, the option errors, the mismatch by name, a turned view',
    url: PAGE + '?k=2&pixel=1',
    software: true,
    async run({ check, ev }) {
      const copies = secondGrid();
      check('no camera file rounds on its own: pixel.js is the only grid', copies.length === 0, copies.join(' '));
      const r = await ev(async () => {
        const e = engine, t = f => { try { f(); return null; } catch (x) { return `${x.code ?? ''}: ${x.message}`; } }, rig = e.cameraRig, s = rig.pixelSnap, g = s.grid, out = {};
        await frames(3);
        const p = { x: 1.2345, y: 0.5, z: -3.21 }, sc = g.toScreen(p), back = g.toWorld(sc), sn = g.snap(p), er = g.error(p), s2 = g.toScreen(sn);
        out.roundTrip = Math.hypot(back.x - p.x, back.y - p.y, back.z - p.z);
        out.onGrid = [s2.x * 32, s2.y * 32].map(v => Math.abs(v - Math.round(v)));
        out.depth = Math.abs(s2.z - sc.z);
        out.error = [(s2.x - sc.x) * 32 - er.x, (s2.y - sc.y) * 32 - er.y];
        const c = e.renderer.domElement, u = (v, n) => { const w = v - n * g.cell / 2; return Math.abs(w * 32 - Math.round(w * 32)); };
        const cs = g.toScreen(e.camera.position);
        out.corner = [u(cs.x, c.width), u(cs.y, c.height)];
        out.height = [e.camera.top - e.camera.bottom, c.height / 32, g.agrees(c.height)];
        // a level smaller than the view is centered, and a bound is never crossed
        const b = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, pl = g.place({ x: 40, y: 0, z: 40 }, { columns: c.width, rows: c.height, bounds: b }).position, far = g.toScreen(pl);
        const pm = g.place({ x: 0, y: 0, z: 0 }, { columns: c.width, rows: c.height, bounds: b }).position, near = g.toScreen(pm);
        out.centered = Math.hypot(far.x - near.x, far.y - near.y);
        const big = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 }, q = g.toScreen(g.place({ x: 500, y: 0, z: 500 }, { columns: c.width, rows: c.height, bounds: big }).position);
        const R = g.axes().right, ends = []; for (const x of [-60, 60]) for (const z of [-60, 60]) ends.push(R.x * x + R.z * z);
        out.bound = Math.max(...ends) - (q.x + c.width * g.cell / 2);
        // a zoom by art pixels and a turn: the camera lands on the new grid with nothing to reset
        const was = e.camera.top - e.camera.bottom; e.setPixelSize(4); await frames(3);
        out.zoom = { was, now: e.camera.top - e.camera.bottom, want: c.height / 32, agrees: e.cameraRig.pixelSnap.agrees };
        rig.setView({ yaw: 1.9 }); await frames(3);
        const cz = g.toScreen(e.camera.position); out.turned = [u(cz.x, c.width), u(cz.y, c.height)];
        e.setPixelSize(2); await frames(3);
        // options: each wrong pair names the option
        const fake = { camera: new THREE.PerspectiveCamera(), renderer: e.renderer };
        out.perspective = t(() => pixelGrid({ camera: fake.camera, pixelsPerMeter: 32 }).axes());
        out.badPpm = t(() => pixelGrid({ camera: e.camera, pixelsPerMeter: 0 }));
        out.followPersp = t(() => e.setCamera('follow', { pixelSnap: { pixelsPerMeter: 32 } }));
        out.followSize = t(() => e.setCamera('follow', { projection: 'orthographic', size: 8, pixelSnap: { pixelsPerMeter: 32 } }));
        out.typo = t(() => e.setCamera('follow', { projection: 'orthographic', pixelSnap: { pixelsPerMeters: 32 } }));
        out.fixedPersp = t(() => e.setCamera('fixed', { position: [0, 5, 5], lookAt: [0, 0, 0], pixelSnap: { pixelsPerMeter: 32 } }));
        out.fixedSize = t(() => e.setCamera('fixed', { position: [0, 5, 5], lookAt: [0, 0, 0], projection: 'orthographic', size: 8, pixelSnap: { pixelsPerMeter: 32 } }));
        // an outside zoom: reported by name, rounding stops, and it heals when put back
        const warned = await __t.warns(async () => { e.camera.zoom = 2; e.camera.updateProjectionMatrix(); await frames(3); });
        out.zoomed = { warns: warned.warns.join(' '), agrees: e.cameraRig.pixelSnap.agrees, described: e.describe().camera.pixelSnap.agrees };
        e.camera.zoom = 1; e.camera.updateProjectionMatrix(); await frames(3);
        out.healed = e.cameraRig.pixelSnap.agrees;
        // the fixed camera goes through the same call
        e.setCamera('fixed', { position: [3.3, 7.1, 9.7], lookAt: [0, 0, 0], projection: 'orthographic', pixelSnap: { pixelsPerMeter: 32 } }); await frames(3);
        const f = e.cameraRig.pixelSnap, cf = f.grid.toScreen(e.camera.position);
        out.fixed = { kind: e.cameraRig.kind, corner: [u(cf.x, c.width), u(cf.y, c.height)], height: e.camera.top - e.camera.bottom, want: c.height / 32 };
        e.setCamera('follow');
        return out;
      });
      const tiny = v => Math.abs(v) < 1e-6;
      check('toScreen and toWorld undo each other', tiny(r.roundTrip), J(r));
      check('snap lands on the grid and keeps depth', r.onGrid.every(tiny) && tiny(r.depth), J(r));
      check('error is the rounding, in art pixels', r.error.every(tiny), J(r));
      check("the view's corner sits on the grid with an odd or even buffer", r.corner.every(tiny), J(r.corner));
      check('the view height is buffer rows / pixelsPerMeter', tiny(r.height[0] - r.height[1]) && r.height[2], J(r.height));
      check('a level smaller than the view is centered: the same place wherever the camera wants to go', tiny(r.centered), J(r));
      check('a bound is not crossed', r.bound >= -1e-6, J(r.bound));
      check('setPixelSize zooms: the view height follows the buffer, the grid still agrees', tiny(r.zoom.now - r.zoom.want) && r.zoom.now !== r.zoom.was && r.zoom.agrees, J(r.zoom));
      check('a turn needs no reset', r.turned.every(tiny), J(r.turned));
      check('perspective camera on the grid: camera-option naming projection', /camera-option/.test(r.perspective) && /projection/.test(r.perspective), r.perspective);
      check('pixelsPerMeter 0: camera-option', /camera-option/.test(r.badPpm), r.badPpm);
      check('followCamera perspective with pixelSnap: camera-option naming projection', /camera-option/.test(r.followPersp) && /projection/.test(r.followPersp), r.followPersp);
      check('followCamera size with pixelSnap: pixel-conflict, says which to drop', /pixel-conflict/.test(r.followSize) && /Drop size/.test(r.followSize), r.followSize);
      check('a misspelled pixelSnap key is refused', !!r.typo && /pixelsPerMeters/.test(r.typo), r.typo);
      check('fixedCamera perspective shot with pixelSnap: camera-option', /camera-option/.test(r.fixedPersp), r.fixedPersp);
      check('fixedCamera shot size with pixelSnap: pixel-conflict', /pixel-conflict/.test(r.fixedSize), r.fixedSize);
      check('camera.zoom written from outside: pixel-conflict warning, agrees false, describe() says so', /pixel-conflict/.test(r.zoomed.warns) && !r.zoomed.agrees && !r.zoomed.described, J(r.zoomed));
      check('zoom put back: rounding resumes', r.healed === true, J(r));
      check('fixedCamera rounds through the same call and owns its view height', r.fixed.kind === 'fixed' && r.fixed.corner.every(tiny) && tiny(r.fixed.height - r.fixed.want), J(r.fixed));
    },
  },
  {
    name: '[guard] pixel grid: a head stays clear of a turned wall, and static things move by whole art pixels along a bound, WebGL and the WebGPU route',
    notRealWebGPU: 'opens its own pages per backend; the real WebGPU one is the spec below',
    url: PAGE + '?k=2&pixel=1',
    serial: true,
    software: true,
    timeout: 600000,
    async run({ check, page }) {
      const browser = page.context().browser(), origin = new URL(page.url()).origin;
      for (const route of ['webgl', 'webgpu']) {
        await headCheck(check, browser, origin, route);
        const m = await slide(browser, origin, `route=${route}`);
        const xs = new Set(m.cams.map(c => c[0].toFixed(3))), ys = new Set(m.cams.map(c => c[1].toFixed(3)));
        console.log(`  ${route} slide: ${m.shapes} shape(s) of ${m.cells} cells, marker at ${J(m.at)}, camera ${xs.size} x-values, ${ys.size} y-values, last error ${J(m.cams.at(-1).slice(2))}`);
        check(`${route}: along a bound the marker keeps one exact shape, so it only moved by whole art pixels`, m.shapes === 1 && m.cells > 100, J(m));
        check(`${route}: the camera really slid, one screen axis held by the bound`, new Set(m.at.map(String)).size > 1 && Math.min(xs.size, ys.size) === 1, J(m));
      }
      const c = await slide(browser, origin, 'route=webgl&snap=0');
      console.log(`  control without pixelSnap: ${c.shapes} shapes of ${c.cells} cells`);
      check('control: without pixelSnap the same move changes the shape', c.shapes > 1 && c.cells > 100, J(c.shapes));
    },
  },
  {
    name: '[guard] pixel grid: the same on real WebGPU where the GPU allows it',
    notRealWebGPU: 'launches the real GPU itself, in every full run',
    url: PAGE + '?k=2&pixel=1',
    serial: true,
    software: true,
    timeout: 600000,
    async run({ check, page }) {
      const origin = new URL(page.url()).origin, b = await launchBrowser({ prefer: 'gpu' });
      try {
        await headCheck(check, b, origin, 'webgpu');
        const m = await slide(b, origin, 'route=webgpu');
        console.log(`  gpu slide: ${m.shapes} shape(s) of ${m.cells} cells, marker at ${J(m.at)}`);
        check('gpu browser: along a bound the marker keeps one exact shape', m.shapes === 1 && m.cells > 100, J(m));
      } finally { await b.close(); }
    },
  },
  {
    name: '[guard] pixel grid: a sprite as a character model, with Rapier and a save beside it',
    url: PAGE + '?k=2&pixel=1&physics=1',
    software: true,
    async run({ check, ev, page }) {
      const r = await ev(async () => {
        const e = engine, g = e.cameraRig.pixelSnap.grid, out = {}, near = (a, b) => Math.abs(a - b) < 1e-6;
        const hero = pixelSprite({ grid: g, material: new THREE.MeshBasicMaterial({ color: 0xffffff }), width: 16, height: 32, snap: 'followed' });
        const ch = new Character(e, { model: hero });
        e.add(ch.root); e.cameraRig.follow(ch.root);
        await frames(5);
        const y0 = ch.root.rotation.y;
        ch.walkTo({ x: 3.123, z: -1.77 }, { speed: 2 });
        for (let i = 0; i < 60 && ch.root.position.x < 1; i++) await frames(5);
        // the root turned to walk, the sprite did not; the exact position stays exact
        const f = g.axes().forward, n = new THREE.Vector3(0, 0, 1).applyQuaternion(hero.getWorldQuaternion(new THREE.Quaternion()));
        out.turned = Math.abs(ch.root.rotation.y - y0) > 0.1;
        out.faces = near(n.x * -f.x + n.z * -f.z, Math.hypot(f.x, f.z));
        out.local = hero.position.length();
        // a body in free fall under a rounded camera keeps its own position
        const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); box.position.set(6, 5.123, 2); e.add(box);
        e.rigid.addBox(box, { mass: 1 });
        await frames(20);
        const er = g.error(box.position);
        out.falling = box.position.y < 5.123; out.offGrid = Math.hypot(er.x, er.y) > 0.01;
        // the save holds what it held: no grid, and the rig comes back rounding
        const saved = e.cameraRig.pixelSnap.grid.pixelsPerMeter;
        await e.saves.save('pixel-game'); await e.saves.load('pixel-game'); await frames(3);
        out.after = { snap: e.cameraRig.pixelSnap?.grid.pixelsPerMeter === saved, agrees: e.cameraRig.pixelSnap?.agrees, ortho: !!e.camera.isOrthographicCamera };
        return out;
      });
      check('the character turned, the sprite kept facing the camera forward', r.turned && r.faces, JSON.stringify(r));
      check('the model stays at the root: position exact, only the drawing rounds', r.local === 0, JSON.stringify(r));
      check('a Rapier body keeps its exact position under a rounded camera', r.falling && r.offGrid, JSON.stringify(r));
      check('a save and load leave the rig rounding, orthographic and in agreement', r.after.snap && r.after.agrees && r.after.ortho, JSON.stringify(r));
    },
  },
  {
    name: '[guard] pixel grid: a pointer on the last art pixels picks there, under the padding pixelSize leaves',
    url: PAGE + '?k=3',
    software: true,
    async run({ check, page }) {
      const browser = page.context().browser(), origin = new URL(page.url()).origin;
      const ctx = await browser.newContext({ viewport: { width: 803, height: 451 }, deviceScaleFactor: 1 }), p = await ctx.newPage();
      await p.goto(`${origin}${PAGE}?k=3`);
      await p.waitForFunction(() => window.ready === true, null, { timeout: 90000 });
      const box = await p.evaluate(() => { const c = engine.renderer.domElement; return { w: c.width, h: c.height, pad: c.style.paddingRight, padB: c.style.paddingBottom, cw: c.clientWidth }; });
      await p.mouse.move((box.w - 0.5) * 3, (box.h - 0.5) * 3);
      const got = await p.evaluate(() => { const q = engine.input.pointer; return { x: q.ndcX, y: q.ndcY }; });
      await ctx.close();
      const want = { x: (box.w - 0.5) / box.w * 2 - 1, y: -((box.h - 0.5) / box.h * 2 - 1) };
      console.log(`  buffer ${box.w} x ${box.h}, padding ${box.pad} ${box.padB}: ndc ${J(got)} wanted ${J(want)}`);
      check('there is padding in this size, or this proves nothing', parseFloat(box.pad) > 0 && parseFloat(box.padB) > 0, J(box));
      check('ndc runs across the picture, not the padding: within a tenth of an art pixel', Math.abs(got.x - want.x) < 0.2 / box.w && Math.abs(got.y - want.y) < 0.2 / box.h, J({ got, want, box }));
    },
  },
];

// Second review before 1.0: rendering. Each item was a proven bug and stays as a [guard].

/** In the page: one engine frame, then a browser frame so GPU answers can come back */
const TICK = `async n => { for (let i = 0; i < n; i++) { engine.step(1 / 60, { describe: false }); await new Promise(requestAnimationFrame); } }`;

const secondCamera = (renderer, url) => ({
    name: `[guard] occlusion on ${renderer}: a game's second camera (minimap, security view) still draws what the main camera cannot see`,
    url,
    software: true,
    async run({ check, ev, page }) {
      await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
      const r = await ev(async TICK_SRC => {
        const tick = (0, eval)('(' + TICK_SRC + ')'), cam = engine.camera, R = engine.renderer, crowd = [];
        engine.scene.traverse(o => { if (o.isMesh && o.geometry.type === 'SphereGeometry') crowd.push(o); });
        // plain three.js, the way a game draws a minimap: this camera stands behind the wall, the crowd in plain view
        const other = new cam.constructor(50, 4 / 3, 0.1, 100);
        other.position.set(0, 3, -12); other.lookAt(0, 1, 0); other.updateMatrixWorld();
        const reds = () => {
          R.render(engine.scene, other);
          const c = document.createElement('canvas'); c.width = 100; c.height = 75;
          const g = c.getContext('2d'); g.drawImage(R.domElement, 0, 0, 100, 75);
          const d = g.getImageData(0, 0, 100, 75).data; let n = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] > d[i + 1] * 1.6 && d[i] > d[i + 2] * 1.6 && d[i] > 40) n++;
          return n;
        };
        cam.position.set(0, 2, 10); cam.lookAt(0, 2, 0); cam.updateMatrixWorld();
        const plain = reds();
        engine.occlusion.enabled = true;
        const w = engine.occlusion.watch(crowd);
        await tick(30);
        const out = { hidden: engine.occlusion.stats.hidden, plain, culled: reds() };
        w.remove(); engine.occlusion.enabled = false;
        return out;
      }, TICK);
      check('the main camera has it hidden, the other one sees it without culling', r.hidden === 1 && r.plain > 20, JSON.stringify(r));
      check('culling for one camera takes nothing from the other', r.culled >= r.plain * 0.9, JSON.stringify(r));
    },
});

export const specs = [
  secondCamera('WebGLRenderer', '/tests/occlusion/index.html'),
  secondCamera('WebGPURenderer', '/tests/occlusion/index.html?r=gpu'),
  {
    name: '[guard] occlusion: a thing hidden when the WebGL context is lost comes back after restore once nothing covers it',
    url: '/tests/occlusion/index.html',
    software: true,
    async run({ check, ev, page }) {
      await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
      const r = await ev(async TICK_SRC => {
        const tick = (0, eval)('(' + TICK_SRC + ')'), out = {}, cam = engine.camera, canvas = engine.renderer.domElement;
        const crowd = [], walls = [];
        engine.scene.traverse(o => { if (o.isMesh && o.geometry.type === 'SphereGeometry') crowd.push(o); if (o.isMesh && o.geometry.type === 'BoxGeometry' && o.geometry.parameters.width === 6) walls.push(o); });
        cam.position.set(0, 2, 10); cam.lookAt(0, 2, 0); cam.updateMatrixWorld();
        engine.occlusion.enabled = true;
        const w = engine.occlusion.watch(crowd);
        await tick(30);
        out.hiddenBefore = engine.occlusion.stats.hidden;
        const ext = engine.renderer.getContext().getExtension('WEBGL_lose_context');
        const lost = new Promise(res => canvas.addEventListener('webglcontextlost', res, { once: true }));
        const late = (p, n) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('stuck at ' + n + ' ' + JSON.stringify(out))), 20000))]);
        ext.loseContext(); await late(lost, 'lost');
        await new Promise(res => setTimeout(res, 50));   // the browser allows restoreContext only once the event has finished dispatching
        const back = new Promise(res => canvas.addEventListener('webglcontextrestored', res, { once: true }));
        ext.restoreContext(); await late(back, 'restored');
        // the wall goes: the crowd is plainly in view now
        for (const x of walls) x.visible = false;
        await late(tick(40), 'tick after');
        out.hiddenAfter = engine.occlusion.stats.hidden;
        w.remove();
        return out;
      }, TICK);
      check('hidden while the wall stood', r.hiddenBefore === 1, JSON.stringify(r));
      check('shown again with nothing in front of it', r.hiddenAfter === 0, JSON.stringify(r));
    },
  },
  {
    name: '[guard] shadows: a shadow map kept with shadowMap.autoUpdate off is drawn again after a WebGL context restore',
    url: '/tests/occlusion/index.html',
    software: true,
    async run({ check, ev, page }) {
      await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
      const r = await ev(async TICK_SRC => {
        const tick = (0, eval)('(' + TICK_SRC + ')'), cam = engine.camera, R = engine.renderer, canvas = R.domElement;
        cam.position.set(0, 12, 12); cam.lookAt(0, 0, -2); cam.updateMatrixWorld();
        const shot = () => {
          R.render(engine.scene, cam);
          const c = document.createElement('canvas'); c.width = 100; c.height = 75;
          const g = c.getContext('2d'); g.drawImage(canvas, 0, 0, 100, 75);
          return g.getImageData(0, 0, 100, 75).data;
        };
        const differing = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 6) n++; return n; };
        const lit = () => { const on = engine.scene.children.filter(o => o.isDirectionalLight); on.forEach(o => { o.castShadow = false; }); R.shadowMap.needsUpdate = true; const p = shot(); on.forEach(o => { o.castShadow = true; }); return p; };
        R.shadowMap.needsUpdate = true;
        await tick(3);
        const kept = shot(), noShadow = lit();
        R.shadowMap.needsUpdate = true; await tick(3);
        R.shadowMap.autoUpdate = false;
        await tick(3);
        const before = shot();
        const ext = R.getContext().getExtension('WEBGL_lose_context');
        const lost = new Promise(res => canvas.addEventListener('webglcontextlost', res, { once: true }));
        ext.loseContext(); await lost;
        await new Promise(res => setTimeout(res, 50));
        const back = new Promise(res => canvas.addEventListener('webglcontextrestored', res, { once: true }));
        ext.restoreContext(); await back;
        await tick(5);
        const after = shot();
        R.shadowMap.autoUpdate = true;
        return { shadow: differing(kept, noShadow), same: differing(before, kept), changed: differing(before, after) };
      }, TICK);
      check('the view holds a real shadow', r.shadow > 100 && r.same === 0, JSON.stringify(r));
      check('it is there after the restore', r.changed === 0, JSON.stringify(r));
    },
  },
  {
    name: '[guard] lightmap: a second map on the same meshes (day and night bakes) lands on them when the bake split vertices',
    url: '/tests/lightmap/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE, floor } = threedogTest, H = THREE.DataUtils.toHalfFloat;
        engine.step(0.1); engine.scene.updateMatrixWorld(true);
        const g = floor.geometry, n = g.attributes.position.count, size = 4, tex = new Uint16Array(size * size * 4).fill(H(4));
        // the layout `threedog bake light` writes. A real unwrap splits vertices at UV seams, so count is above vertices: vertex 0 is written twice here
        const count = n + 1, from = Uint32Array.from({ length: count }, (_, i) => i % n), index = Uint32Array.from(g.index.array);
        const o = { name: floor.name, vertices: n, count, indices: g.index.count, matrix: Array.from(floor.matrixWorld.elements), at: 0 };
        const soup = () => { const x = floor.geometry, p = x.attributes.position; return Array.from(x.index.array, i => [p.getX(i), p.getY(i), p.getZ(i)].join()).join(); };
        const shape = soup();
        // the night bake unwrapped in another order: its list speaks of the source mesh, not of the order the day bake left behind
        const file = (from, index) => {
        const list = [from, index, new Float32Array(count * 2).fill(0.5)];
        const head = new TextEncoder().encode(JSON.stringify({ format: 'threedog-lightmap', version: 1, size, backend: 'webgpu', meshes: [o], skipped: [] }));
        const base = (8 + head.length + 7) & ~7, extra = list.reduce((s, p) => s + p.byteLength, 0), buf = new ArrayBuffer(base + tex.byteLength + extra), v = new DataView(buf);
        v.setUint32(0, 0x4d4c4454, true); v.setUint32(4, head.length, true); new Uint8Array(buf).set(head, 8); new Uint8Array(buf).set(new Uint8Array(tex.buffer), base);
        let w = base + tex.byteLength; for (const p of list) { new Uint8Array(buf).set(new Uint8Array(p.buffer), w); w += p.byteLength; }
        return buf;
        };
        const day = await engine.loadLightmap(file(from, index));
        const first = { meshes: engine.describe().render.lightmap.meshes, on: floor.material.lightMap === day.texture };
        const night = await engine.loadLightmap(file(from.slice().reverse(), index.map(i => count - 1 - i)));
        const d = engine.describe().render.lightmap;
        return { first, meshes: d.meshes, missing: d.missing, on: floor.material.lightMap === night.texture, map: !!floor.material.lightMap, sameShape: soup() === shape };
      });
      check('the first map lands', r.first.meshes === 1 && r.first.on, JSON.stringify(r));
      check('the second map lands on the same mesh', r.meshes === 1 && r.on && !r.missing.length, JSON.stringify(r));
      check('its own vertex order still gives the same mesh', r.sameShape, JSON.stringify(r));
    },
  },
];

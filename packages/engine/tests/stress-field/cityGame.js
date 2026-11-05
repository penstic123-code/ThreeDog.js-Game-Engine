// City acceptance page section (driven by run.mjs, never part of the normal test run; docs/testing/field/2026-11-05-city/acceptance.md). The same district as city.js, set up the way a
// game sets it up, which city() does not: every module and the first blocks go in before start(), behind the real loading screen, so the entry numbers are what a player meets.
// On top of city.js it has real lights (lightPool) and real NPCs (engine.npcs), and one page runs entry, standing still, walking, then save and load with everything still moving.
// Frames go into preallocated arrays, so the measuring itself adds nothing to the memory it reports.
import * as THREE from 'three';
import { swarm, sky, world, collision, characters, lightPool } from '../../index.js';
import { kit, makeBlock, makeTraffic, route, pct, P } from './city.js';

const MAX = 400000, PHASES = ['entry', 'stand', 'walk', 'save'];

export function cityGameMethods({ mkEngine, heap, gc, r2 }) {
  return {
    /** entry seconds after the loading screen, stand seconds still, walk seconds along the route, saves rounds of save and load while walking on; drain unloads everything at the end */
    async cityGame({ blocks = 20, radius = 320, cars = 2000, people = 12000, npcs = 200, lamps = 4, pool = 8, entry = 5, stand = 30, walk = 120, every = 30, speed = 8, saves = 0, drain = false }) {
      // every pipeline with its time and how it was asked for: sync ones block the frame that asks, async ones run behind it
      const pipes = [];
      for (const k of ['createRenderPipeline', 'createRenderPipelineAsync']) { const f = GPUDevice.prototype[k]; GPUDevice.prototype[k] = function (d) { const a = performance.now(); try { return f.call(this, d); } finally { pipes.push([a, k.endsWith('Async') ? 'async' : 'sync']); } }; }
      const e = window.engine = mkEngine({ headless: false, ui: { loading: { title: 'City' } }, saveKey: 'city-accept' });
      e.use(world(), collision(), characters({ npcs: true }), swarm(), sky({ time: 0.4 }), lightPool({ point: pool }));
      e.camera.far = 1600; e.camera.updateProjectionMatrix();
      e.stream.setRadius(radius);
      const K = kit(), N = blocks, mid = N * P / 2, lit = new Map();
      const road = new THREE.Mesh(new THREE.PlaneGeometry(N * P + P, N * P + P).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.95 })); road.position.y = -0.05; road.receiveShadow = true; e.add(road);
      const handles = [];
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const x = (i - N / 2 + 0.5) * P, z = (j - N / 2 + 0.5) * P, downtown = Math.max(0.15, 1 - Math.hypot(x, z) / mid), seed = i * 1000 + j;
        handles.push(e.stream.add({ position: [x, 0, z], radius: P / 2,
          build: () => { const b = makeBlock(K, x, z, seed, downtown), l = []; for (let k = 0; k < lamps; k++) l.push(e.lightPool.add([x + (k & 1 ? 39 : -39), 6, z + (k & 2 ? 39 : -39)], { color: 0xffd9a0, intensity: 30, distance: 24 })); lit.set(b, l); return b; },
          dispose: b => { for (const h of lit.get(b)) h.remove(); lit.delete(b); e.remove(b); } }));
      }
      const { cars: sc, people: sp } = makeTraffic(e, N, cars, people, K, true);
      const R = route(N), p = {}, H = 1.7; let s = 0;
      const place = () => { R.at(s, p); const c = e.camera; c.position.set(p.x + 6, H, p.z + 6); c.lookAt(c.position.x + p.dx * 40, H, c.position.z + p.dz * 40); };
      place(); e.stream.source(e.camera, { detail: 'full', physics: false });
      const npcList = [];
      for (let i = 0; i < npcs; i++) { R.at(i * 37 % R.total, p); npcList.push(e.npcs.add({ id: 'n' + i, name: 'n' + i, position: [p.x + 10, 0, p.z + 10], behavior: 'wander', mind: { radius: 10 } })); }
      place();

      const walls = new Float32Array(MAX), cpus = new Float32Array(MAX), phase = new Uint8Array(MAX), busy = new Uint8Array(MAX);
      let n = 0, ph = 0, entered = 0, lastWall = 0, tReady = 0;
      const timed = (o, k) => { const f = o[k]; o[k] = function (...a) { const t = performance.now(); try { return f.apply(this, a); } finally { if (performance.now() - t > 0.2) entered = 1; } }; };
      timed(e.stream, '_update'); timed(e.jobs, 'run');   // a frame that built or unloaded a block: the "new area" frames of question 2
      const rows = window.rows = [], G = window.__gpu ?? {};
      const stat = (a, b) => { const w = Array.from(walls.subarray(a, b)).sort((x, y) => x - y), c = Array.from(cpus.subarray(a, b)).sort((x, y) => x - y);
        return { frames: b - a, fps: r2(1000 * (b - a) / Math.max(1, w.reduce((u, v) => u + v, 0))), w50: r2(pct(w, 0.5)), w95: r2(pct(w, 0.95)), w99: r2(pct(w, 0.99)), w999: r2(pct(w, 0.999)), worst: r2(w.at(-1) ?? 0), over33: w.filter(v => v > 33.4).length, over50: w.filter(v => v > 50).length, over100: w.filter(v => v > 100).length, cpu50: r2(pct(c, 0.5)), cpu95: r2(pct(c, 0.95)) }; };
      const objects = () => { let a = 0; e.scene.traverse(() => { a++; }); return a; };
      const snapshot = () => { const c = e.counts(), i = e.renderer.info, b = e.batching?.stats, st = e.stream.stats;
        return { built: st.built, queued: st.queued, batches: b?.batches ?? null, instances: b?.instances ?? null, objects: objects(), records: e.renderer._objects?._renderObjects?.size ?? null, geometries: i.memory.geometries, textures: i.memory.textures, heapMB: heap(), gpuMB: G.bytes ? r2(G.bytes / 1048576) : null, buffers: G.buffers ?? null, bindGroupsLive: G.bindGroupsLive ?? null, pipelines: pipes.length,
          listeners: c.listeners, timers: c.timers, jobs: c.jobs, statics: c.statics, fixed: c.fixed, frame: c.frame, dom: document.getElementsByTagName('*').length, lightSources: [...lit.values()].reduce((u, l) => u + l.length, 0), world: c.world ?? null }; };
      window.cityStage = () => ({ stage: 'loading', ms: Math.round(performance.now()), built: e.stream.stats.built, queued: e.stream.stats.queued });

      let last0 = 0, tRow = 0, walking = false, failure = null;
      const tick = () => {
        try {
          const now = performance.now(), w = now - lastWall; lastWall = now;
          if (n < MAX) { walls[n] = w; cpus[n] = e._cpuMs ?? 0; phase[n] = ph; busy[n] = entered; n++; } entered = 0;
          if (walking) { s += speed * Math.min(w, 100) / 1000; place(); }
          if (every && now >= tRow && (ph === 1 || ph === 2)) { tRow = now + every * 1000; rows.push({ t: Math.round((now - tReady) / 1000), phase: PHASES[ph], km: r2(s / 1000), ...stat(last0, n), ...snapshot() }); last0 = n; }
          requestAnimationFrame(tick);
        } catch (err) { failure = String(err?.stack ?? err).slice(0, 400); }
      };
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      let shownAt = null;
      const shown = new Promise(res => e.events.once('engine:ready', () => { tReady = lastWall = performance.now(); shownAt = snapshot(); requestAnimationFrame(tick); res(); }));
      await e.start(); await shown;
      const pipesAtShow = pipes.filter(x => x[0] < tReady).length;
      window.cityStage = () => ({ stage: PHASES[ph], s: Math.round((performance.now() - tReady) / 1000), km: r2(s / 1000), frames: n, built: e.stream.stats.built, last: rows.at(-1) ?? null, failure });
      await sleep(entry * 1000);
      const startup = e.startup, nEntry = n, firstFrames = Array.from(walls.subarray(0, Math.min(n, 12)), r2), entryStat = stat(0, n), pipesEntry = pipes.filter(x => x[0] >= tReady).map(x => [Math.round(x[0] - tReady), x[1]]);
      ph = 1; last0 = n; tRow = performance.now() + every * 1000;
      await sleep(stand * 1000);
      const nStand = n, standStat = stat(nEntry, n), pipesStandEnd = pipes.length;
      ph = 2; last0 = n; walking = true; tRow = performance.now() + every * 1000; await gc();
      await sleep(walk * 1000);
      const nWalk = n, walkStat = stat(nStand, n), pipesWalk = pipes.length - pipesStandEnd;
      const inWalk = f => { const l = []; for (let i = nStand; i < nWalk; i++) if (f(i)) l.push(i); return l; };
      const of = l => { const w = l.map(i => walls[i]).sort((x, y) => x - y); return { n: l.length, w50: r2(pct(w, 0.5)), w95: r2(pct(w, 0.95)), w99: r2(pct(w, 0.99)), worst: r2(w.at(-1) ?? 0), over33: w.filter(v => v > 33.4).length, over50: w.filter(v => v > 50).length, over100: w.filter(v => v > 100).length }; };
      const newArea = of(inWalk(i => busy[i])), otherFrames = of(inWalk(i => !busy[i]));
      // a hitch is a late frame; its neighbours tell whether block work is near it, since a block built in frame i can show up as cost in frame i or i+1
      const hitches = inWalk(i => walls[i] > 33.4), nearBlock = hitches.filter(i => busy[i] || busy[i - 1] || busy[i + 1]).length;

      // save and load with the city moving: a state digest taken at the save, compared at the instant the load has applied
      const digest = () => { const h = q => { let a = 0; const d = q.data; for (let i = 0; i < q.count; i++) a += d.x[i] * (i % 97 + 1) + d.z[i] * (i % 89 + 3); return { n: q.count, sum: r2(a) }; };
        let nx = 0; for (const c of npcList) { const r = c.data; if (r) nx += r.position.x + r.position.z * 3; } return { cars: h(sc), people: h(sp), npcs: npcList.filter(c => c.data).length, npcSum: r2(nx), marker: !!e.world.get('accept-marker') }; };
      const saveRows = []; ph = 3;
      for (let i = 0; i < saves; i++) {
        const before = digest(), f0 = n, t0 = performance.now(), pr = e.saves.save('accept'), syncMs = r2(performance.now() - t0), ok = await pr, saveMs = r2(performance.now() - t0), fSave = n;
        e.world.add({ kind: 'accept', id: 'accept-marker', position: [0, 0, 0] }); await sleep(3000);
        const moved = digest(), quick = i % 2 === 0; let at = null; const off = e.events.on('save:loaded', () => { at = digest(); });
        const f1 = n, t1 = performance.now(), okLoad = await (quick ? e.saves.load('accept') : e.session.load('accept')), loadMs = r2(performance.now() - t1); off.remove();
        const f2 = n; at ??= digest(); await sleep(2000);
        const after = snapshot(), same = JSON.stringify(at) === JSON.stringify(before);
        saveRows.push({ kind: quick ? 'saves.load' : 'session.load', ok, okLoad, syncMs, saveMs, loadMs, saveWorstFrame: r2(Math.max(0, ...walls.subarray(f0, fSave + 2))), loadWorstFrame: r2(Math.max(0, ...walls.subarray(f1, f2 + 2))), same, diff: same ? null : { before, at }, movedBetween: moved.people.sum !== before.people.sum, markerGone: !e.world.get('accept-marker'), built: after.built, batches: after.batches, instances: after.instances, afterFrames: stat(f2, n) });
        if (e.world.get('accept-marker')) e.world.remove('accept-marker');
      }
      const saveBytes = saves ? JSON.stringify(e.saves._collect().data).length : null;
      walking = false;
      const endSnap = snapshot(); let drained = null;
      if (drain) { ph = 1; window.cityStage = () => ({ stage: 'drain', frames: n }); for (const h of handles) h.remove(); await sleep(16000); await gc(); drained = snapshot(); }
      await gc(); const heapEnd = heap();
      const out = { startup: { firstFrameMs: startup.firstFrameMs, compileMs: startup.compileMs, streamMs: startup.streamMs, totalMs: startup.totalMs, phases: startup.phases }, pipesAtShow, shownAt, firstFrames, entryStat, pipesEntry, standStat, walkStat, pipesWalk, km: r2(s / 1000), newArea, otherFrames, hitches: hitches.length, nearBlock, saveBytes, saveRows, rows, endSnap, drained, heapEnd, failure, cars: sc.count, people: sp.count, npcs: npcList.length };
      e.dispose(); return out;
    },
  };
}

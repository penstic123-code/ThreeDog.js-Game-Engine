// Soak page section (driven by tests/stress-field/soak.mjs and the guard spec tests/specs/soak-guard.mjs, never part of a normal game).
// One game plays itself with nobody at the controls: a fixed loop of actions that a real play session repeats (stream terrain and city blocks in and out,
// spawn and remove records, quests, dialogue, weather and day cycles, save and load, new game, scene change, engine dispose and re-create), each followed by
// fixed steps. After every round the page forces a gc and writes one row: heap, renderer geometries/textures, the engine's own counts (listeners, timers,
// jobs, per module), tracked GPU bytes (run.mjs hooks, when present), frame time. A number that keeps rising after warm-up is the finding.
// Why a separate loop and not window.sf.longStart: that one flies a camera only; a leak that needs "save then load then scene change" never shows there.
import * as THREE from 'three';
import { world, terrain, vegetation, sky, particles, weather, calendar, quests, dialogue, level } from '../../index.js';
import { terrainPreset } from '@threedog/terrain-noise';
import { kit, makeBlock } from './city.js';

const DT = 1 / 60;
const r1 = v => Math.round(v * 10) / 10;
const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const WEATHER = ['wet', 'clear'];

export function soakMethods({ mkEngine, ready, heap, gc }) {
  return {
  /**
   * @param {{ rounds?: number, minutes?: number, simulated?: boolean, stepsPerAction?: number, sampleEvery?: number, recreateEvery?: number, city?: boolean, render?: boolean }} p
   * rounds: stop after this many rounds (each round = every action once); minutes: or after this much wall time (whichever first).
   * simulated: no rendering between actions except the first step of each, and many more fixed steps per action (days of game time in little wall time).
   */
  async soak({ rounds = Infinity, minutes = Infinity, simulated = false, stepsPerAction = simulated ? 1800 : 30, sampleEvery = 1, recreateEvery = 4, city = true, render = true, seed = 1, kinds = false }) {
    const rand = rng(seed), rows = [], errors = [];
    const onErr = ev => errors.push(String(ev.message || ev).slice(0, 200));
    window.addEventListener('error', onErr);
    const t0 = performance.now();
    let e = null, canvas = null, K = null, handles = [], cam = null, ids = [], round = 0, gen = 0;
    // frame times of the steps taken with rendering, since the last sample
    let ms = [];
    const step = async n => {
      for (let i = 0; i < n; i++) {
        const doRender = render && (!simulated || i === 0);
        const a = performance.now();
        e.input.poll(DT); e._fixedStep(); e._frameHooks(DT); if (doRender) e._render(DT); e.budget.sample(DT); e.input.endFrame(); e._runHooks('afterRender', DT);
        if (doRender) ms.push(performance.now() - a);
        if (i % 120 === 119) await tick();   // let the page breathe (the poll in run.mjs, timers, GPU callbacks)
      }
      await tick();
    };

    const make = async () => {
      const levelA = new THREE.Group(); levelA.add(new THREE.Mesh(new THREE.BoxGeometry(4, 1, 4), new THREE.MeshLambertMaterial({ color: 0x668866 })));
      canvas?.remove(); canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 360 }); document.body.append(canvas);   // a disposed engine releases its canvas, so each one gets its own
      e = await ready(mkEngine({ headless: true, saveKey: 'soak-' + gen++ }, canvas));
      window.engine = e;
      e.use(world(), terrain({ ...terrainPreset(), viewChunks: 2 }), vegetation(), sky(), particles(), weather({ types: { wet: { rain: 1 }, clear: {} } }),
        calendar({ dayLength: 120 }), quests(), dialogue(), level({ scene: levelA }));
      e.vegetation.define('tree', { geometry: new THREE.ConeGeometry(0.8, 3, 6).translate(0, 1.5, 0), wind: 0.08, rule: { perChunk: 30 } });
      e.particles.define('puff', { rate: 0, max: 30, color: [0xffffff, 0xffeeaa], size: [0.6, 0.6], lifetime: [100, 100], speed: [0, 0] });
      const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8).translate(0, 0.4, 0), mat = new THREE.MeshLambertMaterial({ color: 0xa08050 });
      e.world.present('thing', { radius: 1e5, build: rec => { const o = new THREE.Mesh(geo, mat); o.rotation.y = rec.rot ?? 0; return o; } });
      e.quests.define('q1', { title: 'Soak', steps: [{ text: 'a', done: en => en.vars.flag('soakA') }, { text: 'b', done: en => en.vars.flag('soakB') }] });
      e.dialogue.define('npc', { start: { text: 'Hello', choices: [{ text: 'Bye', next: 'end' }] }, end: { text: 'Bye' } });
      cam = e.camera; cam.position.set(0, 60, 0); cam.lookAt(50, 55, 15);
      e.stream.source(cam, { detail: 'full', physics: false });
      K = null; handles = [];
      if (city) {   // a district far from the terrain origin: the camera hops between the two, so both sides stream in and out
        K = kit(); e.stream.setRadius(150);
        for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { const x = 3000 + i * 96, z = j * 96, s = i * 6 + j; handles.push(e.stream.add({ position: [x, 0, z], radius: 48, build: () => makeBlock(K, x, z, s, 0.6) })); }
      }
      ids = [];
      await step(10);
    };

    const counts = () => {
      const c = e.counts(), mods = {}; for (const k of ['world', 'particles', 'sky', 'calendar', 'weather', 'quests', 'dialogue', 'level']) if (c[k] != null) mods[k] = c[k];
      return { listeners: c.listeners, fixed: c.fixed, frame: c.frame, timers: c.timers, statics: c.statics, streamEntries: c.streamEntries, jobs: c.jobs, commits: c.commits, geometries: c.geometries, textures: c.textures, mods };
    };
    const sample = async what => {
      await gc();
      const g = window.__gpu, sorted = [...ms].sort((a, b) => a - b), q = p => sorted.length ? r1(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]) : null;
      const row = { round, gen, action: what, tMin: Math.round((performance.now() - t0) / 600) / 100, heapMB: heap(), ...counts(), sceneChildren: e.scene.children.length, domCanvas: document.querySelectorAll('canvas').length,
        frames: sorted.length, frameP50: q(0.5), frameP99: q(0.99), frameMax: q(1),
        ...(g && { gpuMB: Math.round(g.bytes / 1048576), gpuBuffers: g.buffers, bindGroupsLive: g.bindGroupsLive, pipelines: g.pipelines, devices: g.devices }),
        day: e.calendar?.day, ...(kinds && g?.kinds && { kinds: Object.entries(g.kinds).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 10) }) };
      ms = []; rows.push(row); window.soakRows = rows; return row;
    };

    const actions = {
      /** terrain chunks stream in and out as the camera walks 400 m, then the city side and back */
      async stream() {
        const hop = async (x, z, n = 40) => { cam.position.set(x, 60, z); cam.lookAt(x + 50, 55, z + 15); await step(n); };
        for (let k = 1; k <= 4; k++) await hop(k * 100, k * 30, stepsPerAction / 4);
        if (city) { await hop(3000 + rand() * 400, 100 + rand() * 300, stepsPerAction); await hop(3000 + rand() * 400, 100 + rand() * 300, stepsPerAction); }
        await hop(0, 0, stepsPerAction);
      },
      /** records added, shown (views built), removed */
      async spawn() {
        const mine = []; for (let i = 0; i < 150; i++) mine.push(e.world.add({ kind: 'thing', position: [(i % 15) * 2, 0, Math.floor(i / 15) * 2], rot: i }, { save: false }).id);
        e.world.refresh(); await step(10);
        for (const id of mine) e.world.remove(id);
        e.world.refresh(); await step(10);
        e.particles.emit('puff', { x: 0, y: 3, z: 0 }, { count: 10 }); await step(stepsPerAction);
      },
      async quest() {
        e.vars.setFlag('soakA', false); e.vars.setFlag('soakB', false);
        e.quests.start('q1'); await step(70);
        e.vars.setFlag('soakA', true); await step(70); e.vars.setFlag('soakB', true); await step(70);
        e.dialogue.start('npc'); await step(30); e.dialogue.end();
        e.dialogue.say('bye', { channel: 'bubble', at: [0, 2, 0], seconds: 0.5 }); await step(60);
      },
      async weatherDay() {
        for (const w of WEATHER) { e.weather.set(w); await step(Math.max(60, stepsPerAction / 2)); }
        e.calendar.timeOfDay = rand();   // jumps over many timers
        await step(stepsPerAction);
      },
      /** the saved world holds the live records, so it also reloads the views */
      async saveLoad() {
        e.world.add({ kind: 'thing', position: [1, 0, 1] });
        await e.saves.save('s1'); await e.saves.load('s1'); await step(20); await e.saves.remove?.('s1');
      },
      async newGame() { await e.session.newGame(); await step(20); },
      async scene() {
        const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(2 + rand(), 1, 2), new THREE.MeshLambertMaterial({ color: 0x884444 })));
        await e.level.load(g); await step(20);
      },
    };

    let aborted = null;
    try {
      await make(); await sample('start');
      for (round = 1; round <= rounds && (performance.now() - t0) / 60000 < minutes; round++) {
        for (const [name, fn] of Object.entries(actions)) {
          try { await fn(); } catch (err) { errors.push(`${name}: ${String(err?.message ?? err).slice(0, 160)}`); }
        }
        if (round % recreateEvery === 0) {   // a whole new engine: whatever the old one left behind shows as growth between generations
          const old = e; await step(2); old.dispose(); await make();
          await sample('recreate'); continue;
        }
        if (round % sampleEvery === 0) await sample('round');
      }
    } catch (err) { aborted = String(err?.stack ?? err).slice(0, 400); }
    window.removeEventListener('error', onErr);
    try { await sample('end'); } catch {}
    try { e.dispose(); } catch {}
    return { rows, errors: [...new Set(errors)].slice(0, 10), aborted, wallS: Math.round((performance.now() - t0) / 1000), rounds: round - 1 };
  },
};
}

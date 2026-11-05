// engine.inspect.perf(): one frame's cost in numbers, each against a budget, with the next call when it is over. Read on call (nothing runs per frame:
// the counters it reads are three.js's renderer.info and what the loop already measures: cpuMs, cpuPhases, budget.cost.compiles, startup.compileMs).
// Budgets: the game's engine.budget limits where it set one, else a metric's own limit, else REFERENCE (a mid-range desktop browser at 60 fps). The reference is a starting point
// for reading the numbers, not a rule the engine enforces; engine.budget.enable({...}) sets real ones (and then warns while playing).
// Plain three.js equivalent: renderer.info.render (calls, triangles), renderer.info.programs.length, renderer.info.memory; performance.now() around render.
import { inspectMaterials } from './InspectMaterials.js';
import { programCosts } from './shaderCost.js';
import { mb } from './textureBytes.js';
import { r1 } from './math.js';
import { stats, memory } from '../render/backend.js';

/** Reference budgets (desktop, 60 fps) used when the game set none in engine.budget */
const REFERENCE = { drawCalls: 300, triangles: 1_000_000, programs: 60, textureMB: 256, cpuMs: 8, compileMs: 50 };
const NEXT = {
  drawCalls: '`threedog capture` (which objects draw most), merge repeats (engine.batching: your own static repeats with userData.batch = true; InstancedMesh, BatchedMesh)',
  triangles: 'LOD / hlod for far objects (THREE.LOD), lower-poly models; hlod cells or big batches behind walls: engine.occlusion.enabled = true; `threedog capture` lists the largest draws',
  programs: 'engine.inspect.materials(): share materials instead of cloning per mesh; each distinct material setup and light setup is one program',
  textureMB: 'engine.inspect.materials() lists the largest textures: smaller sizes, KTX2 compressed textures (KTX2Loader)',
  cpuMs: 'engine.profile(true) then engine.profile() (ms per module), engine.inspect.perf().cpuPhases (fixed / frame / render)',
  compileMs: 'compile before play: renderer.compileAsync(scene, camera) after adding new materials, keep the light count fixed (lightPool)',
  lights: 'many lights: light pool, engine.use(lightPool({ point: 8 })) then engine.lightPool.add(torch, { intensity: 4, distance: 8 })',
  shadowLights: 'set castShadow = false on the lights that can go without; a point light draws six shadow maps',
  shadowMaps: 'set castShadow = false on the lights that can go without; a point light draws six shadow maps',
  shadowMapSize: 'pick light.shadow.mapSize from engine.tier in the picture code',
};

/** @param {any} e the engine @param {{ top?: number }} [opts] top: how many costliest programs to list */
// "first frame 1840 ms = script 210 + construct 40 + ..." (engine.startup.phases; startup.js); empty before the first frame
function firstFrameLine(s) {
  if (s?.firstFrameMs == null) return '';
  return `first frame: ${s.firstFrameMs} ms from page open = ${Object.entries(s.phases).map(([k, v]) => `${k} ${v}`).join(' + ')}`;
}

export function inspectPerf(e, { top = 5 } = {}) {
  const r = e.renderer, s = stats(r), lim = e.budget?.limits ?? {};
  const mats = inspectMaterials(e, { limit: 0 });
  const compiles = e.budget?.cost?.compiles ?? [];
  const worst = compiles.reduce((m, c) => Math.max(m, c.ms), 0);
  const programs = programCosts(r, e.scene);   // WebGPU too: the scene's node programs (no program count there, but the costliest still listed)
  const values = {
    drawCalls: s.drawCalls, triangles: s.triangles, programs: s.programs,   // null on WebGPU (no program list): not counted, not budgeted, rather than a 0 that always passes
    textureMB: r1(mats.textureBytes / 1048576), cpuMs: r1(e._cpuMs ?? 0), compileMs: worst,
  };
  const gpu = e.budget?.values() ?? {};
  for (const k of ['lights', 'shadowLights', 'shadowMaps', 'shadowMapSize']) values[k] = gpu[k];
  // these four have no reference: without a limit they stay out, a number with nothing to read it against
  // no draw counted = no frame to judge (headless before the first frame, or a page that has not drawn yet). A 0 here is not a good result, so the frame's
  // own metrics leave the budget list instead of showing a tick; what is true without a frame (textures, lights) stays
  const measured = s.drawCalls > 0, frameOnly = new Set(['drawCalls', 'triangles', 'cpuMs', 'compileMs']);
  const budgets = Object.keys(values).filter(k => values[k] != null && (measured || !frameOnly.has(k)) && (e.budget?.limitOf(k) ?? REFERENCE[k]) != null).map(k => {
    const limit = e.budget?.limitOf(k) ?? REFERENCE[k], own = lim[k] != null;
    const ok = values[k] <= limit;
    return { name: k, value: values[k], budget: limit, from: own ? 'engine.budget' : 'reference', ok, ...(ok ? {} : { next: NEXT[k] }) };
  });
  const p = e._cpuPhases ?? {};
  const fmtN = v => v >= 1e6 ? r1(v / 1e6) + 'M' : v >= 1e4 ? Math.round(v / 1000) + 'k' : String(v);
  const hint = e.batching?.stats.hint;
  const unit = { textureMB: ' MB', cpuMs: ' ms', compileMs: ' ms (worst stall)' };
  const text = [
    measured ? `frame: ${values.drawCalls} draw calls (incl. shadow + post passes), ${fmtN(values.triangles)} triangles, ${values.programs == null ? 'programs not counted (WebGPU)' : values.programs + ' programs'}, ~${mb(mats.textureBytes)} textures `
      + `(${mats.textures}), JS ${values.cpuMs} ms (fixed ${r1(p.fixed ?? 0)} / frame ${r1(p.frame ?? 0)} / render ${r1(p.render ?? 0)}), fps ${Math.round(e.fps ?? 0)}`
      : `nothing measured yet: no draw has been counted, so draw calls, triangles, JS ms and compile stalls have no value. Draw a frame first (engine.step(1 / 60), or threedog step 1 / snap --play), then ask again. ~${mb(mats.textureBytes)} textures (${mats.textures})`,
    firstFrameLine(e.startup),
    `compile: startup ${e.startup?.compileMs ?? '?'} ms; ${compiles.length} stall frame${compiles.length === 1 ? '' : 's'} during play${compiles.length ? ` (worst ${worst} ms, last at ${compiles.at(-1).at} s, +${compiles.at(-1).programs} programs)` : ''}`,
    ...budgets.map(b => `${b.ok ? '✓' : '✗'} ${b.name} ${b.name === 'triangles' ? fmtN(b.value) : b.value}${unit[b.name] ?? ''} / ${b.name === 'triangles' ? fmtN(b.budget) : b.budget} (${b.from})${b.ok ? '' : ' -> ' + b.next}`),
    // dev: many identical game meshes drawn one by one (batching leaves game objects alone unless they opt in; core/Batching.js)
    hint ? `batching: ${hint}` : '',
    programs.length ? `costliest programs (fragment lines + 25 x samplers): ${programs.slice(0, top).map(c => `${c.name} ${c.score} (${c.fragmentLines} lines, ${c.samplers} samplers)`).join(', ')}; see them: engine.debug.view('shaderCost')` : '',
  ].filter(Boolean).join('\n');
  return { ...values, cpuPhases: { ...p }, fps: r1(e.fps ?? 0), startupCompileMs: e.startup?.compileMs ?? null, compiles: compiles.slice(),
    textureCount: mats.textures, memory: memory(r), programCosts: programs.slice(0, top), budgets, measured, ok: measured && budgets.every(b => b.ok), text };
}

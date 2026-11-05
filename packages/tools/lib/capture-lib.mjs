// Helpers of `threedog capture` (capture.mjs): the in-page renderer hook, the Spector.js loader and the text summary.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Spector.js on the npm CDN; fetched once into the workspace cache and injected by the capture command only (never a dependency of an engine page) */
export const SPECTOR_URL = 'https://cdn.jsdelivr.net/npm/spectorjs@0.9.30/dist/spector.bundle.js';

/**
 * Runs inside the page. Wraps the one function each renderer draws through (shadow and post passes included): WebGLRenderer.renderBufferDirect, or
 * WebGPURenderer._renderObjectDirect, on both of its backends. The draws of every render from now on land in window.__draws = { passes, draws }. Names come
 * from ThreeDog: the world record that owns the object (engine.world), userData.budgetTag and material.userData.purpose.
 * Returns the name of the function it wrapped, or null when this renderer has neither: the tool then refuses, an empty report would read as a free frame.
 * shortcut: _renderObjectDirect is three's private name, there is no public draw hook on WebGPURenderer (setRenderObjectFunction is taken by the shadow pass); a three.js update that renames it lands in that refusal.
 */
export function hookScript() {
  const r = engine.renderer, owners = new Map(), passes = [], draws = [];
  try { for (const rec of engine.world?.query?.({}) ?? []) { const o = engine.world.view(rec.id); if (o) owners.set(o, rec.id); } } catch { /* no world module */ }
  const up = (obj, f) => { for (let o = obj; o; o = o.parent) { const v = f(o); if (v) return v; } return null; };
  const rtName = t => (t ? (t.texture?.name || (t.depthTexture ? 'depth target' : 'target')) + ` ${t.width}x${t.height}` : 'screen');
  let cur = null;
  const note = (geometry, material, object, group) => {
    const t = r.getRenderTarget();
    if (!cur || cur.t !== t) { cur = { t, name: rtName(t), draws: 0, tris: 0, depthOnly: true }; passes.push(cur); }
    const idx = geometry.index, total = group ? group.count : idx ? idx.count : (geometry.attributes.position?.count ?? 0);
    const n = Math.min(total, geometry.drawRange.count), inst = object.isInstancedMesh ? object.count : 1;
    // a WebGPU shadow pass draws with a node material, so the target says it is one (ShadowNode names its depth texture), not the material
    const tris = object.isMesh ? Math.round(n / 3) * inst : 0, depth = !!(material.isMeshDepthMaterial || material.isMeshDistanceMaterial || t?.depthTexture?.name === 'ShadowDepthTexture');
    cur.draws++; cur.tris += tris; if (!depth) cur.depthOnly = false;
    if (draws.length < 20000) draws.push({
      pass: passes.length - 1, tris, inst, depth, type: object.type, name: object.name || object.geometry?.name || '',
      record: up(object, o => owners.get(o)), tag: up(object, o => o.userData?.budgetTag),
      material: material.userData?.purpose || material.name || material.type, materialType: material.type,
    });
  };
  const hook = r.renderBufferDirect ? 'renderBufferDirect' : r._renderObjectDirect ? '_renderObjectDirect' : null;
  if (!hook) return null;
  const direct = r[hook];
  r[hook] = hook === 'renderBufferDirect'
    ? function (camera, scene, geometry, material, object, group) { note(geometry, material, object, group); return direct.apply(this, arguments); }
    : function (object, material, scene, camera, lightsNode, group) { note(object.geometry, material, object, group); return direct.apply(this, arguments); };
  // the renderer takes its draw function from this property at the start of each render(), so the wrapper above is the one the next render calls
  const setTarget = r.setRenderTarget;
  r.setRenderTarget = function (t, ...rest) { if (cur && cur.t !== t) cur = null; return setTarget.call(this, t, ...rest); };
  window.__draws = { passes, draws };
  // serialisable view for page.evaluate's return value: the render targets themselves cannot cross
  Object.defineProperty(window.__draws, 'toJSON', { value: () => ({ passes: passes.map(p => ({ name: p.name, draws: p.draws, tris: p.tris, depthOnly: p.depthOnly })), draws }) });
  return hook;
}

/** The Spector bundle text: from the cache, else fetched from url (default SPECTOR_URL) and cached */
export async function fetchSpector(cacheDir, url = SPECTOR_URL) {
  const file = join(cacheDir, 'spector.bundle.js');
  if (url === SPECTOR_URL && existsSync(file)) return readFileSync(file, 'utf8');
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const text = await res.text();
  if (!text.includes('SPECTOR')) throw new Error(`${url} is not a Spector bundle`);
  if (url === SPECTOR_URL) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(file, text); }
  return text;
}

const DRAW = /^(draw|multiDraw)/;
/** Counts from a Spector capture: commands, draw calls (instanced ones apart) and framebuffer binds */
export function spectorDraws(cap) {
  const c = cap.commands ?? [], draws = c.filter(x => DRAW.test(x.name));
  return { commands: c.length, draws: draws.length, instanced: draws.filter(x => /Instanced/.test(x.name)).length, framebufferBinds: c.filter(x => x.name === 'bindFramebuffer').length,
    programs: c.filter(x => x.name === 'useProgram').length };
}

const pad = (s, n) => String(s).padEnd(n), top = (m, n) => [...m].sort((a, b) => b[1].tris - a[1].tris).slice(0, n);
/** Text summary of one frame: frame = the page's { passes, draws }, gl = spectorDraws() or null */
export function summarize(frame, { top: N = 8, gl = null } = {}) {
  const { passes, draws } = frame, main = draws.filter(d => !d.depth), shadow = draws.filter(d => d.depth);
  const L = [];
  L.push(`Frame: ${draws.length} draw calls in ${passes.length} render passes · shadow-map draws ${shadow.length} · scene and post draws ${main.length} · triangles ${main.reduce((a, d) => a + d.tris, 0)} (shadow ${shadow.reduce((a, d) => a + d.tris, 0)})`);
  L.push('', 'Passes (in order):');
  passes.forEach((p, i) => L.push(`  ${pad(i + 1, 3)} ${pad(p.name, 28)} ${pad(p.draws + ' draws', 11)} ${p.tris} tris${p.depthOnly ? '  (depth only: shadow map)' : ''}`));
  const post = passes.filter((p, i) => !p.depthOnly && p.name !== 'screen' && i > 0).length;
  L.push(`  -> post-effect or off-screen colour passes: ${post}`);
  const by = (list, key) => { const m = new Map(); for (const d of list) { const k = key(d) ?? '(none)', s = m.get(k) ?? { draws: 0, tris: 0 }; s.draws++; s.tris += d.tris; m.set(k, s); } return m; };
  const line = (k, s) => `  ${pad(k, 34)} ${pad(s.draws + ' draws', 11)} ${s.tris} tris`;
  L.push('', 'Draws by budget tag (scene draws):', ...top(by(main, d => d.tag), 6).map(([k, s]) => line(k, s)));
  L.push('', 'Draws by material purpose / name (scene draws):', ...top(by(main, d => d.material), 6).map(([k, s]) => line(k, s)));
  if (main.some(d => d.record)) L.push('', 'Draws by world record id (scene draws; ids as in engine.world.get(id)):', ...top(by(main.filter(d => d.record), d => d.record), 5).map(([k, s]) => line(k, s)));
  if (shadow.length) L.push('', 'Shadow-map draws by budget tag:', ...top(by(shadow, d => d.tag), 4).map(([k, s]) => line(k, s)));
  L.push('', `Largest ${N} scene draws by triangles:`);
  [...main].sort((a, b) => b.tris - a.tris).slice(0, N).forEach((d, i) => L.push(
    `  ${pad(i + 1, 3)} ${pad(d.tris + ' tris', 12)} ${d.inst > 1 ? 'x' + d.inst + ' instances  ' : ''}${d.type}${d.name ? ' "' + d.name + '"' : ''}` +
    `  record ${d.record ?? '-'} · tag ${d.tag ?? '-'} · material ${d.material} (${d.materialType})`));
  if (gl) {
    const hook = draws.length, same = gl.draws === hook;
    L.push('', `Spector (WebGL command stream): ${gl.commands} commands, ${gl.draws} draw calls (${gl.instanced} instanced), ${gl.framebufferBinds} framebuffer binds, ${gl.programs} program switches` +
      (same ? ' · draw count equals the renderer hook' : ` · differs from the renderer hook (${hook}): the hook counts three.js draws, Spector every GL draw`));
  }
  return L.join('\n');
}

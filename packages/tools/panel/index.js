// The dev panel (style workbench + tune): sliders and color pickers over any running engine, plus an export of what changed. Dev only:
//   if (location.search.includes('panel=1')) import('@threedog/tools/panel').then(m => m.openPanel(engine));
// A production build never contains it: the vite preset (gameConfig, vite/vite-threedog-panel.js) swaps this module for a stub that only warns
// (dev and test builds get the real one; without the preset, guard the import with import.meta.env.DEV). Tweakpane comes from the game
// (`npm i -D tweakpane`, optional) as 'virtual:threedog/tweakpane', or Pane = null when it is not installed: the page then says so and runs on.
//
// Two kinds of values, never mixed up in the panel:
//   live     the engine has an API that changes it while running: renderer exposure, sky time, environment lighting, water color, fog,
//            post effects, UI colors (CSS variables). The picture changes at once.
//   rebuild  values read once at startup (the procedural models' palette, terrain colors, wave shape). With opts.overrides (the game passes
//            the ?ov=... style part it read at startup, see examples/styletest/params.js) "apply and rebuild" reloads the page with them;
//            without it the rebuild folder only collects them for the export. The picture does NOT change until a rebuild.
// The exported object holds style fields only (what `style: [pack, {...}]` accepts); the running engine.style and the pack are never written.
// Tune folders (live, generic: any engine): every look part's number / color value (engine.look.<part>.set), a material picked by name
// (color, roughness, metalness, emissive... applied to every material with that name) and numeric engine.uniforms. "write back" saves them with
// the style changes to .threedog/tune.json (dev server); `threedog tune write <file>` then shows the code change as a diff, --apply writes it.
// The models folder lists every generator registered with a params schema; an edit rebuilds its live copies at once (engine.assets.setParams)
// and "write back" + `threedog tune write` puts the values into that schema's defaults where the model is registered.
import { putAt, hexOf, numOf, literal } from './overrides.js';

const UI_KEYS = ['bg', 'fg', 'muted', 'accent', 'good', 'line'];
const LIVE = 'live', REBUILD = ' [needs rebuild]';
const HOW = 'Install the optional dev package with `npm install -D tweakpane`, then reload. 开发面板需要 tweakpane：先运行 npm install -D tweakpane。';

/** Show why there is no panel, in the page (not only the console): the page's #panel-note if it has one, else a small corner note */
function note(text) {
  let el = document.getElementById('panel-note');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'panel-note' });
    el.style.cssText = 'position:fixed;top:8px;right:8px;max-width:320px;z-index:1000;padding:8px;background:#222;color:#fff;font:12px sans-serif';
    document.body.appendChild(el);
  }
  el.textContent = text; el.hidden = false;
  console.warn('threedog panel: ' + text);
}

/**
 * Open the dev panel over a running engine (dev only; see the top of this file).
 * @param {any} engine
 * @param {{ overrides?: Record<string, any> | null }} [opts] overrides: the ?ov= style part the game applied at startup; given (even null), the
 *   panel keeps and extends it and shows "apply and rebuild"
 * @returns {Promise<boolean>} whether the panel is open
 * @example if (location.search.includes('panel=1')) import('@threedog/tools/panel').then(m => m.openPanel(engine));
 */
export async function openPanel(engine, opts = {}) {
  /** @type {any} */ let Pane;
  // @ts-ignore a virtual module of the vite preset (vite/vite-threedog-panel.js): tweakpane, or Pane = null when the game has not installed it
  try { ({ Pane } = await import('virtual:threedog/tweakpane')); } catch (e) { note(`The dev panel could not load tweakpane (${String(e).slice(0, 100)}). ` + HOW); return false; }
  if (!Pane) { note('The dev panel needs the dev package "tweakpane", which is not installed. ' + HOW); return false; }
  const rebuild = 'overrides' in opts, base = opts.overrides;
  const changes = structuredClone(base ?? {}), colors = new Set();
  const notes = new Map();   // post effect -> changed params (an effect list cannot be written as a style literal)
  const put = (path, v, isColor = false) => { putAt(changes, path, v); if (isColor) colors.add(path.join('.')); };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:8px;right:8px;width:310px;max-height:calc(100vh - 16px);overflow:auto;z-index:1000';
  document.body.appendChild(host);
  const pane = new Pane({ title: 'Style workbench', container: host });

  // ---- live: exposure, sky time, light multipliers (preview aids: not style fields, never exported) ----
  const sky = pane.addFolder({ title: `Light (${LIVE})` });
  const light = { exposure: engine.renderer.toneMappingExposure, time: (engine.calendar?.timeOfDay ?? 0) * 24, sun: 1, ambient: 1, fog: 1 };
  sky.addBinding(light, 'exposure', { min: 0.2, max: 3, step: 0.01, label: '曝光 exposure' })
    .on('change', e => { engine.renderer.toneMappingExposure = e.value; put(['exposure'], e.value); });
  sky.addBinding(light, 'time', { min: 0, max: 24, step: 0.1, label: '天空时间 hour (preview)' })
    .on('change', e => { if (engine.calendar) engine.calendar.timeOfDay = e.value / 24 % 1; });
  const layer = () => { for (const [k, n] of [['sun', 'sky.sunLight'], ['ambient', 'sky.ambient'], ['fog', 'sky.fog']]) engine.mod(n, { owner: 'workbench', mul: light[k] }); };
  for (const [k, label] of [['sun', '阳光倍率 sun x (preview)'], ['ambient', '环境光倍率 ambient x (preview)'], ['fog', '雾距离倍率 fog x (preview)']]) {
    sky.addBinding(light, k, { min: 0.1, max: 3, step: 0.05, label }).on('change', layer);
  }

  // ---- live: environment lighting ----
  const envState = { on: !!engine.sky.environment, intensity: engine.sky.environment?.intensity ?? 0.8 };
  const env = pane.addFolder({ title: `环境照明 (${LIVE})` });
  const applyEnv = () => {
    const on = envState.on, opts = { source: 'sky', intensity: envState.intensity };
    (on ? (engine.look.env.replace('sky'), engine.look.env.set({ intensity: opts.intensity })) : engine.look.env.replace(false));
    put(['sky', 'environment'], on ? opts : null);
  };
  env.addBinding(envState, 'on', { label: '开 on' }).on('change', applyEnv);
  env.addBinding(envState, 'intensity', { min: 0, max: 2, step: 0.05, label: '强度 intensity' }).on('change', () => { if (envState.on) applyEnv(); });

  // ---- live: water color (the shared water material) ----
  const wm = engine.water?.material;
  if (wm?.color) {
    const water = { color: hexOf(wm.color.getHex()) };
    pane.addFolder({ title: `水 (${LIVE})` }).addBinding(water, 'color', { label: '颜色 color' })
      .on('change', e => { wm.color.set(e.value); put(['water', 'color'], numOf(e.value), true); });
  }

  // ---- live: post effects, from engine.post.list() / get() / set() ----
  const post = pane.addFolder({ title: `后期 post (${LIVE})`, expanded: false });
  for (const { name, enabled } of engine.post.list()) {
    const h = engine.post.get(name), f = post.addFolder({ title: name, expanded: false });
    const noteOf = () => notes.get(name) ?? notes.set(name, {}).get(name);
    f.addBinding({ enabled }, 'enabled', { label: '开 on' }).on('change', e => { engine.look.post.set({ [name + '.enabled']: e.value }); noteOf().enabled = e.value; });
    for (const [k, v] of Object.entries(h.params)) {
      if (typeof v !== 'number' && typeof v !== 'boolean') continue;   // lut textures, functions...: not editable here
      const range = typeof v === 'number' ? { step: Math.abs(v) >= 10 ? 1 : 0.01, min: Math.min(0, v * 2), max: Math.max(1, v * 3) } : {};
      f.addBinding({ [k]: v }, k, range).on('change', e => { engine.look.post.set({ [name + '.' + k]: e.value }); noteOf()[k] = e.value; });
    }
  }

  // ---- live: UI colors, CSS variables on engine.uiRoot ----
  const css = getComputedStyle(engine.uiRoot), uiVals = {};
  for (const k of UI_KEYS) { const v = css.getPropertyValue('--threedog-' + k).trim(); if (v) uiVals[k] = v; }
  const ui = pane.addFolder({ title: `界面颜色 ui (${LIVE})`, expanded: false });
  for (const k of Object.keys(uiVals)) ui.addBinding(uiVals, k).on('change', e => { engine.uiRoot.style.setProperty('--threedog-' + k, e.value); put(['ui', k], e.value); });

  // ---- rebuild: values the engine reads at startup ----
  const rb = pane.addFolder({ title: 'Needs rebuild (press "apply and rebuild")', expanded: false });
  const style = engine.style ?? {};
  for (const [path, src, title] of [['palette', style.palette, '材质用途/模型色 palette'], ['terrain.colors', style.terrain?.colors, '地形色 terrain.colors']]) {
    if (!src) continue;
    const f = rb.addFolder({ title: title + REBUILD, expanded: false }), vals = {};
    for (const [k, v] of Object.entries(src)) if (typeof v === 'number') vals[k] = hexOf(v);
    for (const k of Object.keys(vals)) f.addBinding(vals, k).on('change', e => put([...path.split('.'), k], numOf(e.value), true));
  }
  if (style.water) {
    const f = rb.addFolder({ title: '水波 water' + REBUILD, expanded: false }), vals = {};
    for (const k of ['waveHeight', 'waveScale', 'waveSpeed', 'fresnel']) if (typeof style.water[k] === 'number') vals[k] = style.water[k];
    for (const k of Object.keys(vals)) f.addBinding(vals, k, { step: 0.01 }).on('change', e => put(['water', k], e.value));
  }

  // ---- live tune: look parts, materials by name, engine uniforms (saved by "write back") ----
  const tune = { look: {}, materials: {}, uniforms: {}, models: {} };
  const tf = pane.addFolder({ title: `调参 tune (${LIVE}, write back)`, expanded: false });
  const isColor = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  const lookF = tf.addFolder({ title: 'look', expanded: false });
  for (const [id, part] of Object.entries(engine.look)) {
    if (typeof part?.values !== 'function') continue;
    const vals = {};
    for (const [k, v] of Object.entries(part.values())) if (typeof v === 'number' || isColor(v)) vals[k] = v;
    if (!Object.keys(vals).length) continue;
    const f = lookF.addFolder({ title: id, expanded: false });
    for (const k of Object.keys(vals)) {
      const range = typeof vals[k] === 'number' ? { step: Math.abs(vals[k]) >= 10 ? 1 : 0.01 } : {};
      f.addBinding(vals, k, range).on('change', e => { part.set({ [k]: e.value }); (tune.look[id] ??= {})[k] = e.value; });
    }
  }
  const names = [...new Set(engine.inspect.materials({ limit: 0 }).materials.map(m => m.name).filter(Boolean))].sort();
  if (names.length) {
    const matF = tf.addFolder({ title: 'material (by name)', expanded: false }), pick = { name: names[0] };
    let sub = null;
    const byName = n => { const out = new Set(); engine.scene.traverse(o => { for (const m of [].concat(o.material || [])) if (m?.name === n && !m.userData?._dbgOf) out.add(m); }); return [...out]; };
    const showMat = () => {
      sub?.dispose();
      const ms = byName(pick.name), m0 = ms[0];
      if (!m0) return;
      sub = matF.addFolder({ title: `${pick.name} (${ms.length})` });
      const vals = {};
      for (const k of ['color', 'emissive']) if (m0[k]?.isColor) vals[k] = '#' + m0[k].getHexString();
      for (const k of ['roughness', 'metalness', 'emissiveIntensity', 'opacity', 'envMapIntensity']) if (typeof m0[k] === 'number') vals[k] = m0[k];
      for (const k of Object.keys(vals)) {
        sub.addBinding(vals, k, typeof vals[k] === 'number' ? { min: 0, max: k === 'emissiveIntensity' || k === 'envMapIntensity' ? 5 : 1, step: 0.01 } : {})
          .on('change', e => { for (const m of byName(pick.name)) m.setValues({ [k]: e.value }); (tune.materials[pick.name] ??= {})[k] = e.value; });
      }
    };
    matF.addBinding(pick, 'name', { options: Object.fromEntries(names.map(n => [n, n])) }).on('change', showMat);
    showMat();
  }
  const uni = Object.entries(engine.uniforms || {}).filter(([, u]) => typeof u?.value === 'number');
  if (uni.length) {
    const uf = tf.addFolder({ title: 'engine.uniforms', expanded: false }), vals = Object.fromEntries(uni.map(([k, u]) => [k, u.value]));
    for (const [k, u] of uni) uf.addBinding(vals, k, { step: 0.01 }).on('change', e => { u.value = e.value; tune.uniforms[k] = e.value; });
  }

  // ---- models: generator params (a model registered as { build, params: schema }); an edit rebuilds every live copy (assets.setParams, hot swap) ----
  const withParams = [...engine.assets.entries].filter(([, x]) => x.named && x.schema).map(([n]) => n).sort();
  if (withParams.length) {
    const mf = tf.addFolder({ title: 'models (params)', expanded: false });
    let busy = null; const queued = new Map();
    // drags fire many changes: one rebuild at a time, the latest values win
    const run = async () => {
      while (queued.size) {
        const [name, v] = queued.entries().next().value; queued.delete(name);
        try { await engine.assets.setParams(name, v); } catch (err) { console.warn('[panel] ' + err.message); }
      }
      busy = null;
    };
    for (const name of withParams) {
      const { schema, values } = engine.assets.paramsOf(name), f = mf.addFolder({ title: name, expanded: false }), vals = {};
      for (const [k, s] of Object.entries(schema)) {
        const v = values[k];
        if (s.type === 'color') vals[k] = typeof v === 'number' ? hexOf(v) : v;
        else if (['number', 'int', 'bool', 'string'].includes(s.type) && v !== undefined) vals[k] = v;
        else continue;
        const o = s.type === 'number' || s.type === 'int' ? { min: s.min, max: s.max, step: s.type === 'int' ? 1 : (s.max != null && s.min != null ? (s.max - s.min) / 100 : 0.01) }
          : s.values ? { options: Object.fromEntries(s.values.map(x => [x, x])) } : {};
        f.addBinding(vals, k, o).on('change', e => {
          const val = s.type === 'color' && typeof v === 'number' ? numOf(e.value) : e.value;
          (tune.models[name] ??= {})[k] = s.type === 'color' ? e.value : val;
          queued.set(name, { ...queued.get(name), [k]: val });
          busy ??= run();
        });
      }
    }
  }

  // ---- export / rebuild ----
  const out = { text: '' };
  const exportText = () => {
    let s = `// paste into createEngine({ style: [yourPack, { ... }] }):\n${literal(changes, colors)}`;
    const posts = [...notes].filter(([, v]) => Object.keys(v).length);
    if (posts.length) {
      s += '\n// post effects are a list, not a literal: call the factory again with these (postAdd(bloom({ strength: 0.6 }))):\n';
      s += posts.map(([n, v]) => `//   ${n}: ${JSON.stringify(v)}`).join('\n');
    }
    return s;
  };
  const ex = pane.addFolder({ title: '导出 / 重建' });
  const mon = ex.addBinding(out, 'text', { readonly: true, multiline: true, rows: 8, label: '' });
  const show = () => { out.text = exportText(); mon.refresh(); return out.text; };
  ex.addButton({ title: '导出覆盖配置 export overrides' }).on('click', () => { navigator.clipboard?.writeText(show()).catch(() => {}); });
  const reload = ov => {
    const u = new URL(location.href);
    if (ov) u.searchParams.set('ov', JSON.stringify(ov)); else u.searchParams.delete('ov');
    location.href = u.href;
  };
  // write back: the dev server saves .threedog/tune.json (tools/vite/vite-threedog-live.js); the code change is `threedog tune write <file>` (dry run first)
  ex.addButton({ title: '写回代码 write back (then: threedog tune write <file>)' }).on('click', async () => {
    try {
      const r = await fetch('/__threedog/tune', { method: 'POST', body: JSON.stringify({ ...tune, style: changes }) }).then(x => x.json());
      out.text = r.ok ? `saved ${r.file}
next: ${r.next}` : 'not saved: ' + r.error;
    } catch (err) { out.text = 'write back needs the dev server (npm run dev): ' + String(err).slice(0, 80); }
    mon.refresh();
  });
  if (rebuild) {
    ex.addButton({ title: '应用并重建预览 apply and rebuild' }).on('click', () => reload(changes));
    ex.addButton({ title: '清除覆盖 clear overrides' }).on('click', () => reload(null));
  }

  engine.describe.add('stylePanel', () => ({ open: true, changes: JSON.parse(JSON.stringify(changes)) }));
  /** @type {any} */ (engine).styleWorkbench = { pane, export: show, changes, tune };   // for tests and the dev bridge
  return true;
}

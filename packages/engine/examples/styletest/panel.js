// Style workbench (?panel=1): sliders and color pickers over the running style test, plus an export of what changed.
// Tweakpane is a dev tool, not an engine dependency: it is a devDependency of the repo and found at build time by the glob below.
// If it is not installed the page says so and runs on without the panel.
//
// Two kinds of values, never mixed up in the panel:
//   live     the engine has an API that changes it while running: renderer exposure, sky time, environment lighting, water color, fog,
//            post effects, UI colors (CSS variables). The picture changes at once.
//   rebuild  values read once at startup (the procedural models' palette, terrain colors, wave shape). The panel keeps them and
//            "apply and rebuild" reloads the page with them as an extra style part (?ov=...). The picture does NOT change until then.
// The exported object holds style fields only (what `style: [lowpoly, {...}]` accepts); the running engine.style and the pack are never written.
import { putAt, hexOf, numOf, literal } from './overrides.js';

// @ts-ignore Vite's import.meta.glob (not in ImportMeta outside Vite); empty when the package is not installed
const loaders = import.meta.glob('../../../../node_modules/tweakpane/dist/tweakpane.js');
const UI_KEYS = ['bg', 'fg', 'muted', 'accent', 'good', 'line'];
const LIVE = 'live', REBUILD = ' [needs rebuild]';
const HOW = 'Run `npm install` in the repository root (tweakpane is a devDependency), then reload. 风格工作台需要 tweakpane：先运行 npm install。';

/** Show why there is no panel, in the page (not only the console) */
function note(text) {
  const el = document.getElementById('panel-note');
  if (el) { el.textContent = text; el.hidden = false; }
  console.warn('styletest panel: ' + text);
}

/**
 * @param {any} engine
 * @param {Record<string, any> | null} base overrides already in the URL (?ov=), kept and extended
 * @returns {Promise<boolean>} whether the panel is open
 */
export async function openPanel(engine, base) {
  const load = Object.values(loaders)[0];
  if (!load) { note('Style workbench needs the dev package "tweakpane", which is not installed. ' + HOW); return false; }
  /** @type {any} */ let Pane;
  try { ({ Pane } = await load()); } catch (e) { note(`Style workbench could not load tweakpane (${String(e).slice(0, 100)}). ` + HOW); return false; }
  const changes = structuredClone(base ?? {}), colors = new Set();
  const notes = new Map();   // post effect -> changed params (an effect list cannot be written as a style literal)
  const put = (path, v, isColor = false) => { putAt(changes, path, v); if (isColor) colors.add(path.join('.')); };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:8px;right:8px;width:310px;max-height:calc(100vh - 16px);overflow:auto;z-index:1000';
  document.body.appendChild(host);
  const pane = new Pane({ title: 'Style workbench', container: host });

  // ---- live: exposure, sky time, light multipliers (preview aids: not style fields, never exported) ----
  const sky = pane.addFolder({ title: `Light (${LIVE})` });
  const light = { exposure: engine.renderer.toneMappingExposure, time: engine.sky.timeOfDay * 24, sun: 1, ambient: 1, fog: 1 };
  sky.addBinding(light, 'exposure', { min: 0.2, max: 3, step: 0.01, label: '曝光 exposure' })
    .on('change', e => { engine.renderer.toneMappingExposure = e.value; put(['exposure'], e.value); });
  sky.addBinding(light, 'time', { min: 0, max: 24, step: 0.1, label: '天空时间 hour (preview)' })
    .on('change', e => { engine.sky.timeOfDay = e.value / 24 % 1; });
  const layer = () => engine.sky.modify('workbench', { sun: light.sun, ambient: light.ambient, fog: light.fog });
  for (const [k, label] of [['sun', '阳光倍率 sun x (preview)'], ['ambient', '环境光倍率 ambient x (preview)'], ['fog', '雾距离倍率 fog x (preview)']]) {
    sky.addBinding(light, k, { min: 0.1, max: 3, step: 0.05, label }).on('change', layer);
  }

  // ---- live: environment lighting ----
  const envState = { on: !!engine.sky.environment, intensity: engine.sky.environment?.intensity ?? 0.8 };
  const env = pane.addFolder({ title: `环境照明 (${LIVE})` });
  const applyEnv = () => {
    const on = envState.on, opts = { source: 'sky', intensity: envState.intensity };
    engine.sky.setEnvironment(on ? opts : null);
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
    f.addBinding({ enabled }, 'enabled', { label: '开 on' }).on('change', e => { engine.post.enable(name, e.value); noteOf().enabled = e.value; });
    for (const [k, v] of Object.entries(h.params)) {
      if (typeof v !== 'number' && typeof v !== 'boolean') continue;   // lut textures, functions...: not editable here
      const range = typeof v === 'number' ? { step: Math.abs(v) >= 10 ? 1 : 0.01, min: Math.min(0, v * 2), max: Math.max(1, v * 3) } : {};
      f.addBinding({ [k]: v }, k, range).on('change', e => { h.set({ [k]: e.value }); noteOf()[k] = e.value; });
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

  // ---- export / rebuild ----
  const out = { text: '' };
  const exportText = () => {
    let s = `// paste into createEngine({ style: [lowpoly, { ... }] }):\n${literal(changes, colors)}`;
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
  ex.addButton({ title: '应用并重建预览 apply and rebuild' }).on('click', () => reload(changes));
  ex.addButton({ title: '清除覆盖 clear overrides' }).on('click', () => reload(null));

  engine.describe.add('stylePanel', () => ({ open: true, changes: JSON.parse(JSON.stringify(changes)) }));
  /** @type {any} */ (engine).styleWorkbench = { pane, export: show, changes };   // for tests and the dev bridge
  return true;
}

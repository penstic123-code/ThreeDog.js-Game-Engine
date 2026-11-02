// The asset gallery (dev): every model and texture the game registered (engine.assets.manifest), each on a turntable under three light setups,
// so a person or an AI reviews all assets at once instead of hunting them in the world. Open it with ?gallery=1 on the dev page (the vite preset
// injects the import), or `threedog gallery [-w game]`; `threedog gallery --shots` writes one PNG per asset per light (headless, the same page).
// The light setups are lighting only and neutral on purpose (white-ish sun high, sun low, sky only): they test how an asset reads under
// different light, they are not a look. The tone mapping and exposure are copied from the game's renderer, so colors match what the game shows.
// It draws with its own WebGLRenderer on an overlay canvas: the game's renderer, scene and state are untouched (the game is paused while open).
// Plain three.js equivalent: a scene per asset, a camera fitted to its bounding sphere, renderer.setScissor per cell.
// three comes from the engine (engine.THREE): the same instance as the game's materials, whatever the tools package resolves
let THREE;

/** Light setups: [name, sun elevation in degrees or null, sun intensity, sun color, sky intensity]. Neutral: no style lives here */
export const LIGHTS = [
  ['midday', 65, 2.6, 0xffffff, 0.7],
  ['lowSun', 10, 2.2, 0xffe2c8, 0.45],   // a low sun is slightly warmer in nature; kept mild so it is a light test, not a grade
  ['overcast', null, 0, 0xffffff, 2.0],
];

/** Registered model and texture names (named manifest entries, built-in ones left out) */
export function assetNames(engine) {
  const out = { models: [], textures: [] };
  for (const [name, e] of engine.assets.entries) {
    if (!e.named || e.builtIn) continue;
    if (e.type === 'model') out.models.push(name); else if (e.type === 'texture') out.textures.push(name);
  }
  return out;
}

/** One asset as an Object3D centred on the ground at the origin, and the radius a camera has to fit */
async function stageOf(engine, type, name) {
  let obj;
  try {
    if (type === 'texture') {
      const t = await engine.assets.texture(name);
      obj = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
      obj.position.y = 1;
      const g = new THREE.Group(); g.add(obj); obj = g;
    } else obj = await engine.assets.model(name);
  } catch (err) { return { name, type, error: String(err?.message ?? err) }; }
  const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= box.min.y;
  const pivot = new THREE.Group(); pivot.add(obj);
  const r = Math.max(0.1, box.getBoundingSphere(new THREE.Sphere()).radius);
  return { name, type, pivot, radius: r, height: box.max.y - box.min.y };
}

/** A scene per light setup: the lights, a neutral ground disc; the asset pivot is moved in per draw */
function rigs() {
  return LIGHTS.map(([name, elev, sun, color, sky]) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(elev == null ? 0xb8bcc2 : elev < 20 ? 0x9aa4b2 : 0xaab8c8);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, sky));
    if (elev != null) {
      const d = new THREE.DirectionalLight(color, sun), a = THREE.MathUtils.degToRad(elev);
      d.position.set(Math.cos(a) * 10, Math.sin(a) * 10, Math.cos(a) * 6); d.castShadow = true;
      d.shadow.mapSize.set(1024, 1024); d.shadow.bias = -0.0001;   // bias is in shadow-camera depth units: keep it near 2-3 cm
      scene.add(d, d.target); scene.userData.sun = d;
    }
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground); scene.userData.ground = ground;
    return { name, scene };
  });
}

/** Put the asset into the rig scene, fit ground, shadow camera and the camera; yaw turns the asset */
function frame(rig, st, cam, yaw) {
  const { scene } = rig, r = st.radius;
  // one asset per rig scene at a time: the rigs are shared by every asset (and every grid cell), so the previous pivot leaves first,
  // or each picture would also show all assets drawn before it at the same origin
  if (scene.userData.pivot && scene.userData.pivot !== st.pivot) scene.remove(scene.userData.pivot);
  if (st.pivot.parent !== scene) scene.add(st.pivot);
  scene.userData.pivot = st.pivot;
  st.pivot.rotation.y = yaw;
  scene.userData.ground.scale.setScalar(r * 2.2);
  const sun = scene.userData.sun;
  if (sun) {
    const s = sun.shadow.camera; s.left = s.bottom = -r * 1.5; s.right = s.top = r * 1.5; s.near = 0.1; s.far = 40 + r * 4;
    sun.position.setLength(10 + r * 2); s.updateProjectionMatrix();
  }
  const dist = r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.05;
  cam.position.set(0, st.height * 0.5 + dist * 0.35, dist); cam.lookAt(0, st.height * 0.45, 0);
}

/** A renderer that matches the game's output (tone mapping, exposure, color space) */
function rendererLike(engine, canvas) {
  const R = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  const g = engine.renderer;
  R.toneMapping = g.toneMapping; R.toneMappingExposure = g.toneMappingExposure; R.outputColorSpace = g.outputColorSpace;
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  return R;
}

/** Review modes `threedog gallery --shots --mode` adds next to the light shots. silhouette: every model filled pure black on white, to read the
 *  outline alone; value: the midday shot as grayscale luminance, to see the light/dark structure without hue. They measure facts, never a verdict. */
export const MODES = ['silhouette', 'value'];

/** "--mode a,b" -> the list; throws on an unknown mode, or a mode without --shots (the live grid shows the light setups only) */
/** Options that only mean something with --shots, and a port that is a number: wrong ones stop with the fix instead of being ignored (like --mode). Returns the modes */
export function parseOptions(opt) {
  for (const k of ['size', 'only']) if (opt[k] != null && opt[k] !== false && !opt.shots) throw new Error(`--${k} works with --shots (it shapes the pictures written to disk; the live gallery has its own controls)`);
  if (opt.port != null && !/^\d+$/.test(String(opt.port))) throw new Error(`--port is a port number, e.g. --port 5181; got ${JSON.stringify(opt.port)}`);
  return parseModes(opt.mode, opt.shots);
}

/** One file stem per asset name: characters outside [\w.-] become _, and two names that end up alike ('a/b', 'a_b') get -2, -3 so no picture overwrites another */
export function fileStems(names) {
  const used = new Set(), out = new Map();
  for (const n of names) {
    if (out.has(n)) continue;
    const base = n.replace(/[^\w.-]+/g, '_');
    let stem = base;
    for (let i = 2; used.has(stem); i++) stem = `${base}-${i}`;
    used.add(stem); out.set(n, stem);
  }
  return out;
}

/** Text into HTML (asset names are the game's own strings: a name with < or & must not break the page) */
export const escapeHtml = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function parseModes(mode, shots) {
  if (mode == null || mode === false) return [];
  if (!shots) throw new Error('--mode works with --shots (it writes extra pictures; the live gallery shows the light setups only)');
  const list = String(mode).split(',').map(s => s.trim()).filter(Boolean);
  const bad = list.filter(m => !MODES.includes(m));
  if (bad.length || !list.length) throw new Error(`unknown --mode ${bad.join(',') || '(empty)'}; modes: ${MODES.join(', ')}`);
  return [...new Set(list)];
}

/**
 * Give every material under root a replacement and return the undo. Why swap and restore instead of scene.overrideMaterial: the replacement
 * keeps each material's side, alphaTest and alpha map (a cut-out leaf card stays a leaf, not a quad), and the asset may be a cached instance
 * the game also shows, so its own materials must come back untouched.
 * @param {any} root @param {(m: any) => any} make @returns {() => void}
 */
export function swapMaterials(root, make) {
  const saved = [];
  root.traverse(o => {
    if (!o.material) return;
    saved.push([o, o.material]);
    o.material = Array.isArray(o.material) ? o.material.map(make) : make(o.material);
  });
  return () => {
    for (const [o, m] of saved) {
      for (const tmp of Array.isArray(o.material) ? o.material : [o.material]) tmp.dispose?.();
      o.material = m;
    }
  };
}

const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];   // Rec. 709 weights on the output (display) values
const r2 = v => Math.round(v * 100) / 100;

/** Silhouette picture (RGBA, black on white) -> fill: share of the frame covered; boxFill: share of its own bounding box; aspect: width / height */
export function silhouetteFacts(data, w, h) {
  let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (luma(data, (y * w + x) * 4) >= 128) continue;
    n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!n) return { fill: 0, boxFill: 0, aspect: 0 };
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  return { fill: r2(n / (w * h)), boxFill: r2(n / (bw * bh)), aspect: r2(bw / bh) };
}

/** Luminance (0..1) percentiles p5 / p50 / p95 over the asset's pixels only (mask: a silhouette picture of the same framing; null = all pixels) */
export function valueFacts(data, mask) {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (mask && luma(mask, i) >= 128) continue;
    hist[Math.min(255, Math.round(luma(data, i)))]++; n++;
  }
  const at = q => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= q * n) return r2(v / 255); } return 1; };
  return n ? { p5: at(0.05), p50: at(0.5), p95: at(0.95) } : { p5: 0, p50: 0, p95: 0 };
}

/** The WebGL canvas as top-down RGBA bytes (a 2D canvas copy: gl.readPixels would be bottom-up) */
function readCanvas(canvas, size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0, size, size);
  return { c, g, img: g.getImageData(0, 0, size, size) };
}

/** Black on white in the midday rig's framing, ground hidden: the asset's materials swapped for unlit black ones (cut-outs kept), then restored */
function drawSilhouette(R, st, cam, rig, yaw) {
  frame(rig, st, cam, yaw);
  const { scene } = rig, bg = scene.background;
  scene.background = new THREE.Color(0xffffff); scene.userData.ground.visible = false;
  const undo = swapMaterials(st.pivot, m => new THREE.MeshBasicMaterial({ color: 0x000000, side: m.side, alphaTest: m.alphaTest ?? 0,
    map: m.alphaTest > 0 ? m.map ?? null : null, alphaMap: m.alphaMap ?? null }));
  try { R.render(scene, cam); } finally { undo(); scene.background = bg; scene.userData.ground.visible = true; }
}

/**
 * Still pictures for review: one PNG (data URL) per asset per light setup, the asset turned to a three-quarter view. Each mode in `modes`
 * adds one more picture per asset (`light` = the mode name) with its `facts`; silhouette is for models only (a texture's is its square).
 * @param {any} engine @param {{ size?: number, yaw?: number, only?: string[], modes?: string[] }} [o]
 * @returns {Promise<{ name: string, type: string, light: string, png?: string, error?: string, facts?: Record<string, number> }[]>}
 */
export async function shots(engine, { size = 256, yaw = -0.6, only = null, modes = [] } = {}) {
  THREE = engine.THREE;
  const { models, textures } = assetNames(engine), canvas = document.createElement('canvas');
  const R = rendererLike(engine, canvas); R.setPixelRatio(1); R.setSize(size, size, false);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 2000), all = rigs(), out = [];
  const midday = all.find(r => r.name === 'midday');
  for (const [type, names] of [['model', models], ['texture', textures]]) for (const name of names) {
    if (only && !only.includes(name)) continue;
    const st = await stageOf(engine, type, name);
    for (const rig of all) {
      if (st.error) { out.push({ name, type, light: rig.name, error: st.error }); continue; }
      frame(rig, st, cam, yaw); R.render(rig.scene, cam);
      out.push({ name, type, light: rig.name, png: canvas.toDataURL('image/png') });
    }
    if (st.error || !modes.length) continue;
    drawSilhouette(R, st, cam, midday, yaw);   // also the mask the value facts are measured inside
    const sil = readCanvas(canvas, size);
    if (modes.includes('silhouette') && type === 'model') {
      out.push({ name, type, light: 'silhouette', png: sil.c.toDataURL('image/png'), facts: silhouetteFacts(sil.img.data, size, size) });
    }
    if (modes.includes('value')) {
      frame(midday, st, cam, yaw); R.render(midday.scene, cam);
      const v = readCanvas(canvas, size), d = v.img.data, facts = valueFacts(d, sil.img.data);
      for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = Math.round(luma(d, i));
      v.g.putImageData(v.img, 0, 0);
      out.push({ name, type, light: 'value', png: v.c.toDataURL('image/png'), facts });
    }
  }
  R.dispose();
  return out;
}

/**
 * Open the gallery over a running engine: a scrolling grid, a row per asset, a turntable cell per light setup. Close returns to the game.
 * @param {any} engine @returns {Promise<{ close(): void }>}
 */
export async function openGallery(engine) {
  THREE = engine.THREE;
  const { models, textures } = assetNames(engine);
  const hold = engine.pause('gallery');   // the game stands still behind the overlay (its own pause owner: the game's pauses are untouched)
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2000;overflow:auto;background:#2a2c30;color:#eee;font:12px/1.4 sans-serif';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2001';
  const head = document.createElement('div');
  head.style.cssText = 'position:sticky;top:0;padding:8px 12px;background:#1d1f22;z-index:2002;display:flex;gap:12px;align-items:center';
  head.innerHTML = `<b>Asset gallery</b><span>${models.length} models · ${textures.length} textures · lights: ${LIGHTS.map(l => l[0]).join(' / ')} (neutral, lighting only)</span>`;
  const close = Object.assign(document.createElement('button'), { textContent: 'close' });
  head.appendChild(close); host.appendChild(head);
  const grid = document.createElement('div');
  grid.style.cssText = `display:grid;grid-template-columns:160px repeat(${LIGHTS.length}, minmax(160px, 1fr));gap:6px;padding:8px 12px`;
  host.appendChild(grid); document.body.append(host, canvas);
  const R = rendererLike(engine, canvas), cam = new THREE.PerspectiveCamera(30, 1, 0.05, 2000), all = rigs(), cells = [];
  for (const [type, names] of [['model', models], ['texture', textures]]) for (const name of names) {
    const label = document.createElement('div'); label.style.cssText = 'align-self:center;word-break:break-all';
    label.textContent = `${name} (${type})`; grid.appendChild(label);
    const st = await stageOf(engine, type, name);
    if (st.error) label.textContent += ' — failed: ' + st.error;
    for (const rig of all) {
      const el = document.createElement('div'); el.style.cssText = 'aspect-ratio:1;background:#000;position:relative';
      el.title = `${name} · ${rig.name}`; grid.appendChild(el);
      if (!st.error) cells.push({ el, st, rig });
    }
  }
  let raf = 0;
  const draw = t => {
    raf = requestAnimationFrame(draw);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) R.setSize(w, h, false);
    R.setScissorTest(false); R.clear(); R.setScissorTest(true);
    for (const { el, st, rig } of cells) {
      const b = el.getBoundingClientRect();
      if (b.bottom < 0 || b.top > h || b.right < 0 || b.left > w) continue;
      R.setViewport(b.left, h - b.bottom, b.width, b.height); R.setScissor(b.left, h - b.bottom, b.width, b.height);
      cam.aspect = b.width / b.height; cam.updateProjectionMatrix();
      frame(rig, st, cam, t * 0.0005); R.render(rig.scene, cam);
    }
  };
  raf = requestAnimationFrame(draw);
  const api = {
    close() { cancelAnimationFrame(raf); R.dispose(); host.remove(); canvas.remove(); hold.remove(); },
  };
  close.onclick = () => api.close();
  return api;
}

/**
 * What the vite preset's ?gallery=1 runs: waits for window.engine and its first state, then exposes the gallery on window.threedogGallery
 * (`threedog gallery --shots` calls shots() through it) and opens the grid unless the page is headless.
 */
export async function openWhenReady() {
  while (!globalThis.engine?.stateApplied) await new Promise(r => setTimeout(r, 100));
  const engine = globalThis.engine;
  globalThis.threedogGallery = { shots: o => shots(engine, o), names: () => assetNames(engine), open: () => openGallery(engine) };
  if (!/[?&]threedog-headless\b/.test(location.search)) await openGallery(engine);
}

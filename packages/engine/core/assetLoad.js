// File loading for engine.assets, split into the phases engine.loading reports: download -> decode -> upload.
// Each step names the failing file and HTTP status, and a glTF records what it references but could not load
// (a texture / .bin that 404s), so "the model looks gray" is traceable to one path instead of a bare "failed".
import { coded } from './errorHints.js';
import * as THREE from 'three';
import { restoreBaked, toGLB, fromGLTF } from './Baked.js';
import { warnOnce } from './validate.js';
import { makeMaterial } from '../render/materials.js';

const BASE = import.meta.env?.BASE_URL ?? '/';
const DEV_SERVER = !!import.meta.env?.DEV;   // only npm run dev serves the /__threedog/cache endpoint
const CACHE = '/__threedog/cache/';
const STALE = 'The generator code for "{name}" has changed, so it is built from code now; run npm run bake once it is final';
const NO_CACHE = '[cache] the dev server has no threedog model cache (a plain Vite server without the threedog plugin): code-generated models are built every time. Use the vite config of the game template (threedog gameConfig) to cache them';

// A dev / preview server answers a missing path with its index.html (status 200): treat an HTML answer for an asset as "not found"
const NOT_THERE = 'not found (404: the server sent an HTML page instead, so the file is not at this path)';
const isHtml = res => /text\/html/i.test(res.headers.get('content-type') || '');

/** Error with the failing URL and HTTP status (status 0 = network / CORS / not an HTTP failure) */
export class LoadError extends Error {
  /** @param {string} message @param {{ url: string, status?: number }} info */
  constructor(message, { url, status = 0 }) { super(message); this.url = url; this.status = status; }
}

/** Extensions a glTF file uses (reads only the JSON part, not the whole file) */
function gltfExtensions(buf) {
  const dv = new DataView(buf);
  let json;
  if (buf.byteLength >= 20 && dv.getUint32(0, true) === 0x46546c67) json = new TextDecoder().decode(new Uint8Array(buf, 20, dv.getUint32(12, true)));
  else json = new TextDecoder().decode(buf);
  try { return JSON.parse(json).extensionsUsed || []; } catch { return []; }
}

/** Download as ArrayBuffer, reporting progress when the server sends a length; records size and version headers on the task */
async function download(url, task) {
  task.phase('download', 0);
  const res = await fetch(url);
  if (!res.ok) throw new LoadError(`${res.status} ${res.statusText}`.trim(), { url, status: res.status });
  if (isHtml(res)) throw new LoadError(NOT_THERE, { url, status: 404 });
  const total = +(res.headers.get('content-length') || 0);
  task.source.version = res.headers.get('etag') || res.headers.get('last-modified') || null;
  let buf;
  if (total && res.body) {   // stream so a big model shows 0-100% instead of sitting at "downloading"
    const reader = res.body.getReader(), parts = [];
    let got = 0;
    for (let r; !(r = await reader.read()).done;) { parts.push(r.value); got += r.value.length; task.progress = Math.min(1, got / total); }
    const all = new Uint8Array(got);
    let at = 0; for (const p of parts) { all.set(p, at); at += p.length; }
    buf = all.buffer;
  } else buf = await res.arrayBuffer();
  task.source.bytes = buf.byteLength;
  return buf;
}

/** Upload textures to the GPU now, so the first frame that shows them does not stall (the 'upload' phase) */
function upload(assets, textures, task) {
  task.phase('upload');
  for (const t of textures) assets.engine.renderer.initTexture(t);
}

/** Download a glTF, set up the Draco / KTX2 decoder it needs, parse it and upload its textures. Returns the gltf */
export async function loadGltf(assets, url, task) {
  const buf = await download(url, task), used = gltfExtensions(buf);
  task.phase('decode');
  if (used.includes('KHR_draco_mesh_compression')) await decoder(assets, 'draco');
  if (used.includes('KHR_texture_basisu')) await decoder(assets, 'ktx2');
  // A per-file manager hears which referenced files (.bin, textures) failed; GLTFParser reads the manager when parse() starts,
  // so swapping it around the synchronous start of parseAsync scopes it to this file even with several loads in flight
  const mgr = new THREE.LoadingManager(), missing = task.missing;
  mgr.onError = ref => { if (!missing.includes(ref)) missing.push(ref); };
  const prev = assets.gltf.manager;
  assets.gltf.manager = mgr;
  const parsing = assets.gltf.parseAsync(buf, THREE.LoaderUtils.extractUrlBase(url));
  assets.gltf.manager = prev;
  let gltf;
  try { gltf = restoreBaked(await parsing, assets.engine); }   // baked file: restore materials etc.
  catch (err) { throw new LoadError(String(err?.message ?? err) + (missing.length ? ` (missing: ${missing.join(', ')})` : ''), { url: missing[0] ?? url }); }
  task.source.animations = gltf.animations.map(a => a.name);
  const tex = new Set();
  gltf.scene.traverse(o => { for (const m of [].concat(o.material || [])) for (const k in m) if (m[k]?.isTexture) tex.add(m[k]); });
  upload(assets, tex, task);
  return gltf;
}

/** Load a texture (.ktx2 through KTX2Loader, .hdr through HDRLoader), apply the entry's options and upload it */
export async function loadTexture(assets, e, task) {
  task.phase('download');
  const ktx = /\.ktx2(\?|$)|^data:image\/ktx2/i.test(e.url);
  const hdr = /\.hdr(\?|$)/i.test(e.url);   // Radiance HDR (environment lighting): float data in linear color
  let t;
  try {
    if (ktx) t = await (await decoder(assets, 'ktx2')).loadAsync(e.url);
    else if (hdr) t = await new (await import('three/addons/loaders/HDRLoader.js')).HDRLoader().loadAsync(e.url);
    else t = await assets.tex.loadAsync(e.url);
  }
  catch (err) {
    // an <img> error carries no status: ask the server once so the report says 404 vs a broken file
    const status = await fetch(e.url, { method: 'HEAD' }).then(r => (!r.ok ? r.status : isHtml(r) ? 404 : 0), () => 0);
    throw new LoadError(status === 404 ? NOT_THERE : status ? `HTTP ${status}` : String(err?.message ?? 'not a decodable image'), { url: e.url, status });
  }
  if (e.opts.color === false) t.colorSpace = THREE.NoColorSpace;
  else if (!t.isCompressedTexture && !hdr) t.colorSpace = THREE.SRGBColorSpace;   // KTX2 carries its own color space
  t.anisotropy = assets.engine.renderer.capabilities.getMaxAnisotropy();
  if (e.opts.pixelated) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapNearestFilter; }
  if (e.opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(e.opts.repeat[0], e.opts.repeat[1]); }
  upload(assets, [t], task);
  return t;
}

/** Import and create DRACOLoader / KTX2Loader on first use. Decoders default to the ones shipped with three (vite bundles them); if engine.decoders is set, download from there */
function decoder(assets, kind) {
  return assets._loaders[kind] ||= (async () => {
    const dir = assets.engine.decoders;
    if (kind === 'draco') {
      const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
      assets.draco = new DRACOLoader();
      if (dir) assets.draco.setDecoderPath(dir + 'draco/');
      assets.gltf.setDRACOLoader(assets.draco);
      return assets.draco;
    }
    const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
    assets.ktx2 = new KTX2Loader().detectSupport(assets.engine.renderer);
    if (dir) assets.ktx2.setTranscoderPath(dir + 'basis/');
    assets.gltf.setKTX2Loader(assets.ktx2);
    return assets.ktx2;
  })();
}

/** FontFace descriptors an asset pack's fonts entry may carry (everything else on the entry is the asset's own: url, family, critical...) */
const FONT_DESCRIPTORS = ['weight', 'style', 'stretch', 'unicodeRange', 'display', 'featureSettings', 'variationSettings'];
/**
 * Download a font file and add it to document.fonts as a FontFace (family = entry.family, else the asset name). Downloaded with fetch
 * (not the FontFace url source) so a 404 reports its HTTP status like any other asset; the face is decoded before it is added, so a
 * broken file fails here instead of silently falling back to the system font. Returns the FontFace
 */
export async function loadFont(assets, e, task) {
  const family = e.opts.family ?? e.name;
  if (typeof family !== 'string' || /["'();\\<>]/.test(family))
    throw new LoadError(`font family ${JSON.stringify(family)} must be a plain name without quotes, brackets, ';' or '\\', e.g. family: 'PixelFont'`, { url: e.url });
  const buf = await download(e.url, task);
  task.phase('decode');
  const desc = Object.fromEntries(FONT_DESCRIPTORS.filter(k => e.opts[k] != null).map(k => [k, String(e.opts[k])]));
  const face = new FontFace(family, buf, { display: 'swap', ...desc });
  try { await face.load(); } catch (err) { throw new LoadError(`not a font the browser can read (${err.message})`, { url: e.url }); }
  document.fonts.add(face);
  return face;
}

/** Stand-ins for a degradable asset that failed: neutral gray (hard rule 1: the engine has no art of its own) */
export function placeholder(type, engine) {
  if (type === 'texture') { const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); t.needsUpdate = true; return t; }
  if (type === 'model') {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), makeMaterial('default', {}, engine)));
    g.name = 'placeholder';
    return { scene: g, animations: [] };
  }
  return null;   // sound: silence; font: the next family in style.ui.font (the system font)
}

/** Code-generated model: baked file -> dev cache -> build now (see Assets.cached); returns { scene, animations, geometry? } */
export async function generated(assets, name, build, params, task) {
  const wrap = v => v.isBufferGeometry
    ? { geometry: v, scene: new THREE.Mesh(v, makeMaterial('default', { vertexColors: !!v.attributes.color }, assets.engine)), animations: [] }
    : { scene: v, animations: v.animations ?? [] };
  const same = JSON.stringify(params ?? null);
  const ctx = { palette: assets.engine.style.palette, engine: assets.engine };   // a function() generator reads this.palette (style.palette)
  const baked = (await bakedIndex(assets))[name];
  const bakedOk = baked && JSON.stringify(baked.params ?? null) === same;
  const file = async url => wrap(fromGLTF(await loadGltf(assets, url, task)));
  if (!DEV_SERVER) return bakedOk ? file(BASE + 'models/baked/' + baked.file) : wrap(await build.call(ctx, params));
  // In dev: ask the dev server for the current hash of this generator (with its file and imports)
  // a plain Vite dev server without threedog's plugin answers with index.html: no cache then, build now (said once)
  const info = await fetch(CACHE + 'key', { method: 'POST', body: JSON.stringify({ name, src: String(build), params: ctx.palette ? [params ?? null, ctx.palette] : params ?? null }) }).then(r => r.json()).catch(() => null);
  if (!info) { warnOnce(coded('asset-cache', NO_CACHE)); return bakedOk ? file(BASE + 'models/baked/' + baked.file) : wrap(await build.call(ctx, params)); }
  if (bakedOk) {
    if (baked.source === 'file' || baked.key === info.key) return file(BASE + 'models/baked/' + baked.file);
    warnOnce(coded('asset-cache', STALE.replace('{name}', name)));
  }
  if (info.hit) return file(CACHE + info.key + '.glb');
  const t0 = performance.now(), v = await build.call(ctx, params);   // measure：build time
  if (performance.now() - t0 >= assets.cacheMinMs)   // measure
    toGLB(v, assets.engine).then(buf => fetch(CACHE + info.key + '.glb', { method: 'PUT', body: buf })).catch(err => warnOnce(coded('asset-cache', '[cache] could not store a built model in .threedog/cache (' + err.message + '); it is built again next time')));
  return wrap(v);
}
/** Bake manifest public/models/baked/index.json (empty if missing) */
function bakedIndex(assets) {
  return assets._baked ||= fetch(BASE + 'models/baked/index.json').then(r => (r.ok ? r.text() : '{}')).then(t => { try { return JSON.parse(t); } catch { return {}; } }, () => ({}));
}

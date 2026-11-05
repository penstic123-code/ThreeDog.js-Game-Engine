// The one card every library entry carries, so pieces from different places can be judged together before they are put together:
//   needs    { modules, entries, packages, signals }   what must be there (modules: the engine's `requires` names; signals: engine.uniforms it reads)
//   provides { modules, exports, signals }             what it gives (modules: the engine's `name` / `provides`)
//   writes   ['scene.fog', 'light.sun', ...]           the shared three.js values it sets: two writers of one value fight each frame
//   size     model { box, up, origin } · texture { pixels, map, colorSpace } · null for code. 1 unit = 1 meter
//   style    { tags, colors }                          tags come from the person (--style); colors are measured
//   usage    up to 10 lines of how to use it           the file's own header comment plus the use line, or --usage
// Beside the card an entry says its backends: 'webgl' = WebGLRenderer, 'webgpu' = WebGPURenderer on either of its backends (a node material draws on its WebGL2
//   fallback too, GLSL does not). backendsOf reads them from the code.
// Why it is read from the files and not asked for: an AI skips a form, and the same scan must run again on a game's edited copy (lib check), where
//   it tells what the code does now, not what the library entry said when it was stored.
// Why plain regular expressions: an entry is one person's readable three.js, not arbitrary code. A value set through a helper is not seen; the card
//   is a warning light, not a proof. Edit entry.json to add what the scan cannot see.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const CODE = /\.m?js$/, MODEL = /\.(glb|gltf)$/i, TEXTURE = /\.(png|jpe?g|webp|avif|gif|ktx2|basis|hdr|exr)$/i;
/** File names that hold numbers, not colors: decoding them as sRGB shifts every value */
const DATA_MAP = /(^|[-_. ])(normal|nrm|nor|rough(ness)?|metal(lic|ness)?|ao|occlusion|height|disp(lacement)?|bump|orm|arm|mask)([-_. ]|$)/i;
/** Code only WebGLRenderer can run (WebGPURenderer stops at it by name), and code only WebGPURenderer can run: node materials and TSL */
const GLSL_ONLY = /\b(?:ShaderMaterial|RawShaderMaterial|onBeforeCompile|customProgramCacheKey|gl_FragColor|WebGLRenderTarget|EffectComposer|ShaderPass)\b|\bglsl\b/;
const NODE_ONLY = /\b\w*NodeMaterial\b|\bwgsl\b|\bStorageBufferAttribute\b|\brenderer\.compute\b|['"](?:three\/tsl|three\/webgpu|threedog\/tsl)['"]/;
export const noComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const uniq = l => [...new Set(l)].sort();
const quoted = s => [...s.matchAll(/['"]([\w.-]+)['"]/g)].map(m => m[1]);
const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');

/** The JSON of a .glb or .gltf file, or null when it is not one */
function gltfJson(path) {
  const b = readFileSync(path);
  if (/\.gltf$/i.test(path)) { try { return JSON.parse(b.toString('utf8')); } catch { return null; } }
  if (b.length < 20 || b.readUInt32LE(0) !== 0x46546C67) return null;
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}

// column-major 4x4, as glTF stores it
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function localMatrix(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}

/** Bounding box of a glTF scene in meters from the accessors' min / max and the node transforms, no geometry read. { min, max } or null */
function boundsOf(j) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const visit = (i, parent) => {
    const n = j.nodes[i], m = mul(parent, localMatrix(n));
    for (const p of n.mesh !== undefined ? j.meshes[n.mesh].primitives : []) {
      const a = j.accessors[p.attributes?.POSITION];
      if (!a?.min || !a?.max) continue;
      for (let c = 0; c < 8; c++) {
        const v = [c & 1 ? a.max[0] : a.min[0], c & 2 ? a.max[1] : a.min[1], c & 4 ? a.max[2] : a.min[2]];
        for (let k = 0; k < 3; k++) { const w = m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k]; min[k] = Math.min(min[k], w); max[k] = Math.max(max[k], w); }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const i of j.scenes?.[j.scene ?? 0]?.nodes ?? []) visit(i, I);
  return min[0] === Infinity ? null : { min, max };
}

/** A model's size: box in meters; up 'y' as glTF says, 'z' when it looks stood on its side; origin 'feet', 'center' or 'other'. Plus its colors */
export function measureModel(path) {
  const j = gltfJson(path), r = j && boundsOf(j);
  if (!r) return null;
  const box = r.max.map((v, i) => +(v - r.min[i]).toFixed(3)), [x, y, z] = box, long = Math.max(x, z), thin = Math.min(x, z);
  // long and thin on the ground with hardly any height: a standing thing laid flat (a car is not this thin, a rug is not this long)
  const up = long > 3 * y && long > 2 * thin ? 'z' : 'y';
  const near = (a, b) => Math.abs(a - b) <= 0.05 * Math.max(...box);
  const mid = r.min.map((v, i) => (v + r.max[i]) / 2);
  const origin = near(r.min[1], 0) && near(mid[0], 0) && near(mid[2], 0) ? 'feet' : mid.every(v => near(v, 0)) ? 'center' : 'other';
  const colors = uniq((j.materials ?? []).map(m => m.pbrMetallicRoughness?.baseColorFactor).filter(Boolean).map(c => hex(...c.slice(0, 3).map(v => v ** (1 / 2.2))))).slice(0, 5);
  return { size: { box, up, origin }, colors };
}

/** A texture's size: pixels (png, jpeg; null otherwise), map 'color' or 'data', colorSpace 'srgb' or 'linear' */
export function measureTexture(path) {
  const b = readFileSync(path), name = basename(path).replace(/\.[^.]+$/, '');
  let pixels = null, tagged = false;
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504E47) {
    pixels = [b.readUInt32BE(16), b.readUInt32BE(20)];
    for (let i = 8; i + 8 <= b.length;) { const t = b.toString('latin1', i + 4, i + 8); if (t === 'IDAT') break; if (t === 'sRGB') tagged = true; i += 12 + b.readUInt32BE(i); }
  } else if (b[0] === 0xFF && b[1] === 0xD8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xFF) break;
      if (b[i + 1] >= 0xC0 && b[i + 1] <= 0xC2) { pixels = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; break; }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  const map = DATA_MAP.test(name) ? 'data' : 'color', linear = map === 'data' || /\.(hdr|exr)$/i.test(path);
  return { pixels, map, colorSpace: linear ? 'linear' : 'srgb', ...(map === 'data' && tagged ? { taggedSrgb: true } : {}) };
}

/** What the code shows, comments left out */
function readCode(text) {
  const t = noComments(text), all = (re, i = 1) => [...t.matchAll(re)].map(m => m[i]);
  const list = key => [...t.matchAll(new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`, 'g'))].flatMap(m => quoted(m[1]));
  const set = /^\.value\s*(?:=(?!=)|\.(?:set|copy)\()/;   // right after the name: a write later on the line is about something else
  const signals = [...t.matchAll(/\b(?:signals|engine\.uniforms)\.(u[A-Z]\w*)([^\n;]*)/g)];
  const lights = { 'light.sun': /new\s+(?:THREE\.)?DirectionalLight\b/, 'light.ambient': /new\s+(?:THREE\.)?(?:Ambient|Hemisphere)Light\b/ };
  return {
    needs: list('requires'),
    signals: signals.filter(m => !set.test(m[2])).map(m => m[1]),
    gives: [...(/\binstall\s*\(/.test(t) ? all(/\bname\s*:\s*['"]([\w.-]+)['"]/g) : []), ...list('provides')],
    givesSignals: signals.filter(m => set.test(m[2])).map(m => m[1]),
    writes: [...all(/\bscene\.(fog|background|environment|overrideMaterial)\s*=(?!=)/g).map(v => 'scene.' + v), ...all(/\brenderer\.(toneMapping|toneMappingExposure|outputColorSpace)\s*=(?!=)/g).map(v => 'renderer.' + v),
      ...Object.entries(lights).filter(([, re]) => re.test(t)).map(([k]) => k)],
    exports: all(/export\s+(?:async\s+)?(?:function\s*\*?|const|class)\s+([A-Za-z_$][\w$]*)/g),
    colors: [...all(/\b0x([0-9a-fA-F]{6})\b/g), ...all(/['"]#([0-9a-fA-F]{6})['"]/g)].map(c => '#' + c.toLowerCase()),
  };
}

/**
 * The renderers a set of files can draw on, read from the code: one name when only that renderer's code shows, both when neither shows (plain three.js, a model, a
 * texture) and when both show (code that branches on the renderer). One scan for lib add and lib check, so a game that ports its copy passes the test the entry failed.
 * @param {string[]} files absolute paths @returns {('webgl' | 'webgpu')[]}
 */
export function backendsOf(files) {
  const text = files.filter(f => CODE.test(f)).map(f => noComments(readFileSync(f, 'utf8'))).join('\n');
  const gl = files.some(f => f.endsWith('.glsl')) || GLSL_ONLY.test(text), node = NODE_ONLY.test(text);
  return gl && !node ? ['webgl'] : node && !gl ? ['webgpu'] : ['webgl', 'webgpu'];
}

/** The first comment block of a file, without its markers (the "how to use me" an entry already has) */
function headerOf(text) {
  const lines = [];
  for (const l of text.split(/\r?\n/)) { const m = /^\s*\/\/ ?(.*)$/.exec(l); if (!m) break; lines.push(m[1]); }
  return lines;
}

/**
 * The card of a set of files.
 * @param {string[]} files absolute paths @param {{ packages?: string[], entries?: string[], tags?: string[], usage?: string, use?: string, plug?: string, summary?: string }} [o]
 *   packages: package imports found by the copy; entries: other entries it needs; tags, usage: given by the person; use, plug, summary: what the entry already says
 */
export function cardOf(files, { packages = [], entries = [], tags = [], usage, use, plug, summary } = {}) {
  const code = files.filter(f => CODE.test(f)).map(f => readCode(readFileSync(f, 'utf8'))), of = k => uniq(code.flatMap(c => c[k]));
  const models = files.filter(f => MODEL.test(f)).map(measureModel).filter(Boolean), textures = files.filter(f => TEXTURE.test(f)).map(measureTexture);
  const counts = new Map();
  for (const c of [...code.flatMap(x => x.colors), ...models.flatMap(m => m.colors)]) counts.set(c, (counts.get(c) ?? 0) + 1);
  const colors = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
  const first = files.find(f => CODE.test(f)), header = first ? headerOf(readFileSync(first, 'utf8')) : [];
  const lines = [...(header.length ? header : summary ? [summary] : []).slice(0, 8), ...(use ? [use] : []), ...(plug ? plug.trim().split('\n') : [])].slice(0, 10);
  return {
    needs: { modules: of('needs'), entries: uniq(entries), packages: uniq(packages.filter(p => p !== 'three' && p !== 'threedog')), signals: of('signals') },
    provides: { modules: of('gives'), exports: of('exports'), signals: of('givesSignals') },
    writes: of('writes'),
    size: models[0]?.size ?? textures[0] ?? null,
    style: { tags: uniq(tags), colors },
    usage: usage ?? lines.join('\n'),
  };
}

/** What is wrong with one size, each line with the fix. A person may mean it: these are notes, never refusals */
export function sizeNotes(name, size) {
  const out = [];
  if (size?.box) {
    const long = Math.max(...size.box);
    if (long > 200) out.push(`${name} is ${long} m long: 1 unit = 1 meter, so it was probably exported in centimeters (scale it 0.01 at export)`);
    if (long < 0.02) out.push(`${name} is ${long} m long: 1 unit = 1 meter, so it was probably exported in another unit (fix the scale at export)`);
    if (size.up === 'z') out.push(`${name} looks laid on its side (${size.box.join(' x ')} m, long and low): export it with Y up`);
    if (size.origin === 'other') out.push(`${name} has its origin away from its feet and center: move the origin at export, or it lands offset`);
  }
  if (size?.taggedSrgb) out.push(`${name} holds numbers but its file says sRGB: leave texture.colorSpace at THREE.NoColorSpace, or it reads wrong`);
  return out;
}

/** A card as a few text lines for `lib list --card` and lib add */
export function cardLines(c) {
  const join = l => l?.length ? l.join(', ') : 'nothing';
  const size = c.size?.box ? `${c.size.box.join(' x ')} m, ${c.size.up} up, origin ${c.size.origin}` : c.size?.map ? `${c.size.pixels?.join(' x ') ?? 'unknown'} px, ${c.size.map} map, ${c.size.colorSpace}` : 'not a sized thing';
  return [`needs: modules ${join(c.needs?.modules)} · entries ${join(c.needs?.entries)} · packages ${join(c.needs?.packages)} · signals ${join(c.needs?.signals)}`,
    `provides: modules ${join(c.provides?.modules)} · exports ${join(c.provides?.exports)} · signals ${join(c.provides?.signals)}`,
    `writes: ${join(c.writes)}`, `size: ${size}`, `style: ${c.style?.tags?.length ? c.style.tags.join(', ') : 'no tags'}${c.style?.colors?.length ? ` · colors ${c.style.colors.join(' ')}` : ''}`,
    ...(c.usage ? ['usage:', ...c.usage.split('\n').map(l => '  ' + l)] : [])];
}

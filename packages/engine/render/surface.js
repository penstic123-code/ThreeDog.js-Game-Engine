// Surface keys of a material spec (used by makeMaterial): texture names (`map: 'rock.png'`), `detail`, `lighting`.
// Textures load through engine.assets.texture by name; a neutral stand-in sits in the slot until the image arrives, so nothing flashes.
import * as THREE from 'three';
import { closest, warnOnce } from '../core/validate.js';
import { placeholderTexture, EFFECTS } from './effects.js';
import { detailPatch } from './detail.js';
import { lightingPatch } from './lighting.js';
import { patchMaterial } from './patches.js';
import { surfaceDetail } from './lookSurface.js';
import { CODE_TEXTURES } from '../core/assetLoad.js';
import { codedError } from '../core/errorHints.js';

// Color textures are sRGB; the rest hold data and stay linear (three would otherwise gamma-decode normals and roughness)
const COLOR_SLOTS = ['map', 'emissiveMap', 'lightMap', 'sheenColorMap', 'specularColorMap'];
const DATA_SLOTS = ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'alphaMap', 'displacementMap', 'specularMap', 'clearcoatMap',
  'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenRoughnessMap', 'specularIntensityMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap', 'anisotropyMap'];
const TEXTURE_SLOTS = [...COLOR_SLOTS, ...DATA_SLOTS];
const WRAPS = { repeat: THREE.RepeatWrapping, clamp: THREE.ClampToEdgeWrapping, mirror: THREE.MirroredRepeatWrapping };
const SURFACE_KEYS = ['repeat', 'wrap', 'detail', 'lighting'];

// 1x1 stand-in with no effect on the look: a flat normal for normalMap, white for everything else (gray would dim color and roughness)
function standIn(slot) {
  if (slot === 'normalMap') return placeholderTexture('normal');
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true;
  return t;
}

const COLOR_SPACES = { srgb: THREE.SRGBColorSpace, linear: THREE.LinearSRGBColorSpace, none: THREE.NoColorSpace };
const SLOT_KEYS = ['texture', 'channel', 'repeat', 'wrap', 'colorSpace'];

// Only what the spec wrote changes a texture, on a copy (the image stays shared, the settings belong to this material): a texture you made
// keeps its own repeat / wrap / offset / colorSpace. A file loaded by name also gets wrap 'repeat' by default, so `repeat: 4` tiles it.
function shaped(t, o, file) {
  const wrap = o.wrap ?? (file ? 'repeat' : null);
  if (!wrap && !o.repeat && o.channel == null && !o.colorSpace) return t;
  const own = t.clone();
  if (wrap) own.wrapS = own.wrapT = WRAPS[wrap];
  if (o.repeat) own.repeat.set(o.repeat[0], o.repeat[1]);
  if (o.channel != null) own.channel = o.channel;
  if (o.colorSpace) own.colorSpace = COLOR_SPACES[o.colorSpace];
  own.needsUpdate = true;
  return own;
}

function loadSlot(m, slot, name, o, where, engine) {
  if (!engine?.assets) throw codedError('material-option', `${where}.${slot}: '${name}' is an asset name but no engine is known; pass the engine (makeMaterial(role, params, engine)) or give a THREE.Texture`);
  const stand = standIn(slot);
  m[slot] = stand;
  engine.assets.texture(name, COLOR_SLOTS.includes(slot) ? {} : { color: false }).then(t => {
    m[slot] = shaped(t, o, !CODE_TEXTURES.has(t)); stand.dispose();
  }).catch(err => warnOnce(`${where}.${slot}: texture '${name}' did not load (${err.message}). Register it (engine.assets.manifest({ textures: { name: 'file.png' } })) or write its URL`));
}

// One texture slot's value: a name, a THREE.Texture, or { texture: name | Texture, channel, repeat, wrap, colorSpace } (per-slot settings win
// over the spec-wide repeat / wrap). channel picks the uv set: aoMap / lightMap on a second uv (uv1) is { texture: 'ao', channel: 1 }
function slotValue(m, k, v, tex, where, engine) {
  let o = { repeat: tex.repeat, wrap: tex.wrap }, src = v;
  if (v && typeof v === 'object' && !v.isTexture) {
    for (const key of Object.keys(v)) if (!SLOT_KEYS.includes(key)) throw codedError('material-option', `${where}.${k}.${key} is not a texture setting; use ${SLOT_KEYS.join(', ')}. Example: ${k}: { texture: 'ao', channel: 1 }`);
    if (v.wrap != null && !WRAPS[v.wrap]) throw codedError('material-option', `${where}.${k}.wrap '${v.wrap}' must be ${Object.keys(WRAPS).join(' | ')}`);
    if (v.colorSpace != null && !COLOR_SPACES[v.colorSpace]) throw codedError('material-option', `${where}.${k}.colorSpace '${v.colorSpace}' must be ${Object.keys(COLOR_SPACES).join(' | ')}`);
    if (v.channel != null && !(Number.isInteger(v.channel) && v.channel >= 0 && v.channel <= 3)) throw codedError('material-option', `${where}.${k}.channel must be 0-3 (the uv set: 1 = uv1), got ${v.channel}`);
    const rep = v.repeat == null ? o.repeat : typeof v.repeat === 'number' ? [v.repeat, v.repeat] : v.repeat;
    o = { repeat: rep, wrap: v.wrap ?? o.wrap, channel: v.channel, colorSpace: v.colorSpace };
    src = v.texture;
  }
  if (src?.isTexture) m[k] = shaped(src, o, false);
  else if (typeof src === 'string') loadSlot(m, k, src, o, where, engine);
  else throw codedError('material-option', `${where}.${k} must be a texture name, a THREE.Texture or { texture, channel, repeat, wrap, colorSpace }; got ${String(src)}`);
}

/**
 * Handle the surface keys of a material spec: asset names in texture slots are loaded and assigned, `repeat` / `wrap` shape them,
 * `detail` / `lighting` add the named patches. Returns the properties left for makeMaterial to assign as they are.
 * @internal
 * @param {any} m the new material
 * @param {Record<string, any>} props the spec's properties without type / steps
 * @param {string} where e.g. 'style.materials.rock', for errors
 * @param {any} engine
 * @param {any} [lit] style.lighting (the pack's default for every lit material)
 */
export function applySurface(m, props, where, engine, lit) {
  const rest = {}, tex = { repeat: null, wrap: null };   // wrap null: files default to 'repeat', your own textures keep theirs (shaped)
  if (props.repeat != null) tex.repeat = typeof props.repeat === 'number' ? [props.repeat, props.repeat] : props.repeat;
  if (props.wrap != null) {
    if (!WRAPS[props.wrap]) throw codedError('material-option', `${where}.wrap '${props.wrap}' must be ${Object.keys(WRAPS).join(' | ')}`);
    tex.wrap = props.wrap;
  }
  for (const k in props) {
    if (SURFACE_KEYS.includes(k)) continue;
    const v = props[k];
    const slotLike = typeof v === 'string' || v?.isTexture || (v && typeof v === 'object' && 'texture' in v);
    if (slotLike && /map$/i.test(k)) {
      if (!TEXTURE_SLOTS.includes(k)) throw codedError('material-option', `${where}.${k} is not a texture slot${closest(k, TEXTURE_SLOTS) ? `; did you mean '${closest(k, TEXTURE_SLOTS)}'?` : ''} (slots: ${TEXTURE_SLOTS.join(', ')})`);
      if (!(k in m)) { warnOnce(`${where}.${k}: a '${m.type}' material has no ${k}; use type 'standard' (or 'physical' for clearcoat / sheen maps)`); continue; }
      slotValue(m, k, v, tex, where, engine);
    } else rest[k] = v;
  }
  const det = props.detail === false ? null : props.detail ?? surfaceDetail(engine);   // look.surface.detail is the pack-wide default
  if (det) patchMaterial(m, [EFFECTS.world(), detailPatch(det, engine, `${where}.detail`)]);
  const l = props.lighting === false ? null : { ...lit, ...props.lighting };
  if (l && Object.keys(l).length) patchMaterial(m, [lightingPatch(l, `${where}.lighting`)]);
  return rest;
}

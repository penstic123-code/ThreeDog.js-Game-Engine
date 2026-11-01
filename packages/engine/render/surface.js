// Surface keys of a material spec (used by makeMaterial): texture names (`map: 'rock.png'`), `detail`, `lighting`.
// Textures load through engine.assets.texture by name; a neutral stand-in sits in the slot until the image arrives, so nothing flashes.
import * as THREE from 'three';
import { closest, warnOnce } from '../core/validate.js';
import { placeholderTexture, EFFECTS } from './effects.js';
import { detailPatch } from './detail.js';
import { lightingPatch } from './lighting.js';
import { patchMaterial } from './patches.js';

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

function loadSlot(m, slot, name, { repeat, wrap }, where, engine) {
  if (!engine?.assets) throw new Error(`${where}.${slot}: '${name}' is an asset name but no engine is known; pass the engine (makeMaterial(role, params, engine)) or give a THREE.Texture`);
  const stand = standIn(slot);
  m[slot] = stand;
  engine.assets.texture(name, COLOR_SLOTS.includes(slot) ? {} : { color: false }).then(t => {
    const own = t.clone();   // the loaded image is shared; wrapping and repeat belong to this material
    own.wrapS = own.wrapT = WRAPS[wrap]; if (repeat) own.repeat.set(repeat[0], repeat[1]);
    own.needsUpdate = true;
    m[slot] = own; stand.dispose();
  }).catch(err => warnOnce(`${where}.${slot}: texture '${name}' did not load (${err.message}). Register it (engine.assets.manifest({ textures: { name: 'file.png' } })) or write its URL`));
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
  const rest = {}, tex = { repeat: null, wrap: 'repeat' };
  if (props.repeat != null) tex.repeat = typeof props.repeat === 'number' ? [props.repeat, props.repeat] : props.repeat;
  if (props.wrap != null) {
    if (!WRAPS[props.wrap]) throw new Error(`${where}.wrap '${props.wrap}' must be ${Object.keys(WRAPS).join(' | ')}`);
    tex.wrap = props.wrap;
  }
  for (const k in props) {
    if (SURFACE_KEYS.includes(k)) continue;
    const v = props[k];
    if (typeof v === 'string' && /map$/i.test(k)) {
      if (!TEXTURE_SLOTS.includes(k)) throw new Error(`${where}.${k} is not a texture slot${closest(k, TEXTURE_SLOTS) ? `; did you mean '${closest(k, TEXTURE_SLOTS)}'?` : ''} (slots: ${TEXTURE_SLOTS.join(', ')})`);
      if (!(k in m)) { warnOnce(`${where}.${k}: a '${m.type}' material has no ${k}; use type 'standard' (or 'physical' for clearcoat / sheen maps)`); continue; }
      loadSlot(m, k, v, tex, where, engine);
    } else rest[k] = v;
  }
  if (props.detail) patchMaterial(m, [EFFECTS.world(), detailPatch(props.detail, engine, `${where}.detail`)]);
  const l = props.lighting === false ? null : { ...lit, ...props.lighting };
  if (l && Object.keys(l).length) patchMaterial(m, [lightingPatch(l, `${where}.lighting`)]);
  return rest;
}

// Code-generated model <-> GLB file (shared by the auto-cache and npm run bake).
//   toGLB(object or geometry)  -> ArrayBuffer: uses three's GLTFExporter; names and userData (marker params) are kept as-is
//   fromGLTF(gltf)             -> object or geometry: restores the shadow flags, visibility and materials recorded at export
// What glTF cannot record goes in userData (glTF extras):
//   object userData.threedog = { cast, receive, hidden }; material userData.threedogMat = material JSON (no textures).
// Every material is rebuilt as-is from the recorded type and params (a MeshLambertMaterial stays Lambert, not glTF's default Standard); one the engine
// made (neutralMaterial, userData.purpose) comes back engine-made.
// Not recorded: onBeforeCompile (own shader patches and applyEffects patches), lightMap / specularMap / envMap and a
// toon gradientMap (glTF has no slot for them: toGLB warns once naming the model and the slots),
// ShaderMaterial texture uniforms and the identity of uniform objects (code holding a uniform reference stops driving the copy). Such a model's
// manifest entry takes cache: false, or the material is made at use time.
import * as THREE from 'three';
import { neutralMaterial } from '../../render/neutral.js';
import { markEngineMade } from '../../render/patches.js';
import { warnOnce, fmt } from '../base/validate.js';

const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'lightMap', 'specularMap', 'envMap', 'gradientMap', 'displacementMap'];
// Slots glTF has no place for (the exporter drops them)
const LOST_SLOTS = ['lightMap', 'specularMap', 'gradientMap', 'envMap'];
const LOST = "[bake] '{name}': {list} cannot be stored in the cached / baked GLB and would come back missing. " +
  "Keep this model out of the cache: assets.manifest({ models: { {name}: { build, cache: false } } }), or set {first} after loading";

/** Texture slots of m the GLB loses (toon ramp, lightMap, specularMap, envMap); [] when nothing is lost @param {any} m */
function lostSlots(m) { return LOST_SLOTS.filter(k => m[k]?.isTexture); }

/**
 * Object (or geometry) -> GLB. Marks are written on a copy; the original is untouched.
 * @returns {Promise<ArrayBuffer>}
 */
export async function toGLB(value, name = 'model') {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const geo = value.isBufferGeometry;
  const root = geo ? new THREE.Mesh(value, neutralMaterial('default', { vertexColors: !!value.attributes.color })) : value.clone();
  if (geo) root.userData.threedogGeometry = true;
  const mats = new Map(), lost = new Set();
  root.traverse(o => { for (const m of [].concat(o.material ?? [])) for (const k of lostSlots(m)) lost.add(k); });
  // said before the file is written, once per model and list: the copy read back next run would silently lack them
  if (lost.size) warnOnce(fmt(LOST, { name, list: [...lost].join(', '), first: [...lost][0] }));
  // Export with glTF's standard material (color, textures, vertex colors); the original type and params go in userData.threedogMat and are rebuilt as-is on read-back
  const tag = m => {
    if (!mats.has(m)) {
      const j = m.toJSON();
      for (const k of ['textures', 'images', 'uuid', 'metadata', 'userData', ...TEX_KEYS]) delete j[k];
      const c = new THREE.MaterialLoader().parse({ type: 'MeshStandardMaterial', name: m.name, color: m.color?.getHex() ?? 0xffffff, vertexColors: m.vertexColors,
        transparent: m.transparent, opacity: m.opacity, side: m.side, roughness: 1, metalness: 0 });
      for (const k of TEX_KEYS) if (m[k] && k in c) c[k] = m[k];
      c.userData = { ...m.userData, threedogMat: j }; mats.set(m, c);
    }
    return mats.get(m);
  };
  root.traverse(o => {
    o.userData = { ...o.userData, threedog: { cast: o.castShadow, receive: o.receiveShadow, hidden: !o.visible } };
    if (o.material) o.material = Array.isArray(o.material) ? o.material.map(tag) : tag(o.material);
  });
  return /** @type {ArrayBuffer} */ (await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false }));   // binary: true gives the GLB bytes
}

/** The part of a GLTFLoader result that toGLB exported: restores shadow flags, visibility and materials in place (other glTF files are unaffected). Returns the gltf. */
export function restoreBaked(gltf) {
  const mats = new Map();
  const rebuild = m => {
    const spec = m.userData.threedogMat; if (!spec) return m;
    if (!mats.has(m)) {
      const out = new THREE.MaterialLoader().parse(spec), { purpose } = m.userData;
      for (const k of TEX_KEYS) if (m[k] && k in out) out[k] = m[k];
      out.name = m.name;
      if (purpose) { out.userData.purpose = purpose; markEngineMade(out); }   // inspect.scene names it, and the fog / shadow walks count it as the engine's
      mats.set(m, out);
    }
    return mats.get(m);
  };
  gltf.scene.traverse(o => {
    const t = o.userData.threedog;
    if (!t) return;
    o.castShadow = t.cast; o.receiveShadow = t.receive; o.visible = !t.hidden; delete o.userData.threedog;
    if (o.material) o.material = Array.isArray(o.material) ? o.material.map(rebuild) : rebuild(o.material);
  });
  return gltf;
}

/** A GLTFLoader result (already restoreBaked) -> the object that was exported (a geometry if toGLB was given one). */
export function fromGLTF(gltf) {
  const kids = gltf.scene.children, root = kids.length === 1 ? kids[0] : gltf.scene;
  if (root.userData.threedogGeometry) { let g = null; root.traverse(o => { if (!g && o.isMesh) g = o.geometry; }); return g; }
  root.removeFromParent();
  return root;
}

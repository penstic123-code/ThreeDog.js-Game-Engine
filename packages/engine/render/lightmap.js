// Baked lightmaps: reads the file `threedog bake light` writes and hands plain three.js what it needs. At run time a lightmap is only
// material.lightMap and a second UV set, so it costs nothing per frame and looks the same on WebGL and WebGPU.
// Why the file carries geometry and not just a picture: the unwrap cuts seams, so a baked mesh has more vertices than the source. Each entry keeps which
// source vertex every new vertex came from, and the mesh is rebuilt from that: the game's own attributes stay the game's, only the layout changes.
// The checks are here because the runtime is where it goes wrong without a word: a mesh that moved keeps light from where it was, a mesh that is not the
// one baked gets its UVs scrambled, and ambient light the bake already saw adds again.
import * as THREE from 'three';
import { readParams } from '../core/params.js';
import { codedError, coded } from '../core/errorHints.js';
import { warnOnce } from '../core/validate.js';
import { mats, noteFillLight, noteEnvironment } from './lit.js';

const FORMAT = 'threedog-lightmap', VERSION = 1, MAGIC = 0x4d4c4454;   // 'TDLM'
const LOAD = { owner: { type: 'string', default: 'game', desc: 'who loaded it (describe().render.lightmap)' } };
const STRINGS = {
  data: 'engine.loadLightmap(file): {why}. Pass the path or bytes of a file `threedog bake light` wrote, or bake again',
  file: "engine.loadLightmap(file): file must be a path (string) or an ArrayBuffer; got {got}",
  fetch: 'engine.loadLightmap({file}): the file could not be read ({why}). Bake it with `threedog bake light`',
  missing: 'lightmap: {n} baked mesh(es) not in the scene or changed since the bake ({names}): they keep their old look. Load after the level is built, or bake again',
  moved: 'lightmap: {n} baked mesh(es) moved since the bake ({names}): baked light stays where it was. Moving things use a probe grid, not a lightmap',
  doubled: 'lightmap is added on top of {what}, which the bake already saw, so that light counts twice. Turn it down on the baked level, or bake without it',
  shared: 'lightmap: a baked mesh shares its material with an unbaked one ({names}): that mesh has no second UV set and samples the map wrongly. Give it its own material',
};

/** Split the file into its table and its binary part; every problem is a coded refusal before anything is touched */
function parse(buf) {
  const bad = why => codedError('lightmap-data', STRINGS.data.replace('{why}', why));
  if (buf.byteLength < 8 || new DataView(buf).getUint32(0, true) !== MAGIC) throw bad('this is not a lightmap file');
  const n = new DataView(buf).getUint32(4, true);
  if (8 + n > buf.byteLength) throw bad('the file is cut short');
  let meta;
  try { meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n))); } catch { throw bad('its table is not JSON'); }
  if (meta.format !== FORMAT) throw bad(`format is ${JSON.stringify(meta.format)}`);
  if (meta.version !== VERSION) throw bad(`version ${JSON.stringify(meta.version)} is not supported`);
  if (!Number.isInteger(meta.size) || meta.size < 4 || !Array.isArray(meta.meshes)) throw bad('its table has no size or mesh list');
  const base = (8 + n + 7) & ~7, end = base + meta.size * meta.size * 8;   // 8: the half floats and the 32-bit lists after them need aligned views
  if (end > buf.byteLength) throw bad('the file is cut short');
  for (const m of meta.meshes) if (base + m.at + (m.count * 3 + m.indices) * 4 > buf.byteLength) throw bad(`the data of mesh ${m.name} is cut short`);
  return { meta, base };
}

/** The mesh with the unwrapped layout: every attribute gathered through the source vertex list, the new index, and uv1 */
function relayout(src, from, index, uv1) {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    if (name === 'uv1') continue;
    const n = a.itemSize, out = new /** @type {any} */ (a.array.constructor)(from.length * n);
    for (let i = 0; i < from.length; i++) for (let c = 0; c < n; c++) out[i * n + c] = a.getComponent(from[i], c);
    g.setAttribute(name, new THREE.BufferAttribute(out, n, a.normalized));
  }
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  for (const x of src.groups) g.addGroup(x.start, x.count, x.materialIndex);
  g.name = src.name;
  return g;
}


/** One lightmap in the scene: three's plain texture on the baked meshes' materials. Made by loadLightmap only */
class Lightmap {
  constructor(e, meta, texture, owner, file) {
    Object.assign(this, { _e: e, texture, owner, file, size: meta.size, _entries: new Map(), skipped: meta.skipped ?? [], missing: [], backend: meta.backend });
  }
  /** Meshes that moved, mapped materials shared with unmapped meshes, and what adds the light again. Runs on describe() and at load, never per frame */
  _checks() {
    const moved = [], doubled = [], shared = [], onMapped = new Set();
    for (const [o] of this._entries) for (const m of mats(o)) onMapped.add(m);
    this._e.scene.traverseVisible(o => {
      if (noteFillLight(o, doubled)) return;
      if (o.isLightProbeGrid) doubled.push(`probe grid ${o.name}`);
      else if (o.isMesh && !this._entries.has(o) && mats(o).some(m => onMapped.has(m))) shared.push(o.name || `${o.type} ${o.id}`);
    });
    noteEnvironment(this._e.scene, doubled);
    for (const [o, matrix] of this._entries) {
      o.updateWorldMatrix(true, false);
      if (o.matrixWorld.elements.some((v, i) => Math.abs(v - matrix[i]) > 1e-3)) moved.push(o.name);
    }
    return { moved, doubled, shared };
  }
  /** describe().render.lightmap row */
  info() {
    const { moved, doubled, shared } = this._checks();
    return { file: this.file, size: this.size, meshes: this._entries.size, owner: this.owner, bakedOn: this.backend, skipped: this.skipped, missing: this.missing, moved, doubled, shared };
  }
  /** Take the map off the meshes and free it (the unwrapped geometry stays: it draws the same). Safe to call twice */
  remove() {
    if (this._e._lightmap !== this) return;
    for (const [o] of this._entries) for (const m of mats(o)) if (m.lightMap === this.texture) { m.lightMap = null; m.needsUpdate = true; }
    this.texture.dispose(); this._e._lightmap = null;
  }
}

/** Mixed into Engine.prototype (core/Engine.js) */
export const lightmapMethods = {
  /**
   * Put a baked lightmap on the scene: `threedog bake light` wrote the file from the meshes the game marked `userData.static = true`; this rebuilds each with
   * its second UV set and sets plain `material.lightMap`, on WebGL and WebGPU alike. Call it once the level is built, with its lights as they will be
   * played. Nothing runs per frame. Keep the sun real-time; the ambient light the bake saw (hemisphere, environment) has to go, or it counts twice.
   * A wrong file is refused with code `lightmap-data` and nothing is changed. `material.lightMapIntensity` is yours. describe().render.lightmap says what
   * was skipped, moved or doubled.
   * @example userData: floor.userData.static = true;   // then: threedog bake light
   * const light = await engine.loadLightmap('light/level.lightmap');
   * hemi.intensity = 0;
   * @param {string | ArrayBuffer} file a path (fetched) or the file's bytes
   * @param {{ owner?: string }} [opts]
   * @returns {Promise<import('../types/core').Lightmap>}
   */
  async loadLightmap(file, opts) {
    const o = readParams('engine.loadLightmap()', LOAD, opts);
    if (typeof file !== 'string' && !(file instanceof ArrayBuffer)) throw codedError('lightmap-data', STRINGS.file.replace('{got}', String(file)));
    let buf = file;
    if (typeof file === 'string') {
      const res = await fetch(file).catch(err => ({ ok: false, statusText: String(err) }));
      if (!res.ok) throw codedError('lightmap-data', STRINGS.fetch.replace('{file}', file).replace('{why}', res.statusText));
      buf = await res.arrayBuffer();
    }
    const { meta, base } = parse(/** @type {ArrayBuffer} */ (buf));
    const tex = new THREE.DataTexture(new Uint16Array(/** @type {ArrayBuffer} */ (buf), base, meta.size * meta.size * 4), meta.size, meta.size, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.channel = 1; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
    this._lightmap?.remove();
    const set = new Lightmap(this, meta, tex, o.owner, typeof file === 'string' ? file : 'bytes');
    const binary = base + meta.size * meta.size * 8, names = new Map();
    this.scene.traverse(x => { if (x.isMesh && x.name) names.set(x.name, x); });
    for (const m of meta.meshes) {
      const mesh = names.get(m.name);
      // the vertex count is what the bake's list was made from: another count means another mesh, and its UVs would be noise
      if (!mesh || mesh.isInstancedMesh || mesh.geometry.attributes.position.count !== m.vertices) { set.missing.push(m.name); continue; }
      const at = binary + m.at;
      mesh.geometry = relayout(mesh.geometry, new Uint32Array(/** @type {ArrayBuffer} */ (buf), at, m.count), new Uint32Array(/** @type {ArrayBuffer} */ (buf), at + m.count * 4, m.indices),
        new Float32Array(/** @type {ArrayBuffer} */ (buf), at + (m.count + m.indices) * 4, m.count * 2));
      for (const x of mats(mesh)) { x.lightMap = tex; x.needsUpdate = true; }
      set._entries.set(mesh, m.matrix);
    }
    this._lightmap = set;
    const { moved, doubled, shared } = set._checks(), first = l => l.slice(0, 3).join(', ');
    if (set.missing.length) warnOnce(coded('lightmap-check', STRINGS.missing.replace('{n}', String(set.missing.length)).replace('{names}', first(set.missing))));
    if (moved.length) warnOnce(coded('lightmap-check', STRINGS.moved.replace('{n}', String(moved.length)).replace('{names}', first(moved))));
    if (doubled.length) warnOnce(coded('lightmap-check', STRINGS.doubled.replace('{what}', doubled.join(', '))));
    if (shared.length) warnOnce(coded('lightmap-check', STRINGS.shared.replace('{names}', first(shared))));
    return set;
  },
};

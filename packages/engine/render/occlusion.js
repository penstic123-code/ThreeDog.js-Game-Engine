// Occlusion culling for the engine's own big things (hlod cells, engine.batching's instanced groups), on both renderers. Off by default: it pays only when what hides is heavy;
// on a scene of many small objects the queries cost more CPU than the draws they save.
// three reports occlusion and leaves the rest to the caller, so this file is that rest: one cheap box per item drawn after the opaque objects, colorless and writing no depth,
// whose query says whether any of it was seen. WebGPURenderer: object.occlusionTest + renderer.isOccluded (readable only during the render, hence onBeforeRender). WebGLRenderer has no such
// property, so the box wraps its draw in a WebGL2 query.
// Results arrive frames late, so nothing may wait for them to appear:
//   - the box grows by the distance the camera covers in that delay, so it peeks out before the object does;
//   - a box that was not drawn (off screen) or a camera that jumped farther than the item's size means "show it": the frustum still culls it for free;
//   - hiding takes HIDE_AFTER results in a row, showing takes one.
// Hiding moves the meshes to HIDDEN_LAYER, not visible = false: visible stays the game's, shadow cameras keep that layer (a hidden thing still casts), engine.rays and voxelGI's volume enable it.
// The boxes are for the scene render alone: any other render of the same camera would draw them through its override material. The chains see to it: WebGL takes the layer off the camera
// once the scene is drawn (_sceneDrawn), every display.pass on WebGPU renders without it.
import * as THREE from 'three';
import { isWebGPU, onRendererSwap } from './backend.js';
import { codedError } from '../core/base/errorHints.js';
import { engineOwned } from '../core/scene/things.js';
import { RESERVED_LAYERS } from './layers.js';

const { occlusionHidden: HIDDEN_LAYER, occlusionBox: BOX_LAYER } = RESERVED_LAYERS;
const HIDE_AFTER = 2;
const DELAY = 3;                  // frames between a box being drawn and its result being read, at worst
const LIGHT_WALK = 60;            // frames between looks for new shadow lights

/** The mask bit of the batch layer, where a far original waits (hlod, assets.lod); three keeps layer masks unsigned */
export const FAR_BIT = (1 << RESERVED_LAYERS.batched) >>> 0;
/** For the raycast slot of an object rays must pass through: a batch, a proxy, an occlusion box */
export const noRaycast = () => {};

/**
 * The mask a mesh goes back to after the engine hid it on one layer. A game's write while hidden stands (hard rule 4): layers.set took the hidden layer
 * away, so the mask is the game's; layers.enable added to it, so the game's bit joins what was there before.
 * @param {number} now the mask now @param {number} bit the hiding layer's bit @param {number} before the mask before hiding @returns {number}
 */
export function unhideMask(now, bit, before) {
  if (now === bit) return before;
  return now & bit ? ((now & ~bit) | before) >>> 0 : now;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const size = new THREE.Vector3(), center = new THREE.Vector3(), here = new THREE.Vector3(), grown = new THREE.Box3();
const trianglesOf = m => (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1);

export class Occlusion {
  /** @param {any} engine @internal */
  constructor(engine) {
    /** @internal */ this.engine = engine;
    /** @internal */ this._on = false;
    /** @internal */ this._items = new Set();
    /** @internal */ this._frameNo = 0;
    /** @internal */ this._last = /** @type {THREE.Vector3 | null} */ (null);
    /** @internal */ this._root = null;
    /** @internal */ this._hook = null;
    /** @internal the layer bits this added to each shadow camera, taken back when culling goes off */ this._shadowBits = new Map();
    // fallback 'webgl' replaces the renderer inside start(), and each renderer needs its own query hook on the box
    /** @internal */ this._swap = onRendererSwap(engine, () => { if (this._on) for (const it of this._items) { this._unbox(it); this._box(it); } });
  }
  /** Occlusion culling of hlod cells and batched groups; describe().render.occlusion says what it saved @returns {boolean} */
  get enabled() { return this._on; }
  set enabled(v) {
    if (typeof v !== 'boolean') throw codedError('engine-misuse', `engine.occlusion.enabled is true or false, got ${JSON.stringify(v)}`);
    if (v === this._on) return;
    this._on = v;
    const cam = this.engine.camera;
    if (v) {
      this._root ??= engineOwned('occlusion', Object.assign(new THREE.Group(), { name: 'occlusion boxes' }));
      this.engine.scene.add(this._root);
      this._material ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
      for (const it of this._items) this._box(it);
      this._hook = this.engine.onRender(() => this._frame());
    } else {
      this._hook?.remove(); this._hook = null;
      for (const it of this._items) this._unbox(it);
      this._root?.removeFromParent();
      cam.layers.disable(BOX_LAYER);
      for (const [c, bits] of this._shadowBits) c.layers.mask &= ~bits;
      this._shadowBits.clear();
      this._last = null;
    }
  }
  /** What it does now: { watched, hidden, trianglesSkipped } (items, items hidden this frame, triangles not drawn this frame) */
  get stats() {
    let hidden = 0, trianglesSkipped = 0;
    for (const it of this._items) if (it.hidden) { hidden++; for (const m of it.meshes) if (m.visible) trianglesSkipped += trianglesOf(m); }
    return { watched: this._items.size, hidden, trianglesSkipped: Math.round(trianglesSkipped) };
  }
  /**
   * For the engine's own big things only (a game's ordinary objects are not worth a query each). Watch meshes as one item. box: the world box around them, or a function giving it when it changes (default: read once from the meshes, when culling first needs it: while off, watching costs nothing).
   * @param {any[]} meshes @param {THREE.Box3 | (() => THREE.Box3)} [box] @returns {{ remove(): void }} @internal
   */
  watch(meshes, box) {
    const read = typeof box === 'function' ? box : null;
    const it = { meshes, read, box: read ? null : box ?? null, masks: null, hidden: false, runs: 0, drawn: -1, proxy: null, query: null, pending: false, open: false };
    this._items.add(it);
    if (this._on) this._box(it);
    return { remove: () => { this._unbox(it); this._items.delete(it); } };
  }
  /** The item's box mesh, its query hooks on the renderer in use */
  _box(it) {
    if (!it.read) it.box ??= it.meshes.reduce((b, m) => b.expandByObject(m), new THREE.Box3());
    const p = it.proxy = new THREE.Mesh(unitBox, this._material);
    p.name = 'occlusion box'; p.layers.set(BOX_LAYER); p.renderOrder = Number.MAX_SAFE_INTEGER; p.matrixAutoUpdate = false; p.raycast = noRaycast;
    p.userData.batch = false;
    if (isWebGPU(this.engine.renderer)) {
      p.occlusionTest = true;
      p.onBeforeRender = (r, s, camera) => {
        if (camera !== this.engine.camera) return;
        it.drawn = this._frameNo;
        it.runs = r.isOccluded(p) ? it.runs + 1 : 0;
      };
    } else {
      p.onBeforeRender = (r, s, camera) => {
        if (camera !== this.engine.camera) return;
        it.drawn = this._frameNo;
        if (it.pending) return;
        const gl = r.getContext();
        it.query ??= gl.createQuery();
        gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, it.query);
        it.open = true;
      };
      p.onAfterRender = r => {
        if (!it.open) return;
        const gl = r.getContext();
        gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
        it.open = false; it.pending = true;
      };
    }
    this._root.add(p);
  }
  /** Back to plain meshes: shown, no box, no query */
  _unbox(it) {
    this._show(it);
    it.proxy?.removeFromParent(); it.proxy = null;
    this._dropQuery(it);
    it.runs = 0; it.drawn = -1;
  }
  _dropQuery(it) {
    if (!it.query) return;
    this.engine.renderer.getContext().deleteQuery(it.query);
    it.query = null; it.pending = false; it.open = false;
  }
  /** WebGL: take the query's answer if it has arrived */
  _read(it) {
    if (!it.pending) return;
    const gl = this.engine.renderer.getContext();
    if (!gl.getQueryParameter(it.query, gl.QUERY_RESULT_AVAILABLE)) return;
    it.runs = gl.getQueryParameter(it.query, gl.QUERY_RESULT) ? 0 : it.runs + 1;
    it.pending = false;
  }
  _hide(it) {
    it.hidden = true;
    it.masks = it.meshes.map(m => m.layers.mask);
    for (const m of it.meshes) m.layers.set(HIDDEN_LAYER);
  }
  _show(it) {
    if (!it.hidden) return;
    it.meshes.forEach((m, i) => { m.layers.mask = unhideMask(m.layers.mask, 1 << HIDDEN_LAYER, it.masks[i]); });
    it.hidden = false; it.masks = null;
  }
  /** Shadow cameras see HIDDEN_LAYER plus what the view camera sees, the boxes apart. A cascade's own lights hang off its shadow node, not the scene */
  _shadowCameras(cam) {
    const want = (cam.layers.mask & ~(1 << BOX_LAYER)) | (1 << HIDDEN_LAYER);
    // OR, never a plain write: a shadow camera can hold layers of its own (a first-person body on the camera's hide layer). Only what was added is noted, so off takes back no more
    const add = l => {
      const c = l.shadow?.camera, bits = c ? want & ~c.layers.mask : 0;
      if (bits) { c.layers.mask |= bits; this._shadowBits.set(c, (this._shadowBits.get(c) ?? 0) | bits); }
    };
    this.engine.scene.traverse(o => { if (o.isLight && o.castShadow) { add(o); o.shadow?.shadowNode?.lights?.forEach(add); } });
  }
  /** The WebGL chain, right after its scene render: the passes after it may render this camera again (outline's views, GTAO's normals, a game's Pass); _frame puts the layer back @internal */
  _sceneDrawn() { if (this._on) this.engine.camera.layers.disable(BOX_LAYER); }
  /** Once a frame, before the render: read what the last frames saw, decide who is drawn, place the boxes @internal */
  _frame() {
    const cam = this.engine.camera, n = ++this._frameNo;
    cam.layers.enable(BOX_LAYER);
    cam.getWorldPosition(here);
    const moved = this._last ? here.distanceTo(this._last) : Infinity;
    (this._last ??= new THREE.Vector3()).copy(here);
    const gl = !isWebGPU(this.engine.renderer);
    let hidNow = false;
    for (const it of this._items) {
      if (gl) this._read(it);
      if (it.read) it.box = it.read();
      if (it.box.isEmpty()) { this._show(it); it.proxy.visible = false; continue; }
      it.proxy.visible = true;
      it.box.getCenter(center); it.box.getSize(size);
      const pad = Math.max(size.length() * 0.02, Number.isFinite(moved) ? moved * DELAY : 0);
      grown.copy(it.box).expandByScalar(pad);
      const inside = grown.distanceToPoint(here) <= cam.near * 2;
      const seenLast = n - it.drawn <= 1;
      const hide = seenLast && !inside && moved <= size.length() / 2 && it.runs >= HIDE_AFTER;
      if (hide && !it.hidden) { this._hide(it); hidNow = true; } else if (!hide) this._show(it);
      grown.getSize(size);
      it.proxy.matrix.makeScale(size.x, size.y, size.z).setPosition(center);
      it.proxy.matrixWorldNeedsUpdate = true;
    }
    if (hidNow || n % LIGHT_WALK === 0) this._shadowCameras(cam);
  }
  /** @internal */
  dispose() { this.enabled = false; this._swap.remove(); this._items.clear(); this._material?.dispose(); }
}

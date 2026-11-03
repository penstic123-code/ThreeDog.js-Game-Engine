// Baked light probes. A grid of SH probes from the scene (bake / load / JSON), fed into one scene LightProbe each frame.
// Why only plain three.js (CubeCamera, LightProbeGenerator, LightProbe, no GLSL): it runs on both renderers, and the game can
// read or replace every piece (handle.probe is an ordinary LightProbe; handle.sample feeds the game's own).
// How the light reaches materials: one scene LightProbe whose SH is interpolated (trilinear) at a followed point every frame. Every lit material
// already reads scene light probes, so nothing is patched and no program changes when the point moves.
// shortcut: one SH for the whole scene (at the followed point): an object far from that point gets the light of where the point is, not its own.
//   Upgrade when a scene needs per-object light (a dark cave next to a bright square, both on screen): give each mesh its own SH (a material
//   uniform fed from sample()), or a 3D texture the shader reads; both need a material patch, which this scaffold avoids.
import { engineOwned } from '../core/things.js';
import * as THREE from 'three';
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js';
import { readParams } from '../core/params.js';
import { codedError } from '../core/errorHints.js';
import { defineOwned, dropOwned } from '../core/owned.js';
import { vec3 } from '../core/math.js';
import { cubeRender, cubeTarget } from './backend.js';

const FORMAT = 'threedog-probes', VERSION = 1, MAX_PROBES = 4096, SH = 27;
const BAKE = {
  bounds: { type: 'object', desc: 'THREE.Box3 or { min, max } (positions) the grid spans' },
  spacing: { type: 'number', min: 0.01, desc: 'largest distance between neighbour probes, meters' },
  resolution: { type: 'int', default: 16, min: 4, max: 256, desc: 'cube face size in px per probe (SH keeps only low frequencies: 16 is plenty)' },
  include: { type: 'function', optional: true, desc: '(object) => bool: meshes that return false are hidden while baking (the player, moving props)' },
  height: { type: 'number', optional: true, desc: 'one layer at this height above engine.surface(x, z) instead of a 3D grid' },
  follow: { type: 'any', default: 'focus', desc: "where the scene probe samples: 'focus' | 'camera' | Object3D | () => position | false (no scene probe)" },
  owner: { type: 'string', default: 'game', desc: 'who made the set (describe().render.probes)' },
};
const LOAD = { follow: BAKE.follow, owner: BAKE.owner };
const STRINGS = {
  bounds: 'engine.bakeProbes({ bounds }): bounds must be a THREE.Box3 or { min: [x, y, z], max: [x, y, z] } with max >= min on every axis; got {got}',
  tooMany: 'engine.bakeProbes(): {n} probes ({dims}) is more than {max}; raise spacing (each probe costs 6 renders and a GPU read back)',
  follow: "{where}: follow must be 'focus', 'camera', an Object3D, a function returning a position, or false; got {got}",
  data: 'engine.loadProbes(json): {why}. Pass what handle.toJSON() returned (format \'' + FORMAT + '\', version ' + VERSION + ')',
};
const sets = e => (e._probeSets ??= new Set());

/** Grid layout from bounds + spacing: counts per axis and the actual step (<= spacing, so the grid ends exactly on the bounds) */
function layout(bounds, spacing, height) {
  const min = vec3(bounds.min), max = vec3(bounds.max);
  if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite) || max.x < min.x || max.y < min.y || max.z < min.z) {
    throw codedError('probes-option', STRINGS.bounds.replace('{got}', JSON.stringify({ min, max })));
  }
  const size = new THREE.Vector3().subVectors(max, min);
  const n = s => Math.max(1, Math.ceil(s / spacing - 1e-6) + 1);
  const counts = [n(size.x), height == null ? n(size.y) : 1, n(size.z)];
  const step = [size.x, size.y, size.z].map((s, i) => (counts[i] > 1 ? s / (counts[i] - 1) : 0));
  return { origin: [min.x, min.y, min.z], step, counts };
}

/** World position of grid point i of data { origin, step, counts, height } */
function gridPoint(e, d, i, out) {
  const [nx, ny] = d.counts, ix = i % nx, iy = Math.floor(i / nx) % ny, iz = Math.floor(i / (nx * ny));
  out.set(d.origin[0] + ix * d.step[0], d.origin[1] + iy * d.step[1], d.origin[2] + iz * d.step[2]);
  if (d.height != null) { const g = e.surface(out.x, out.z); out.y = (Number.isFinite(g) ? g : 0) + d.height; }
  return out;
}

/** Refuse a follow value before any work: bakeProbes checks it first, so a typo does not cost a whole bake (6 renders per probe) and then throw */
function checkFollow(follow, where) {
  if (!(follow === false || follow === 'focus' || follow === 'camera' || follow?.isObject3D || typeof follow === 'function')) {
    throw codedError('probes-option', STRINGS.follow.replace('{where}', where).replace('{got}', String(follow)));
  }
}

/** A probe set: grid data + the scene probe that follows a point. Made by bakeProbes / loadProbes only (they checked follow) */
class ProbeSet {
  constructor(e, data, { follow, owner, source }) {
    Object.assign(this, { _e: e, origin: data.origin, step: data.step, counts: data.counts, height: data.height ?? null, sh: data.sh, owner, source, follow });
    this.count = this.counts[0] * this.counts[1] * this.counts[2];
    /** bake time in ms (null for a loaded set) */ this.bakeMs = data.bakeMs ?? null;
    /** the scene LightProbe fed from the grid (null with follow: false); its intensity is the game's (three's default 1) */
    this.probe = null;
    if (follow !== false) {
      this.probe = new THREE.LightProbe(); this.probe.name = 'probes:' + owner;
      e.scene.add(engineOwned('probes', this.probe));
      // the engine writes probe.sh every frame: a game that writes it itself (its own SH) takes it over, the engine yields (core/owned.js)
      const n = e._probeN = (e._probeN ?? 0) + 1;   // unique per engine: a reused id would replace another live set's record
      this._owned = defineOwned(e, { id: `probes.sh#${n}`, part: 'lights', key: 'probes', read: () => this.probe.sh.toArray(), objects: [this.probe],
        levels: { manual: "engine.look.lights.manual('probes')" } });
      this._tmp = new THREE.Vector3();
      this._frame = e.onFrame(() => this._update());
      this._update();
    }
    sets(e).add(this);
  }
  _update() {
    const o = this._owned, f = this.follow, e = this._e, p = this._tmp;
    o.check();
    if (o.on) {
      if (f === 'camera') p.copy(e.camera.position); else if (f?.isObject3D) f.getWorldPosition(p); else if (typeof f === 'function') vec3(f(), p); else vec3(e.focus, p);
      this.sample(p, this.probe.sh);
    }
    o.mark();
  }
  /**
   * The interpolated SH at a position (trilinear between the 8 grid probes around it; outside the grid the nearest edge). With height mode y is ignored.
   * @param {any} pos any position form (Vector3, Object3D, [x, y, z], { x, y, z })
   * @param {THREE.SphericalHarmonics3 | THREE.LightProbe} [target] written in place (a LightProbe's sh); a new SphericalHarmonics3 when omitted
   * @returns {THREE.SphericalHarmonics3}
   */
  sample(pos, target) {
    const sh = target?.isLightProbe ? target.sh : target ?? new THREE.SphericalHarmonics3();
    const v = vec3(pos, this._s ??= new THREE.Vector3()), [nx, ny, nz] = this.counts, c = sh.coefficients;
    const axis = (x, i) => { const n = this.counts[i]; if (n < 2) return [0, 0, 0]; const t = Math.min(n - 1, Math.max(0, (x - this.origin[i]) / this.step[i])), a = Math.min(n - 2, Math.floor(t)); return [a, a + 1, t - a]; };
    const [x0, x1, fx] = axis(v.x, 0), [y0, y1, fy] = this.height == null ? axis(v.y, 1) : [0, 0, 0], [z0, z1, fz] = axis(v.z, 2);
    for (const k of c) k.set(0, 0, 0);
    const add = (ix, iy, iz, w) => {
      if (w === 0) return;
      const b = ((iz * ny + iy) * nx + ix) * SH;
      for (let j = 0; j < 9; j++) c[j].x += this.sh[b + j * 3] * w, c[j].y += this.sh[b + j * 3 + 1] * w, c[j].z += this.sh[b + j * 3 + 2] * w;
    };
    for (const [iz, wz] of [[z0, 1 - fz], [z1, fz]]) for (const [iy, wy] of [[y0, 1 - fy], [y1, fy]]) for (const [ix, wx] of [[x0, 1 - fx], [x1, fx]]) add(ix, iy, iz, wx * wy * wz);
    return sh;
  }
  /** World position of probe i (height mode: on the ground + height) @param {number} i @param {THREE.Vector3} [out] */
  point(i, out = new THREE.Vector3()) { return gridPoint(this._e, this, i, out); }
  /** Plain data to ship as a file and give to engine.loadProbes (SH rounded to 5 decimals) */
  toJSON() {
    return { format: FORMAT, version: VERSION, origin: this.origin, step: this.step, counts: this.counts, height: this.height,
      sh: Array.from(this.sh, v => Math.round(v * 1e5) / 1e5) };
  }
  /** describe().render.probes row */
  info() {
    return { count: this.count, counts: this.counts, step: this.step.map(s => Math.round(s * 100) / 100), source: this.source, owner: this.owner,
      follow: this.follow === false ? false : typeof this.follow === 'string' ? this.follow : this.follow?.isObject3D ? `object ${this.follow.name || this.follow.id}` : 'function',
      writer: this._owned ? this._owned.info().writer : null, ...(this.bakeMs != null ? { bakeMs: Math.round(this.bakeMs) } : {}) };
  }
  /** Take the scene probe out and stop updating it; the data stays readable (sample, toJSON). Safe to call twice */
  remove() {
    if (!sets(this._e).delete(this)) return;
    this._frame?.remove(); this.probe?.removeFromParent();
    if (this._owned) dropOwned(this._e, [this._owned]);
  }
}

/** Render one cube at p and turn it into SH. Hidden objects are restored before the async read back, so normal frames never see them hidden */
async function bakeOne(e, cam, rt, p, hide) {
  cam.position.copy(p); cam.updateMatrixWorld();
  for (const o of hide) o.visible = false;
  try { cubeRender(e.renderer, e.scene, cam); } finally { for (const o of hide) o.visible = true; }
  return (await LightProbeGenerator.fromCubeRenderTarget(e.renderer, rt)).sh.toArray();
}

/** The debug view: one dot per probe, colored by its average (DC) light, over the real look */
function drawProbes(e, scene) {
  const list = [...sets(e)], n = list.reduce((s, x) => s + x.count, 0);
  if (!n) return () => {};
  const geo = new THREE.SphereGeometry(0.15, 8, 6), mat = new THREE.MeshBasicMaterial({ toneMapped: false });   // debug overlay only
  const dots = new THREE.InstancedMesh(geo, mat, n), m = new THREE.Matrix4(), p = new THREE.Vector3(), c = new THREE.Color();
  let k = 0;
  for (const s of list) for (let i = 0; i < s.count; i++, k++) {
    dots.setMatrixAt(k, m.makeTranslation(s.point(i, p)));
    const b = i * SH, Y00 = 0.282095;   // the SH constant term times Y00 is the probe's average radiance
    dots.setColorAt(k, c.setRGB(s.sh[b] * Y00, s.sh[b + 1] * Y00, s.sh[b + 2] * Y00));
  }
  dots.name = 'debug:probes'; scene.add(engineOwned('debug', dots));
  return () => { dots.removeFromParent(); geo.dispose(); mat.dispose(); dots.dispose(); };
}
function addSet(e, data, o) {
  e._probeView ??= e.debug?.defineView('probes', { what: 'each light probe as a dot colored by its average light', apply: scene => drawProbes(e, scene) });
  return new ProbeSet(e, data, o);
}

/** Check a loaded file's shape; every problem is a coded refusal, never a half-applied grid */
function readData(json) {
  const bad = why => codedError('probes-data', STRINGS.data.replace('{why}', why));
  if (!json || typeof json !== 'object') throw bad(`got ${typeof json}`);
  if (json.format !== FORMAT) throw bad(`format is ${JSON.stringify(json.format)}`);
  if (json.version !== VERSION) throw bad(`version ${JSON.stringify(json.version)} is not supported`);
  const tri = (k, ok) => { const v = json[k]; if (!Array.isArray(v) || v.length !== 3 || !v.every(ok)) throw bad(`${k} must be 3 numbers, got ${JSON.stringify(v)}`); return v; };
  const counts = tri('counts', x => Number.isInteger(x) && x >= 1), origin = tri('origin', Number.isFinite), step = tri('step', x => Number.isFinite(x) && x >= 0);
  // sample() divides by the step on every axis with 2+ probes: a 0 there gave NaN light (a black picture, no error)
  const flat = [0, 1, 2].find(i => counts[i] > 1 && !(step[i] > 0));
  if (flat !== undefined) throw bad(`step[${flat}] is ${step[flat]} while counts[${flat}] is ${counts[flat]}: an axis with 2 or more probes needs a step above 0`);
  const n = counts[0] * counts[1] * counts[2];
  if (n > MAX_PROBES) throw bad(`${n} probes is more than ${MAX_PROBES}`);
  if (json.height != null && !Number.isFinite(json.height)) throw bad('height must be a number or null');
  if (!Array.isArray(json.sh) || json.sh.length !== n * SH) throw bad(`sh must hold ${n} x ${SH} numbers, got ${Array.isArray(json.sh) ? json.sh.length : typeof json.sh}`);
  const sh = Float32Array.from(json.sh);
  if (!sh.every(Number.isFinite)) throw bad('sh holds a value that is not a finite number');
  return { origin, step, counts, height: json.height ?? null, sh };
}

/** Mixed into Engine.prototype (core/Engine.js) */
export const probeMethods = {
  /**
   * Bake a grid of light probes from the scene as it is now: a cube render at every grid point, turned into spherical harmonics (three's
   * LightProbeGenerator), then one scene `LightProbe` that follows a point (`follow`, default the camera focus) and takes the light
   * interpolated there every frame. The probe light adds to whatever ambient light the scene has (hemi, environment): lower those yourself
   * where the probes take over. A load-time cost, not per frame: 6 renders + a GPU read back per probe, awaited one probe at a time so the page
   * keeps drawing; ship the result with `toJSON()` + `engine.loadProbes(json)` instead of baking at every start.
   * Render targets and cube cameras are disposed before it resolves. Adding the probe changes the light setup: bake at start-up, not mid-play.
   * @example const probes = await engine.bakeProbes({ bounds: { min: [-20, 0, -20], max: [20, 6, 20] }, spacing: 4, include: o => !o.userData.moving });
   * probes.sample(npc.position, npcProbe);   // your own probe for one object
   * saveFile('probes.json', JSON.stringify(probes.toJSON()));
   * @param {{ bounds: THREE.Box3 | { min: any, max: any }, spacing: number, resolution?: number, include?: (o: THREE.Object3D) => boolean,
   *   height?: number, follow?: 'focus' | 'camera' | THREE.Object3D | (() => any) | false, owner?: string }} opts
   * @returns {Promise<import('../types/core').ProbeSet>}
   */
  async bakeProbes(opts) {
    const o = readParams('engine.bakeProbes()', BAKE, opts);
    checkFollow(o.follow, 'engine.bakeProbes()');
    const { origin, step, counts } = layout(o.bounds, o.spacing, o.height), n = counts[0] * counts[1] * counts[2];
    if (n > MAX_PROBES) throw codedError('probes-option', STRINGS.tooMany.replace('{n}', n).replace('{dims}', counts.join(' x ')).replace('{max}', MAX_PROBES));
    const t0 = performance.now();   // measure
    const rt = cubeTarget(this.renderer, THREE, o.resolution, { type: THREE.HalfFloatType, generateMipmaps: false });
    const cam = new THREE.CubeCamera(0.05, this.camera.far, rt);
    // hidden while each cube renders: meshes the filter rejects, and every scene probe (an earlier set lighting the capture would count twice)
    const hide = [];
    this.scene.traverse(x => { if (x.visible && (x.isLightProbe || (o.include && (x.isMesh || x.isPoints || x.isLine || x.isSprite) && !o.include(x)))) hide.push(x); });
    const data = { origin, step, counts, height: o.height ?? null, sh: new Float32Array(n * SH) };
    const p = new THREE.Vector3();
    try {
      for (let i = 0; i < n; i++) data.sh.set(await bakeOne(this, cam, rt, gridPoint(this, data, i, p), hide), i * SH);
    } finally { rt.dispose(); }
    data.bakeMs = performance.now() - t0;   // measure
    return addSet(this, data, { follow: o.follow, owner: o.owner, source: 'bake' });
  },
  /**
   * A probe set from a file made by `handle.toJSON()` (no baking). A wrong shape is refused with code `probes-data` and nothing is added.
   * @example const probes = engine.loadProbes(await (await fetch('probes.json')).json());
   * @param {object} json
   * @param {{ follow?: 'focus' | 'camera' | THREE.Object3D | (() => any) | false, owner?: string }} [opts]
   * @returns {import('../types/core').ProbeSet}
   */
  loadProbes(json, opts) {
    const o = readParams('engine.loadProbes()', LOAD, opts);
    checkFollow(o.follow, 'engine.loadProbes()');
    return addSet(this, readData(json), { follow: o.follow, owner: o.owner, source: 'file' });
  },
};

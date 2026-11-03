// Built-in material terms a game can take over whole: the cloud shadow ('clouds' patch) and the season / snow-cover tint ('season' patch).
// engine.look.cloudShadow.replace(spec | false) and engine.look.season.replace(spec | false) land here (core/look/coreParts.js).
//   spec   { glsl, tsl, uniforms?, pars?, slot? }: the game's own patch put in place of the engine's under the same name, on both backends
//          (glsl for WebGLRenderer, tsl: (ctx) => node for WebGPURenderer, as every patch). The engine uniforms the built-in term reads stay
//          declared and bound (uCloud*, uTime / uFoliageTint, uGroundTint, uFoliageMix, uGroundMix, uCover), so the game's code keeps the signals.
//          look.season also takes kind => spec (kind 'foliage' | 'ground'); an object spec gets THREEDOG_SEASON_KIND (0 / 1) in its GLSL.
//   false  the term leaves every engine material: nothing drawn, no shader cost; the game draws its own (a patch of its own, a mesh, a pass).
//   null   (remove the layer) the engine's term again.
// Why a registry of materials and not "only new materials": the terrain and the species materials exist before game code runs, so a
// replace that skipped them would do nothing visible. Each material applyEffects gave a term is remembered (weakly) under its engine.
import { patchMaterial, unpatchMaterial, materialPatches, isEngineMade } from './patches.js';
import { applyEffects } from './materials.js';   // a cycle (materials.js tracks terms here); only called at run time
import { sceneVisitor } from '../core/sceneDelta.js';
import { ownedRow } from '../core/owned.js';
import { EFFECTS, hashText } from './effects.js';
import { codedError } from '../core/errorHints.js';

const CLOUD_U = ['uTime', 'uCloud', 'uCloudShadow', 'uCloudScale', 'uCloudSpeed'];
const SEASON_U = ['uFoliageTint', 'uGroundTint', 'uFoliageMix', 'uGroundMix', 'uCover'];
const CLOUD_PARS = '#include <threedog_clouds_pars_fragment>';
const SEASON_PARS = 'uniform vec3 uFoliageTint; uniform vec3 uGroundTint; uniform float uFoliageMix; uniform float uGroundMix; uniform vec2 uCover;\n#include <threedog_season>';

/** engine -> Set of WeakRef(material); material -> { clouds: boolean, season: 'foliage' | 'ground' | null, engine: WeakRef } */
const BY_ENGINE = new WeakMap(), REC = new WeakMap();

/**
 * Remember which built-in terms applyEffects gave a material, under its engine, so a later replace reaches it @internal render/materials.js
 * @param {any} e @param {any} m @param {{ clouds?: boolean, season?: string | null }} rec
 */
export function trackTerms(e, m, rec) {
  if (!e) return;
  const was = REC.get(m);
  // the engine weakly: a material kept after its engine is disposed must not keep the engine alive
  REC.set(m, { clouds: !!(rec.clouds || was?.clouds), season: rec.season ?? was?.season ?? null, engine: new WeakRef(e) });
  if (was) return;
  let s = BY_ENGINE.get(e);
  if (!s) BY_ENGINE.set(e, s = new Set());
  s.add(new WeakRef(m));
}

/** copyPatches(from, to): the copy carries the terms, under the same engine @internal render/patches.js @param {any} from @param {any} to */
export function copyTerms(from, to) {
  const rec = REC.get(from), e = rec?.engine.deref();
  if (e) trackTerms(e, to, rec);
}

/**
 * Check a replace value before any layer is written: why it is wrong, or null @internal core/look/coreParts.js
 * @param {'cloudShadow' | 'season'} part @param {any} v @param {boolean} gpu the engine draws with WebGPURenderer
 */
export function badTerm(part, v, gpu) {
  if (v === false || v == null) return null;
  if (part === 'season' && typeof v === 'function') return null;   // kind => spec, checked when a material is built
  const shape = part === 'season' ? '{ glsl, tsl, uniforms? }, kind => { glsl, tsl }, or false' : '{ glsl, tsl, uniforms? } or false';
  if (typeof v !== 'object') return `is ${shape}; got ${typeof v}`;
  if (v.glsl == null && v.tsl == null) return `is ${shape}: give glsl (WebGLRenderer) and / or tsl (WebGPURenderer)`;
  if (v.glsl != null && typeof v.glsl !== 'string') return 'glsl is the slot code as a string';
  if (v.tsl != null && typeof v.tsl !== 'function' && typeof v.tsl !== 'object') return 'tsl is (ctx) => node';
  // each renderer draws its own form: the missing one would leave the term out without a word, so it is named here (the look.sky hook rule)
  if (gpu === false && v.glsl == null) return 'has only a tsl form, which WebGLRenderer cannot draw: give glsl too ({ glsl, tsl })';
  if (gpu && v.tsl == null) return 'has only a glsl form, which WebGPURenderer cannot draw: give tsl too ({ glsl, tsl })';
  return null;
}

const pickU = (e, keys) => Object.fromEntries(keys.map(k => [k, e.uniforms[k]]));
const BUILT = new WeakMap();   // spec -> { [kind]: patch }: one patch object per spec, so materials share their program
function own(e, spec, kind, make) {
  let t = BUILT.get(spec);
  if (!t) BUILT.set(spec, t = {});
  return t[kind] ??= make();
}

/**
 * The 'clouds' patch this engine puts on a material: the built-in one, the game's (look.cloudShadow.replace(spec)), or null (replace(false))
 * @internal render/materials.js applyEffects
 * @param {any} e
 */
export function cloudsPatch(e) {
  const r = e?.look?.cloudShadow?.value('@replace');
  if (r === false) return null;
  if (!r) return EFFECTS.clouds();
  return own(e, r, 'clouds', () => ({ name: 'clouds', needs: { patches: ['world'] }, slot: r.slot ?? 'lighting',
    cacheKey: 'game~' + hashText(JSON.stringify([r.glsl ?? '', r.pars ?? '', r.slot ?? ''])),
    uniforms: { ...pickU(e, CLOUD_U), ...r.uniforms }, ...(r.glsl != null && { glsl: r.glsl, pars: CLOUD_PARS + (r.pars ? '\n' + r.pars : '') }),
    ...(r.tsl != null && { tsl: r.tsl }) }));
}

/**
 * The 'season' patch for kind ('foliage' | 'ground'): built-in, the game's (look.season.replace), or null (replace(false))
 * @internal render/materials.js applyEffects
 * @param {any} e @param {string} kind
 */
export function seasonPatch(e, kind) {
  const r = e?.look?.season?.value('@replace');
  if (r === false) return null;
  if (!r) return EFFECTS.season(kind);
  return own(e, r, kind, () => {
    const s = typeof r === 'function' ? r(kind) : r, bad = badTerm('season', s, !!e.renderer?.isWebGPURenderer);
    if (bad || typeof s === 'function') throw codedError('look-param', `look.season.replace(kind => spec): for '${kind}' the spec ${bad ?? 'is { glsl, tsl }'}`);
    const id = kind === 'ground' ? 1 : 0;
    return { name: 'season', slot: s.slot ?? 'color', cacheKey: `${kind}~game~` + hashText(JSON.stringify([s.glsl ?? '', s.pars ?? '', s.slot ?? ''])),
      uniforms: { ...pickU(e, SEASON_U), ...s.uniforms },
      ...(s.glsl != null && { glsl: s.glsl, pars: `#define THREEDOG_SEASON_KIND ${id}\n${SEASON_PARS}` + (s.pars ? '\n' + s.pars : '') }),
      ...(s.tsl != null && { tsl: s.tsl }) };
  });
}

/**
 * A replace changed: every live material that carries the term gets the new one (or loses it) @internal core/look/coreParts.js
 * @param {any} e @param {'clouds' | 'season'} term
 */
export function retakeTerms(e, term) {
  const s = BY_ENGINE.get(e);
  if (!s) return;
  for (const ref of s) {
    const m = ref.deref(), rec = m && REC.get(m);
    if (!m) { s.delete(ref); continue; }
    if (term === 'clouds' ? !rec.clouds : !rec.season) continue;
    const p = term === 'clouds' ? cloudsPatch(e) : seasonPatch(e, rec.season);
    if (!p) { if (materialPatches(m).includes(term)) unpatchMaterial(m, term); continue; }
    patchMaterial(m, term === 'clouds' ? [EFFECTS.world(), p] : [p], { strict: false });
  }
}

// ---------- plain three.js materials the game adds take the cloud shadow too ----------
// The owner's rule is "the AI writes three.js, the engine plugs it in" (docs/plans/2026-11-03-slot-map.md): a MeshStandardMaterial a game puts
// in the scene must darken under the same drifting clouds as the engine's ground and trees, or the picture splits into "engine stuff" and
// "game stuff". So every lit classic material that enters the scene gets the 'clouds' term (the engine's, or the game's look.cloudShadow
// replace), through the same path as the engine's own materials (applyEffects -> trackTerms), so a later replace reaches it as well.
// Programs stay shared: the patch is one object with one cacheKey, so two MeshStandardMaterials still compile one program (three's own key).
// Left alone (each is a decision someone already made): materials that already carry engine patches (applyEffects / patchMaterial was
// called on them, e.g. applyEffects(m, { clouds: false })), engine-made materials (water, sky...), unlit types (MeshBasic has no lighting
// chunk), and a material with userData.cloudShadow === false (the per-material opt-out; read every frame, so setting it after the material
// is in the scene takes the term off, and clearing it puts it back). NodeMaterials are not adopted: their nodes are the game's own TSL
// (it may build its own lighting), so the engine does not chain into them unasked; describe lists them under notAdopted with the one line
// that adopts one, applyEffects(mat).
// Snow cover / season tint is not adopted: nothing tells a ground-like surface from a wall or a crate on a plain material, so it stays one
// line for the game: applyEffects(mat, { season: 'ground' }) (or 'foliage').
const LIT = new Set(['MeshLambertMaterial', 'MeshPhongMaterial', 'MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshToonMaterial']);
/** materials handed to the engine with { effects: false } (terrain / look.ground.replace, vegetation.define): drawn exactly as given */
const AS_GIVEN = new WeakSet();
/**
 * A material the game asked to be drawn untouched ({ effects: false }): adoption leaves it alone. Returns it. @internal render/materials.js,
 * modules/vegetation/look.js
 * @param {any} m a material or a material array @returns {any} m
 */
export function asGiven(m) { for (const x of Array.isArray(m) ? m : [m]) if (x) AS_GIVEN.add(x); return m; }

const litNode = m => m.isNodeMaterial && !!m.lights && !m.isMeshBasicNodeMaterial;
/** Give a plain material the term (clouds default on, nothing else: the same patch objects the engine's materials carry) */
function adopt(e, a, m) { applyEffects(m, { engine: e }); a.adopted.add(m); a.released.delete(m); }
/** userData.cloudShadow = false after adoption: the term comes off, and a later look.cloudShadow.replace skips it (retakeTerms) */
function release(a, m) {
  unpatchMaterial(m, 'clouds');   // 'world' stays (a varying; a patch the game added since may read it), as in retakeTerms
  const rec = REC.get(m);
  if (rec) rec.clouds = false;
  a.adopted.delete(m); a.released.add(m);
}

/**
 * Per frame, before drawing (core/loop.js): give the cloud shadow to plain lit materials that entered the scene since the last frame, and
 * follow each one's userData.cloudShadow flag both ways (one property read per distinct material in the scene). The scene walk is one size
 * check on a quiet frame (core/sceneDelta.js); the first call shows it the whole scene. @internal
 * @param {any} e
 */
export function syncPlainTerms(e) {
  let a = e._plainTerms;
  if (!a) {
    // adopted: every material this engine gave the term (weak: a dropped material is not held);
    // shown: material -> 'adopted' | 'optedOut' | 'node' -> how many objects in the scene use it, so describe lists what is in the scene now
    // (a new game after the title screen must describe the same as the first one, not the first playthrough's crates too)
    // released: adopted, then opted out late (its REC entry keeps it out of the "already patched" test, so it is recognised here)
    a = e._plainTerms = { adopted: new WeakSet(), released: new WeakSet(), shown: new Map(), view: null };
    const kind = m => {
      if (!m) return null;
      if (litNode(m)) return materialPatches(m).length || isEngineMade(m) ? null : 'node';
      if (!LIT.has(m.type)) return null;
      if (a.adopted.has(m)) return 'adopted';
      if (a.released.has(m)) return 'optedOut';   // the loop below adopts it again once the flag is cleared
      if (REC.has(m) || AS_GIVEN.has(m) || isEngineMade(m) || materialPatches(m).length) return null;
      if (m.userData?.cloudShadow === false) return 'optedOut';
      adopt(e, a, m);
      return 'adopted';
    };
    const each = (o, f) => { const ms = /** @type {any} */ (o).material; for (const m of Array.isArray(ms) ? ms : [ms]) f(m); };
    a.view = sceneVisitor(e.scene, {
      enter: o => each(o, m => { const k = kind(m); if (!k) return; const s = a.shown.get(m); if (s) s.n++; else a.shown.set(m, { k, n: 1 }); }),
      leave: o => each(o, m => { const s = a.shown.get(m); if (s && --s.n <= 0) a.shown.delete(m); }),
    });
    ownedRow(e, 'cloudShadow.plain', () => {
      if (!a.shown.size) return undefined;
      const names = k => [...a.shown].filter(([, s]) => s.k === k).map(([m]) => m.name || m.type);
      const node = names('node');
      return { part: 'cloudShadow', key: 'plain', writer: 'engine', materials: names('adopted'), optedOut: names('optedOut'),
        why: "plain lit materials added to the scene take the engine's cloud shadow (on the sun light only) like its own; material.userData.cloudShadow = false keeps one out, also when set later",
        ...(node.length && { notAdopted: node,
          whyNot: "NodeMaterials are the game's own TSL and are not patched unasked, so they have no cloud shadow; applyEffects(mat) gives one the engine's" }) };
    });
  }
  a.view.sync();
  // the opt-out flag can change at any time (a game sets it on the line after scene.add): follow it both ways
  for (const [m, s] of a.shown) {
    if (s.k === 'adopted' && m.userData?.cloudShadow === false) { release(a, m); s.k = 'optedOut'; }
    else if (s.k === 'optedOut' && m.userData?.cloudShadow !== false) {
      // not when the game patched it itself meanwhile (applyEffects / patchMaterial): that is its own decision, as at entry
      if (a.released.has(m) || !(REC.has(m) || materialPatches(m).length)) { adopt(e, a, m); s.k = 'adopted'; } else a.shown.delete(m);
    }
  }
}
/** engine.dispose: stop watching the scene @internal core/lifecycle.js @param {any} e */
export function dropPlainTerms(e) { e._plainTerms?.view.remove(); e._plainTerms = null; }

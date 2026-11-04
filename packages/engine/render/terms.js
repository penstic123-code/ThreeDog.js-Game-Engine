// Built-in material terms a game can take over whole: the cloud shadow ('clouds' patch) and the season / snow-cover tint ('season' patch).
// engine.terms.cloudShadow(spec | false) and engine.terms.season(spec | false) land here. The terms sit on engine materials and on a material the game
// passed to applyEffects; the engine adds them to nothing else, because it does not change a game's material unasked.
//   spec   { glsl, tsl, uniforms?, pars?, slot? }: the game's own patch put in place of the engine's under the same name, on both backends
//          (glsl for WebGLRenderer, tsl: (ctx) => node for WebGPURenderer, as every patch). The engine uniforms the built-in term reads stay
//          declared and bound (uCloud*, uTime / uFoliageTint, uGroundTint, uFoliageMix, uGroundMix, uCover), so the game's code keeps the signals.
//          engine.terms.season also takes kind => spec (kind 'foliage' | 'ground'); an object spec gets THREEDOG_SEASON_KIND (0 / 1) in its GLSL.
//   false  the term leaves every engine material: nothing drawn, no shader cost; the game draws its own (a patch of its own, a mesh, a pass).
//   the handle's remove() gives the engine's term back.
// Why a registry of materials and not "only new materials": the terrain and the species materials exist before game code runs, so a
// replace that skipped them would do nothing visible. Each material applyEffects gave a term is remembered (weakly) under its engine.
import { patchMaterial, unpatchMaterial, materialPatches } from './patches.js';
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
 * Check a term spec before it is taken: why it is wrong, or null
 * @param {'cloudShadow' | 'season'} part @param {any} v @param {boolean} gpu the engine draws with WebGPURenderer
 */
function badTerm(part, v, gpu) {
  if (v === false) return null;
  if (part === 'season' && typeof v === 'function') return null;   // kind => spec, checked when a material is built
  const shape = part === 'season' ? '{ glsl, tsl, uniforms? }, kind => { glsl, tsl }, or false' : '{ glsl, tsl, uniforms? } or false';
  if (v == null || typeof v !== 'object') return `is ${shape}; got ${v === null ? 'null' : typeof v}`;
  if (v.glsl == null && v.tsl == null) return `is ${shape}: give glsl (WebGLRenderer) and / or tsl (WebGPURenderer)`;
  if (v.glsl != null && typeof v.glsl !== 'string') return 'glsl is the slot code as a string';
  if (v.tsl != null && typeof v.tsl !== 'function' && typeof v.tsl !== 'object') return 'tsl is (ctx) => node';
  // each renderer draws its own form: the missing one would leave the term out without a word, so it is named here
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
 * The 'clouds' patch this engine puts on a material: the built-in one, the game's (engine.terms.cloudShadow(spec)), or null (false)
 * @internal render/materials.js applyEffects
 * @param {any} e
 */
export function cloudsPatch(e) {
  const r = e?._terms?.clouds;
  if (r === false) return null;
  if (!r) return EFFECTS.clouds();
  return own(e, r, 'clouds', () => ({ name: 'clouds', needs: { patches: ['world'] }, slot: r.slot ?? 'lighting',
    cacheKey: 'game~' + hashText(JSON.stringify([r.glsl ?? '', r.pars ?? '', r.slot ?? ''])),
    uniforms: { ...pickU(e, CLOUD_U), ...r.uniforms }, ...(r.glsl != null && { glsl: r.glsl, pars: CLOUD_PARS + (r.pars ? '\n' + r.pars : '') }),
    ...(r.tsl != null && { tsl: r.tsl }) }));
}

/**
 * The 'season' patch for kind ('foliage' | 'ground'): built-in, the game's (engine.terms.season(spec)), or null (false)
 * @internal render/materials.js applyEffects
 * @param {any} e @param {string} kind
 */
export function seasonPatch(e, kind) {
  const r = e?._terms?.season;
  if (r === false) return null;
  if (!r) return EFFECTS.season(kind);
  return own(e, r, kind, () => {
    const s = typeof r === 'function' ? r(kind) : r, bad = badTerm('season', s, !!e.renderer?.isWebGPURenderer);
    if (bad || typeof s === 'function') throw codedError('engine-terms', `engine.terms.season(kind => spec): for '${kind}' the spec ${bad ?? 'is { glsl, tsl }'}`);
    const id = kind === 'ground' ? 1 : 0;
    return { name: 'season', slot: s.slot ?? 'color', cacheKey: `${kind}~game~` + hashText(JSON.stringify([s.glsl ?? '', s.pars ?? '', s.slot ?? ''])),
      uniforms: { ...pickU(e, SEASON_U), ...s.uniforms },
      ...(s.glsl != null && { glsl: s.glsl, pars: `#define THREEDOG_SEASON_KIND ${id}\n${SEASON_PARS}` + (s.pars ? '\n' + s.pars : '') }),
      ...(s.tsl != null && { tsl: s.tsl }) };
  });
}

/**
 * A term changed: every live material that carries it gets the new one (or loses it)
 * @param {any} e @param {'clouds' | 'season'} term
 */
function retakeTerms(e, term) {
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

/**
 * Put a term in place, on every material that carries it now and later: returns the handle whose remove() gives the engine's back
 * @param {any} e @param {'cloudShadow' | 'season'} part @param {'clouds' | 'season'} term @param {any} spec
 */
function take(e, part, term, spec) {
  const bad = badTerm(part, spec, !!e.renderer?.isWebGPURenderer);
  if (bad) throw codedError('engine-terms', `engine.terms.${part}(spec): spec ${bad}`);
  const held = e._terms, mine = { spec };
  held[term] = spec; held.who[term] = mine;
  retakeTerms(e, term);
  return { remove() { if (held.who[term] !== mine) return; delete held[term]; delete held.who[term]; retakeTerms(e, term); } };
}

/** engine.terms @param {any} e */
export function defineTerms(e) {
  /** @internal the game's terms now, by patch name; who = the handle that holds each */
  e._terms = { who: {} };
  e.terms = {
    /**
     * Put your own cloud shadow in place of the engine's on engine materials and on every material you passed to applyEffects, built before the call too; false
     * takes it off them all. uCloud*, uTime and threedogCloudShadow(worldPos) stay in scope (ctx.fx.cloudShadow on WebGPU). remove() gives the engine's back.
     * @example
     * const mine = engine.terms.cloudShadow({ glsl: 'reflectedLight.directDiffuse *= 0.5;', tsl: c => ({ directDiffuse: c.directDiffuse.mul(0.5) }) });
     * mine.remove();
     * @param {{ glsl?: string, tsl?: any, uniforms?: Record<string, any>, pars?: string, slot?: string } | false} spec a patch, slot 'lighting' unless you name one
     * @returns {{ remove(): void }}
     */
    cloudShadow: spec => take(e, 'cloudShadow', 'clouds', spec),
    /**
     * Put your own season and snow tint in place of the engine's on engine materials and on every material you passed to applyEffects with a season, built before the
     * call too; false takes it off them all. uFoliageTint, uGroundTint, uFoliageMix, uGroundMix, uCover (the cover amount alone: x foliage, y ground) and
     * threedogSeason(color, kind) stay in scope. An object spec gets THREEDOG_SEASON_KIND (0 foliage, 1 ground) in its GLSL. remove() gives the engine's back.
     * @example
     * const mine = engine.terms.season(kind => ({ glsl: 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), uCover.y);', tsl: c => c.color }));
     * mine.remove();
     * @param {{ glsl?: string, tsl?: any, uniforms?: Record<string, any>, pars?: string, slot?: string } | ((kind: 'foliage' | 'ground') => any) | false} spec slot 'color' unless you name one
     * @returns {{ remove(): void }}
     */
    season: spec => take(e, 'season', 'season', spec),
  };
}

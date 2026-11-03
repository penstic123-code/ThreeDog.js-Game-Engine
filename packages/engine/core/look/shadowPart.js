// look.shadow, core half: the master shadow switch and the shadow filter, one shared point each (look.shadow.enabled, look.shadow.type).
// Why in core and not in the sky: the engine sun casts shadows without a sky. Why one point: separate switches (an engine option, a method,
// a light key, the settings menu) each decided on their own and disagreed about what is on. One point has the usual layers:
//   engine.look.shadow.set({ enabled: false }, { owner: 'cutscene' })      a game (or a cutscene) turns them off; remove() gives them back
//   settings menu: { layer: 'settings', set: false }                      the player can turn them off, never force them on over the scene
//   engine.renderer.shadowMap.enabled = true                              plain three.js: the engine yields (read() sees it, describe says three)
// An installed sky adds its shadow-box keys (bias, cascades, extent ...) to this same part and applies them through part._skyApply (sky/lookShadow.js).
import { defineLookPart } from './part.js';
import { SHADOW_TYPES, shadowTypeOf } from '../shadowTypes.js';
import { codedError } from '../errorHints.js';

const COST = 'recompile';
const typeName = t => Object.keys(SHADOW_TYPES).find(k => SHADOW_TYPES[k].three === t) ?? null;

/** Shadows on in the picture right now (the renderer's switch: what a game wrote directly counts too) @param {any} e */
export const shadowsOn = e => !!e.renderer?.shadowMap?.enabled;

/**
 * Turn shadow rendering on or off: the renderer's switch only. Both renderers stop drawing and sampling shadow maps when
 * renderer.shadowMap.enabled is false (WebGL: WebGLShadowMap.render returns and programs drop USE_SHADOWMAP; WebGPU: the shadow
 * and light nodes check it), so no light's castShadow is touched: castShadow stays the game's, readable and writable while shadows are off,
 * and what the game set is what casts when they come back. Materials recompile once (the shadow define changes).
 * @param {any} e @param {boolean} on
 */
function switchShadows(e, on) {
  if (e._shadowsApplied === on) return;   // a forced re-apply (a failed write restores every key) must not walk the scene and recompile again
  e._shadowsApplied = on;
  e.renderer.shadowMap.enabled = on;
  e.scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
  e.events?.emit('settings:shadows', on);   // undefined during createEngine (the first apply runs before the services exist)
}

/** @param {any} e @param {{ owned: boolean, baseline: boolean }} o owned: the engine made the renderer (a game's own renderer keeps its shadow settings) */
export function defineShadowLook(e, { owned, baseline }) {
  const sm = () => e.renderer.shadowMap;
  defineLookPart(e, {
    id: 'shadow', group: 'atmosphere', module: 'core', object: () => e.renderer.shadowMap, applyAtStart: owned, docs: ['recipes/52-look.md', 'recipes/45-cascaded-shadows.md'],
    params: {
      enabled: { type: 'bool', default: baseline, cost: COST, desc: 'master shadow switch (renderer.shadowMap.enabled only: no light\'s castShadow is written)',
        why: 'technical render baseline under every style: the engine sun casts soft shadows, so things read as standing on the ground',
        off: "look.shadow.set({ enabled: false }) (a scene or cutscene); the settings menu restricts it with { layer: 'settings', set: false }" },
      type: { type: 'string', default: 'pcf', values: Object.keys(SHADOW_TYPES), neutral: true, cost: COST, desc: "'basic' hard edge | 'pcf' | 'vsm' softest; switching recompiles materials, do it rarely" },
    },
    read: () => ({ enabled: sm().enabled, type: typeName(sm().type) }),
    apply(v, changed) {
      if (changed.has('type')) {
        const t = shadowTypeOf(v.type, 'look.shadow.set({ type })');
        if (sm().type !== t) { sm().type = t; e.scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); }); }
      }
      if (changed.has('enabled')) switchShadows(e, v.enabled);
      // the sky's shadow box (bias, cascades, extent ...): engine.look.shadow is not assigned yet during the first apply, so no driver then
      e.look.shadow?._skyApply?.(v, changed);
    },
    noPatch: "the cascade patch ('csm') is internal; change the shadows with look.shadow.set({ type, radius, cascades, ... }); a lit ShaderMaterial of yours joins with look.shadow.include(mat)",
    extraSignatures: { include: 'include(material)' },
    noReplace: 'to own the shadows, light the world with your own three.js lights: sky({ sun: false }) or createEngine({ lights: false }), and write renderer.shadowMap yourself',
  });
  const part = e.look.shadow;
  /** A module that owns the shadow box (the sky) applies its keys here: (values, changedKeys) => void; null without one */
  part._skyApply = null;
  // include(mat): the opt-in for a game ShaderMaterial under cascaded shadows, which only a sky draws (sky/lookShadow.js replaces it)
  part.include = () => { throw codedError('look-verb', 'look.shadow.include(material) opts a ShaderMaterial into cascaded shadows, which the sky module draws: install sky() and set look.shadow.set({ cascades: 2 })'); };
}

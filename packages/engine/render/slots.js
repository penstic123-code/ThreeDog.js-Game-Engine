import { codedError } from '../core/errorHints.js';
// Semantic patch slots: the one table that says where a patch's code goes. A patch names a slot ('position', 'color', 'lighting'...),
// this table maps the slot to a GLSL injection point today (a three.js `#include <chunk>` plus before / after / replace) and, in the
// WebGPU phase, to a NodeMaterial property (`node`, informational until then: docs/plans/2026-11-03-webgpu-phase2.md §2.2).
// Why one table: patches, built-in effects (wind / cloud shadow / season / detail / lighting / CSM), error messages and the recipe 43 table all read from here,
// phase 2 fills only the node column and patches need no change; the anchor strings appear once here, not scattered across effects each writing their own.
// Raw anchors (`glsl: { vertex|fragment: { <chunk>: code } }`) stay as the expert exit: plain three.js knowledge, WebGL only.
/** @typedef {{ stage: 'vertex' | 'fragment', anchor: string, at: 'after' | 'before' | 'replace', shadowOnly?: boolean, scope: string, meaning: string, node: string }} Slot */

/** @type {Record<string, Slot>} */
export const SLOTS = {
  position:       { stage: 'vertex', anchor: 'begin_vertex', at: 'after', node: 'positionNode',
    scope: 'transformed (vec3, object space, write), position, normal, uv',
    meaning: 'move vertices in object space, before skinning / instancing / the model matrix' },
  shadowPosition: { stage: 'vertex', anchor: 'begin_vertex', at: 'after', shadowOnly: true, node: 'castShadowPositionNode',
    scope: 'transformed (vec3, object space, write), position',
    meaning: 'vertex code for the shadow passes only (depth / point-light distance), replacing this patch\'s position code there' },
  clipPosition:   { stage: 'vertex', anchor: 'project_vertex', at: 'after', node: 'vertexNode',
    scope: 'transformed, mvPosition (view space), gl_Position (clip space, write)',
    meaning: 'after projection: snap or offset on screen, or write world-space varyings' },
  map:            { stage: 'fragment', anchor: 'map_fragment', at: 'after', node: 'colorNode (before vertex colors)',
    scope: 'diffuseColor (vec4, write; the map applied, vertex colors not yet)',
    meaning: 'the base color / texture, before vertex colors and every color patch' },
  color:          { stage: 'fragment', anchor: 'color_fragment', at: 'after', node: 'colorNode',
    scope: 'diffuseColor (vec4, write; map and vertex colors already applied), vUv when the material has a map',
    meaning: 'the surface (diffuse) color before lighting' },
  normal:         { stage: 'fragment', anchor: 'normal_fragment_maps', at: 'after', node: 'normalNode',
    scope: 'normal (vec3, view space, write), faceDirection, vViewPosition',
    meaning: 'the shading normal (bump, detail) after normal / bump maps' },
  roughness:      { stage: 'fragment', anchor: 'roughnessmap_fragment', at: 'after', node: 'roughnessNode',
    scope: 'roughnessFactor (float, write); MeshStandard / MeshPhysical only',
    meaning: 'roughness after the roughness map' },
  emissive:       { stage: 'fragment', anchor: 'emissivemap_fragment', at: 'after', node: 'emissiveNode',
    scope: 'totalEmissiveRadiance (vec3, write), diffuseColor',
    meaning: 'emitted light after the emissive map' },
  lightsPars:     { stage: 'fragment', anchor: 'shadowmap_pars_fragment', at: 'after', node: '(TSL Fn)',
    scope: 'declarations; three\'s light structs, getShadow() and directionalLights[] are already declared',
    meaning: 'functions that call three\'s light / shadow helpers (pars goes before them)' },
  lightingModel:  { stage: 'fragment', anchor: 'lights_fragment_begin', at: 'replace', node: 'LightingModel (setupLightingModel)',
    scope: 'geometryPosition, geometryNormal, material, reflectedLight; your code replaces three\'s light loop',
    meaning: 'replace how lights are summed (one patch per material may take it)' },
  lighting:       { stage: 'fragment', anchor: 'lights_fragment_end', at: 'after', node: 'lightsNode (wrapped)',
    scope: 'reflectedLight.directDiffuse / directSpecular / indirectDiffuse (write), normal, diffuseColor, vViewPosition',
    meaning: 'after lights are summed: cloud shadows, wrap, shadow tint, rim' },
  output:         { stage: 'fragment', anchor: 'opaque_fragment', at: 'before', node: 'outputNode',
    scope: 'outgoingLight (vec3, write), diffuseColor.a',
    meaning: 'the final lit color, before fog and tone mapping' },
  // fog as two slots, like lightsPars / lightingModel: functions cannot sit inside main(), and they must come after three's fog uniforms
  // (declared in fog_pars_fragment), which the top-of-shader pars precedes. The sky's custom fog kinds and look.fog's hook go through these
  // (modules/sky/fog.js) instead of rewriting THREE.ShaderChunk.fog_* for the whole page
  fogPars:        { stage: 'fragment', anchor: 'fog_pars_fragment', at: 'after', node: 'fogNode (TSL Fn)',
    scope: 'declarations; fogColor and fogNear / fogFar or fogDensity are already declared (inside #ifdef USE_FOG)',
    meaning: 'fog functions that read three\'s fog uniforms (wrap them in #ifdef USE_FOG)' },
  fog:            { stage: 'fragment', anchor: 'fog_fragment', at: 'replace', node: 'fogNode',
    scope: 'gl_FragColor (write, tone mapped already), fogColor, vFogDepth, fogNear / fogFar or fogDensity (inside #ifdef USE_FOG)',
    meaning: 'replace how fog mixes into the final color (one patch per material may take it)' },
};
export const SLOT_NAMES = Object.keys(SLOTS);

const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
/** Whether a patch uses the slot form (slot: / glsl keyed by slot names) rather than raw anchors (glsl: { vertex, fragment }) */
const slotForm = p => p.slot != null || typeof p.glsl === 'string' || (isObj(p.glsl) && !('vertex' in p.glsl) && !('fragment' in p.glsl));
const EXIT = "or the raw-anchor exit glsl: { vertex|fragment: { <three.js chunk>: code } } (WebGL only)";

/** Marker comments around injected code, so a compile error can be traced back to the patch and slot (render/shaderErrors.js) */
const mark = (patch, slot, code) => `// threedog:begin patch=${patch} slot=${slot}\n${code}\n// threedog:end`;

/**
 * Turn a slot-form patch into the raw-anchor form patches.js applies (one internal representation, so shadows, conflicts and
 * cacheKey checks work the same for both). Raw-form patches come back with their code marked (slot=<chunk>). Throws on an unknown slot.
 *   { name, slot: 'color', glsl: 'code', pars? }              one slot
 *   { name, glsl: { position: 'code', color: 'code' }, pars? } several slots
 *   pars: declarations at the top of every stage the patch touches, or { vertex, fragment } to place them per stage.
 * @internal patches.js
 * @param {any} p
 * @returns {any} a new patch object (p itself is not changed)
 */
export function toAnchors(p) {
  if (!p || typeof p !== 'object') return p;
  if (!slotForm(p)) {
    if (p.pars !== undefined) throw codedError('shader-patch', `[threedog] patch '${p.name}': top-level pars goes with slot names; in the raw-anchor form put it at glsl.vertex.pars / glsl.fragment.pars`);
    if (p.glsl == null) return p;
    const glsl = {};
    for (const st of ['vertex', 'fragment']) if (p.glsl[st]) {
      glsl[st] = {};
      for (const [k, c] of Object.entries(p.glsl[st])) glsl[st][k] = k === 'pars' ? c : typeof c === 'string' ? mark(p.name, k, c)
        : { ...c, ...(c.before ? { before: mark(p.name, k, c.before) } : {}), ...(c.after ? { after: mark(p.name, k, c.after) } : {}), ...(c.replace != null ? { replace: mark(p.name, k, c.replace) } : {}) };
    }
    const extra = Object.keys(p.glsl).filter(k => k !== 'vertex' && k !== 'fragment');
    if (extra.length) throw codedError('shader-patch', `[threedog] patch '${p.name}' mixes raw stages (vertex / fragment) with '${extra.join("', '")}'; use slot names only: ${SLOT_NAMES.join(' | ')}, ${EXIT}`);
    return { ...p, glsl };
  }
  /** @type {Record<string, string>} */
  let bySlot;
  if (p.slot != null) {
    if (typeof p.glsl !== 'string') throw codedError('shader-patch', `[threedog] patch '${p.name}' names slot '${p.slot}', so glsl is that slot's code as a string; for several slots write glsl: { ${SLOT_NAMES[0]}: '...', color: '...' }`);
    bySlot = { [p.slot]: p.glsl };
  } else if (typeof p.glsl === 'string') throw codedError('shader-patch', `[threedog] patch '${p.name}' has glsl code but no slot; add slot: ${SLOT_NAMES.join(' | ')}, ${EXIT}`);
  else bySlot = p.glsl;
  const glsl = { vertex: {}, fragment: {} }, shadow = {}, used = new Set();
  for (const [name, code] of Object.entries(bySlot)) {
    const s = SLOTS[name];
    if (!s) throw codedError('shader-patch', `[threedog] patch '${p.name}': unknown slot '${name}'; use ${SLOT_NAMES.join(' | ')}, ${EXIT}`);
    if (typeof code !== 'string') throw codedError('shader-patch', `[threedog] patch '${p.name}' slot '${name}' must be GLSL code as a string; got ${typeof code}`);
    const marked = mark(p.name, name, code);
    if (s.shadowOnly) { shadow[s.anchor] = marked; used.add('vertex'); continue; }
    glsl[s.stage][s.anchor] = s.at === 'after' ? marked : { [s.at]: marked };
    used.add(s.stage);
  }
  if (p.pars != null) {
    // pars goes first in each stage: same JSON as the hand-written anchor form { pars, <chunk>: code }, so the cacheKey "same key, same code" check recognizes it as the same piece
    const put = (st, text) => { glsl[st] = { pars: text, ...glsl[st] }; };
    if (typeof p.pars === 'string') for (const st of used) put(st, p.pars);
    else if (isObj(p.pars)) for (const st of /** @type {const} */ (['vertex', 'fragment'])) { if (p.pars[st]) put(st, p.pars[st]); }
    else throw codedError('shader-patch', `[threedog] patch '${p.name}': pars is GLSL declarations as a string, or { vertex, fragment }`);
  }
  const { slot, pars, ...rest } = p;
  const out = { ...rest, glsl: { ...(Object.keys(glsl.vertex).length ? { vertex: glsl.vertex } : {}), ...(Object.keys(glsl.fragment).length ? { fragment: glsl.fragment } : {}) } };
  // shadowPosition: code only for the depth / distance materials (patches.js shadowMaterial), so the patch counts as moving its shadow
  if (Object.keys(shadow).length) { out.shadowVertex = shadow; out.shadow = true; }
  return out;
}

/** The slot table as a markdown table; recipe 43 holds a copy that threedog check R42 compares (it imports this) @internal */
export const slotTable = () => ['| slot | GLSL (WebGL, today) | WebGPU node (phase 2) | in scope | meaning |', '|---|---|---|---|---|',
  ...SLOT_NAMES.map(n => { const s = SLOTS[n]; return `| \`${n}\` | ${s.at} \`${s.anchor}\`${s.shadowOnly ? ' (shadow passes)' : ''} | \`${s.node}\` | ${s.scope} | ${s.meaning} |`; })].join('\n');

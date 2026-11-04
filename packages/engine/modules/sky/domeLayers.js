// Extra sky layers drawn on the dome after the clouds and stars (rainbow, aurora, a painted band): engine.sky.layer(name, spec).
// Default none, and then the dome shader text is exactly the plain one.
//   layers: [{ glsl, uniforms?, order?, blend? }]
//   glsl     defines `vec4 threedogSkyLayer(vec3 dir, float time, vec3 sunDir, float night)`: dir = unit view direction (whole sphere,
//            dir.y < 0 below the horizon), time = engine.uniforms.uTime seconds, sunDir toward the sun, night 0 day .. 1 night;
//            returns (rgb, amount). Each layer's function is renamed (threedogSkyLayer0, 1...), so layers never clash.
//   uniforms like clouds.uniforms (render/uniformDecl.js): { uK: 0.4, uTint: new THREE.Color(...), uMap: texture } -> engine.sky.uniforms.uK
//   order    draw order among layers (smaller first, default 0, ties keep list order)
//   blend    'mix' (default: col = mix(col, rgb, amount)) | 'add' (col += rgb * amount: glows such as an aurora)
//   tsl      the WebGPURenderer form (render/fx/sky.tsl.js): (ctx) => vec4 node (rgb, amount), ctx = { dir, time, sunDir, night, color (the sky
//            so far, vec3), uniforms (the dome's uniforms as nodes, the layer's own included), fx: { noise, hash }, tsl (three/tsl) }. Each
//            renderer needs its own form; a layer without it throws by name there.
// In scope: threedogHash(vec2), threedogNoise(vec2) and the dome's uniforms (uTop, uHorizon, uSunColor, uCloud...).
import { readParams, keysSchema, isOptions } from '../../core/params.js';
import { declareUniforms } from '../../render/uniformDecl.js';
import { codedError } from '../../core/errorHints.js';

const KEYS = ['glsl', 'tsl', 'uniforms', 'order', 'blend', 'name'];   // name: the layer's name for engine.sky.layer(name, ...)

/**
 * Check the layer list and return { uniforms, decl, body } for the GLSL dome (empty strings without layers) and `layers` ({ tsl, blend, where }
 * in draw order) for the node dome.
 * @param {any[]} list @param {{ gpu?: boolean, names?: string[] }} [o] gpu: the dome is a node material (tsl drawn, glsl optional);
 *   names: the layer names per entry, so an error says engine.sky.layer('<name>') instead of the index
 */
export function resolveDomeLayers(list, { gpu = false, names } = {}) {
  if (list == null) return { uniforms: {}, decl: '', body: '', layers: [] };
  if (!Array.isArray(list)) throw codedError('sky-option', 'dome layers must be an array of { glsl, uniforms?, order?, blend? }; see modules/sky/domeLayers.js');
  const uniforms = {}, decl = [], body = [], layers = [];
  list.map((l, i) => ({ l, i })).sort((a, b) => (a.l?.order ?? 0) - (b.l?.order ?? 0) || a.i - b.i).forEach(({ l, i }, n) => {
    const where = names?.[i] != null ? `engine.sky.layer('${names[i]}')` : `dome layer ${i}`;
    if (isOptions(l)) readParams(where, keysSchema(KEYS), l);
    if (l?.tsl != null && typeof l.tsl !== 'function') throw codedError('sky-option', `${where}.tsl must be (ctx) => vec4 node (WebGPURenderer); see modules/sky/domeLayers.js`);
    if (l?.glsl == null && l?.tsl != null && !gpu) throw codedError('sky-option', `${where} has only a tsl form, which WebGLRenderer cannot draw: give glsl too ({ glsl, tsl })`);
    // gpu: the glsl may be left out (render/fx/sky.tsl.js names a layer that has no tsl); when given it is checked all the same
    if ((l?.glsl != null || !gpu) && (typeof l?.glsl !== 'string' || !/vec4\s+threedogSkyLayer\s*\(/.test(l.glsl)))
      throw codedError('sky-option', `${where}.glsl must be GLSL that defines \`vec4 threedogSkyLayer(vec3 dir, float time, vec3 sunDir, float night)\` returning (rgb, amount 0..1)`);
    const blend = l.blend ?? 'mix';
    if (blend !== 'mix' && blend !== 'add') throw codedError('sky-option', `${where}.blend must be 'mix' or 'add'; got '${blend}'`);
    const u = declareUniforms(`${where}.uniforms`, l.uniforms);
    Object.assign(uniforms, u.uniforms);
    layers.push({ tsl: l.tsl, blend, where });
    if (gpu) return;
    decl.push(u.decl, l.glsl.replace(/\bthreedogSkyLayer\b/g, `threedogSkyLayer${n}`));
    body.push(`\n  { vec4 L = threedogSkyLayer${n}(d, uTime, uSunDir, uNight); col ${blend === 'add' ? '+= L.rgb * L.a' : '= mix(col, L.rgb, L.a)'}; }`);
  });
  return { uniforms, decl: decl.join('\n'), body: body.join(''), layers };
}

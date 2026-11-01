// Extra sky layers drawn on the dome after the clouds and stars (rainbow, aurora, a painted band): style.sky.layers / sky({ layers }).
// Default none, and then the dome shader text is exactly the plain one.
//   layers: [{ glsl, uniforms?, order?, blend? }]
//   glsl     defines `vec4 threedogSkyLayer(vec3 dir, float time, vec3 sunDir, float night)`: dir = unit view direction (whole sphere,
//            dir.y < 0 below the horizon), time = engine.uniforms.uTime seconds, sunDir toward the sun, night 0 day .. 1 night;
//            returns (rgb, amount). Each layer's function is renamed (threedogSkyLayer0, 1...), so layers never clash.
//   uniforms like clouds.uniforms (render/uniformDecl.js): { uK: 0.4, uTint: new THREE.Color(...), uMap: texture } -> engine.sky.uniforms.uK
//   order    draw order among layers (smaller first, default 0, ties keep list order)
//   blend    'mix' (default: col = mix(col, rgb, amount)) | 'add' (col += rgb * amount: glows such as an aurora)
// In scope: threedogHash(vec2), threedogNoise(vec2) and the dome's uniforms (uTop, uHorizon, uSunColor, uCloud...).
import { checkOptions } from '../../core/validate.js';
import { declareUniforms } from '../../render/uniformDecl.js';

const KEYS = ['glsl', 'uniforms', 'order', 'blend'];

/** Check the layer list and return { uniforms, decl, body } for the dome shader (empty strings without layers) */
export function resolveDomeLayers(list) {
  if (list == null) return { uniforms: {}, decl: '', body: '' };
  if (!Array.isArray(list)) throw new Error('style.sky.layers must be an array of { glsl, uniforms?, order?, blend? }; see modules/sky/domeLayers.js');
  const uniforms = {}, decl = [], body = [];
  list.map((l, i) => ({ l, i })).sort((a, b) => (a.l?.order ?? 0) - (b.l?.order ?? 0) || a.i - b.i).forEach(({ l, i }, n) => {
    const where = `style.sky.layers[${i}]`;
    checkOptions(where, l, KEYS);
    if (typeof l?.glsl !== 'string' || !/vec4\s+threedogSkyLayer\s*\(/.test(l.glsl))
      throw new Error(`${where}.glsl must be GLSL that defines \`vec4 threedogSkyLayer(vec3 dir, float time, vec3 sunDir, float night)\` returning (rgb, amount 0..1)`);
    const blend = l.blend ?? 'mix';
    if (blend !== 'mix' && blend !== 'add') throw new Error(`${where}.blend must be 'mix' or 'add'; got '${blend}'`);
    const u = declareUniforms(`${where}.uniforms`, l.uniforms);
    Object.assign(uniforms, u.uniforms); decl.push(u.decl, l.glsl.replace(/\bthreedogSkyLayer\b/g, `threedogSkyLayer${n}`));
    body.push(`\n  { vec4 L = threedogSkyLayer${n}(d, uTime, uSunDir, uNight); col ${blend === 'add' ? '+= L.rgb * L.a' : '= mix(col, L.rgb, L.a)'}; }`);
  });
  return { uniforms, decl: decl.join('\n'), body: body.join('') };
}

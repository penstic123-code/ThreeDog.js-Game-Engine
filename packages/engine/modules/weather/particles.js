// Weather particle systems (recipes/44). Built-in rain and snow are two specs of one falling-particle system; a game draws a field of its
// own table (ash, petals, sparks) with engine.weather.define(field, spec), and the same call replaces rain or snow. The amount each frame is
// weather.current[field], so the table's smooth blending drives particles too.
//
// spec (style.weather.rain / snow, or define): shape 'line' (streaks that slant with the wind) | 'round' | 'soft' | 'square' (point sprites
// that drift), texture (asset name, sprites only), color, opacity, size / maxSize (sprite size and pixel cap), length (line meters),
// speed (fall m/s), slant (line lean per unit of wind), sway (sprite drift meters), count, density (amount 0..1 -> share of particles drawn),
// glsl: { vertex, fragment } (whole shader text; copy from shaders.js), uniforms (for your glsl);
// or create(engine, { area, count }) => { object, update?(amount, ctx) } for a system of your own (the engine adds it, shows it while the
// amount is above 0.02 and calls update every frame with ctx = { camera, time, wind }).
import * as THREE from 'three';
import { checkOptions, closest, warnOnce } from '../../core/validate.js';
import { declareUniforms } from '../../render/uniformDecl.js';
import { lineVert, lineFrag, pointVert, pointFrag, SHAPES, shaderMat, scatter } from './shaders.js';

const SPEC_KEYS = ['shape', 'texture', 'color', 'opacity', 'size', 'maxSize', 'length', 'speed', 'slant', 'sway', 'count', 'density', 'glsl', 'uniforms', 'create'];
const SHAPE_LIST = ['line', ...Object.keys(SHAPES)];
// The built-in looks (a style's weather.rain / snow fills in over them); a defined field starts from DRIFT
export const RAIN = { shape: 'line', color: 0xc8c8c8, opacity: 0.55, length: 0.7, speed: 22, slant: 1, size: 14, maxSize: 8, sway: 1.5, density: a => Math.min(1, a * 1.2) };
export const SNOW = { shape: 'round', color: 0xffffff, opacity: 0.9, size: 20, maxSize: 5, speed: 1.6, sway: 1.5, density: () => 1 };
const DRIFT = { ...SNOW, opacity: 1 };

/**
 * Build one particle system for a weather field and add it to the scene (hidden until its amount rises)
 * @internal
 * @param {any} engine
 * @param {string} field
 * @param {Record<string, any>} spec the given keys (checked here) over the defaults
 * @param {{ area: number, count: number, base?: Record<string, any> }} ctx
 */
export function makeSystem(engine, field, spec, { area, count, base = DRIFT }) {
  const where = `weather particles '${field}'`;
  checkOptions(where, spec, SPEC_KEYS);
  const s = { ...base, ...spec, shape: spec.shape ?? (spec.texture ? 'round' : base.shape) };
  const n = Math.max(1, Math.round(spec.count ? (engine.tier === 'low' ? spec.count / 2 : spec.count) : count));
  if (s.create) {
    const own = s.create(engine, { area, count: n });
    if (!own?.object?.isObject3D) throw new Error(`${where}: create must return { object: THREE.Object3D, update?(amount, { camera, time, wind }) }`);
    return finish(engine, field, { field, object: own.object, uniforms: null, update: own.update?.bind(own) ?? null, own: true });
  }
  if (!SHAPE_LIST.includes(s.shape)) throw new Error(`${where}: shape '${s.shape}' must be ${SHAPE_LIST.map(k => `'${k}'`).join(' | ')}` + (closest(s.shape, SHAPE_LIST) ? ` (did you mean '${closest(s.shape, SHAPE_LIST)}'?)` : ''));
  if (typeof s.density !== 'function') throw new Error(`${where}: density must be a function amount (0..1) => share of particles drawn (0..1), e.g. density: a => a * a`);
  const line = s.shape === 'line', custom = declareUniforms(`${where}.uniforms`, s.uniforms);
  const u = { uCam: { value: new THREE.Vector3() }, uSize: { value: area }, uFallOff: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(s.color) }, ...custom.uniforms };
  const geo = new THREE.BufferGeometry(), p3 = scatter(n * 3, area);
  if (line) {
    // each streak is two vertices at the same point; aEnd marks the tail the shader pulls back along the fall
    const rp = new Float32Array(n * 6), re = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { rp.set(p3.subarray(i * 3, i * 3 + 3), i * 6); rp.set(p3.subarray(i * 3, i * 3 + 3), i * 6 + 3); re[i * 2 + 1] = 1; }
    geo.setAttribute('position', new THREE.BufferAttribute(rp, 3)); geo.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
    Object.assign(u, { uWindDir: { value: new THREE.Vector2(1, 0.3) }, uLen: { value: s.length } });
  } else {
    geo.setAttribute('position', new THREE.BufferAttribute(p3, 3));
    Object.assign(u, { uPx: { value: s.size }, uMaxPx: { value: s.maxSize }, uSway: { value: 0 }, uSwayAmp: { value: s.sway }, uMap: { value: null }, uUseMap: { value: 0 } });
    if (s.texture) engine.assets.texture(s.texture).then(t => { u.uMap.value = t; u.uUseMap.value = 1; }).catch(err => warnOnce(err.message));
  }
  const g = s.glsl || {};
  if (s.glsl !== undefined) checkOptions(`${where}.glsl`, g, ['vertex', 'fragment']);
  const vert = g.vertex ?? (line ? lineVert : pointVert), frag = g.fragment ?? (line ? lineFrag : pointFrag(s.shape));
  const mat = shaderMat(custom.decl ? custom.decl + '\n' + vert : vert, custom.decl ? custom.decl + '\n' + frag : frag, u);
  const object = line ? new THREE.LineSegments(geo, mat) : new THREE.Points(geo, mat);
  return finish(engine, field, { field, object, uniforms: u, spec: s, count: n, line, update: null, own: false });
}

function finish(engine, field, sys) {
  const o = sys.object;
  o.frustumCulled = false; o.visible = false; o.userData.budgetTag = 'weather'; o.name ||= 'weather-' + field;
  engine.scene.add(o);
  return sys;
}

/**
 * Per frame: amount = weather.current[field]; falling particles follow the camera, fall and drift with wrapped time (see shaders.js)
 * @internal
 */
export function updateSystem(sys, amount, camera, t, wind) {
  sys.object.visible = amount > 0.02;
  if (sys.own) { sys.update?.(amount, { camera, time: t, wind }); return; }
  const u = sys.uniforms, s = sys.spec;
  u.uFallOff.value = (t * s.speed) % u.uSize.value;
  u.uCam.value.copy(camera.position);
  u.uOpacity.value = amount * s.opacity;
  sys.object.geometry.setDrawRange(0, Math.floor(sys.count * Math.min(1, Math.max(0, s.density(amount)))) * (sys.line ? 2 : 1));
  if (sys.line) u.uWindDir.value.set(wind * s.slant, wind * s.slant * 0.3);
  else u.uSway.value = t % (20 * Math.PI);
}

/** Remove a system's object and free its GPU data @internal */
export function dropSystem(engine, sys) {
  engine.scene.remove(sys.object);
  if (!sys.own) { sys.object.geometry.dispose(); sys.object.material.dispose(); }
}

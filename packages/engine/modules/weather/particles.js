// Weather particle systems (recipes/44). Built-in rain and snow are two specs of one falling-particle system; a game draws a field of its
// own table (ash, petals, sparks) with engine.weather.defineField(field, spec), and the same call replaces rain or snow. The amount each frame is
// weather.current[field], so the table's smooth blending drives particles too.
//
// spec (weather({ rain, snow }), or defineField): shape 'line' (streaks that slant with the wind) | 'round' | 'soft' | 'square' (point sprites
// that drift), texture (asset name, sprites only), color, opacity, size / maxSize (sprite size and pixel cap), length (line meters),
// speed (fall m/s), slant (line lean per unit of wind), sway (sprite drift meters), count, density (amount 0..1 -> share of particles drawn),
// glsl: { vertex, fragment } (whole shader text; copy from shaders.js), uniforms (for your glsl);
// or create(engine, { area, count }) => { object, update?(amount, ctx) } for a system of your own (the engine adds it, shows it while the
// amount is above 0.02 and calls update every frame with ctx = { camera, time, wind }).
import { engineOwned } from '../../core/scene/things.js';
import * as THREE from 'three';
import { closest, needMaterial } from '../../core/base/validate.js';
import { readParams, keysSchema } from '../../core/base/params.js';
import { declareUniforms } from '../../render/uniformDecl.js';
import { lineVert, lineFrag, pointVert, pointFrag, SHAPES, shaderMat, scatter } from './shaders.js';
import { codedError } from '../../core/base/errorHints.js';
import { isWebGPU, webgpuPart } from '../../render/backend.js';

const SPEC_KEYS = ['shape', 'texture', 'color', 'opacity', 'size', 'maxSize', 'length', 'speed', 'slant', 'sway', 'count', 'density', 'glsl', 'uniforms', 'create'];
const SHAPE_LIST = ['line', ...Object.keys(SHAPES)];
// The built-in pictures (weather({ rain, snow }) fills in over them); a defined field starts from DRIFT
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
  readParams(where, keysSchema(SPEC_KEYS), spec);
  const s = { ...base, ...spec, shape: spec.shape ?? (spec.texture ? 'round' : base.shape) };
  const n = Math.max(1, Math.round(spec.count || count));
  if (s.create) {
    const own = s.create(engine, { area, count: n });
    if (!own?.object?.isObject3D) throw codedError('weather-option', `${where}: create must return { object: THREE.Object3D, update?(amount, { camera, time, wind }) }`);
    return finish(engine, field, { field, object: own.object, uniforms: null, update: own.update?.bind(own) ?? null, own: true });
  }
  if (!SHAPE_LIST.includes(s.shape)) throw codedError('weather-option', `${where}: shape '${s.shape}' must be ${SHAPE_LIST.map(k => `'${k}'`).join(' | ')}` + (closest(s.shape, SHAPE_LIST) ? ` (did you mean '${closest(s.shape, SHAPE_LIST)}'?)` : ''));
  if (typeof s.density !== 'function') throw codedError('weather-option', `${where}: density must be a function amount (0..1) => share of particles drawn (0..1), e.g. density: a => a * a`);
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
    if (s.texture) engine.assets.useTexture(s.texture, t => { u.uMap.value = t; u.uUseMap.value = 1; }, { where: 'weather particles', instead: 'plain streaks show instead' });
  }
  const gpu = nodeSide(engine, where, s.glsl);
  if (gpu) return finish(engine, field, { field, object: line ? new THREE.LineSegments(geo, gpu.weatherLines(u)) : gpu.weatherPoints(u, geo, s.shape), uniforms: u, spec: s, count: n, line, update: null, own: false });
  const g = s.glsl || {};
  if (s.glsl !== undefined) readParams(`${where}.glsl`, keysSchema(['vertex', 'fragment']), g);
  const vert = g.vertex ?? (line ? lineVert : pointVert), frag = g.fragment ?? (line ? lineFrag : pointFrag(s.shape));
  const mat = shaderMat(custom.decl ? custom.decl + '\n' + vert : vert, custom.decl ? custom.decl + '\n' + frag : frag, u);
  const object = line ? new THREE.LineSegments(geo, mat) : new THREE.Points(geo, mat);
  return finish(engine, field, { field, object, uniforms: u, spec: s, count: n, line, update: null, own: false });
}

/** The node-material side (render/fx/particles.tsl.js, loaded with threedog/tsl) on WebGPURenderer, else null; GLSL text has no WebGPU form */
function nodeSide(engine, where, glsl) {
  if (!isWebGPU(engine.renderer)) return null;
  if (glsl !== undefined) throw codedError('webgpu-needs-tsl', `${where}: glsl is GLSL text, which WebGPURenderer cannot compile; give a TSL version: create(engine) returning your own object with a node material`);
  return webgpuPart('particles', `${where}: the weather particle material`);
}

function finish(engine, field, sys) {
  const o = sys.object, mine = o.material;
  o.frustumCulled = false; o.visible = false; o.userData.budgetTag = 'weather'; o.name ||= 'weather-' + field;
  engine.scene.add(engineOwned('weather', o));
  sys.given = null;   // the game's material while one is set
  sys.engineMaterial = mine;
  Object.defineProperty(sys, 'material', { enumerable: true, get: () => o.material ?? null, set(m) {
    if (sys.own) throw codedError('weather-option', `weather particles '${field}': this object came from create(), so its material is yours: write it on the object`);
    if (m != null) needMaterial('weather-option', `weather particles '${field}': material`, m, " (null gives the engine's back)");
    sys.given = m || null;
    o.material = m ?? mine;
  } });
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
  const drawn = Math.floor(sys.count * Math.min(1, Math.max(0, s.density(amount))));
  if (sys.object.isSprite) sys.object.count = drawn;   // WebGPU snow: one sprite instance per flake
  else sys.object.geometry.setDrawRange(0, drawn * (sys.line ? 2 : 1));
  if (sys.line) u.uWindDir.value.set(wind * s.slant, wind * s.slant * 0.3);
  else u.uSway.value = t % (20 * Math.PI);
}

/** Remove a system's object and free its GPU data @internal */
export function dropSystem(engine, sys) {
  engine.scene.remove(sys.object);
  if (!sys.own) { sys.object.geometry.dispose(); sys.engineMaterial.dispose(); }   // a material the game set stays the game's
}

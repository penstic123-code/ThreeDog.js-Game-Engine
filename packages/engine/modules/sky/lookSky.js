// look.sky: the sky dome as a look part.
//   set({ clouds: { coverage, scale, speed, opacity, softness, color, shade }, backdrop })   live uniforms of the dome; backdrop = one flat color instead of the dome
//   patch('clouds', glsl)                       the cloud function threedogClouds (clouds.js); null gives the style / built-in kind back
//   patch('layer:<name>', glsl | { glsl, uniforms, order, blend })   add or change a named dome layer (domeLayers.js); null removes it
//   replace(skybox name | Texture | Object3D)   the dome gives way to a panorama or your own background object; null gives the dome back
// Layers used to be an array addressed by index (style.sky.layers); they are named now. A style's array entries are named by their `name` key, else layer0, layer1 ...
// A hook change rebuilds the dome shader text and recompiles that one material (a hitch, so do it at a scene change, not every frame).
import * as THREE from 'three';
import { defineLookPart, REPLACE } from '../../core/look/part.js';
import { resolveClouds } from './clouds.js';
import { resolveDomeLayers } from './domeLayers.js';
import { domeFragment, loadSkybox } from './shader.js';
import { domeFog } from './fog.js';
import { resolveBackdrop } from './look.js';

const LAYER = 'layer:';
const CLOUD_KEYS = { 'clouds.coverage': 'uCloudCover', 'clouds.scale': 'uCloudScale', 'clouds.speed': 'uCloudSpeed', 'clouds.opacity': 'uCloudOpacity',
  'clouds.softness': 'uCloudSoft', 'clouds.color': 'uCloudColor', 'clouds.shade': 'uCloudShade' };
const isColorLike = v => typeof v === 'number' || typeof v === 'string' || !!v?.isColor;
const glslOf = v => (typeof v === 'string' ? v : v?.glsl);

/** @param {any} sky @param {object} st style.sky merged with the sky({ ... }) options */
export function defineSkyLook(sky, st) {
  const e = sky.engine, scene = e.scene, U = sky.uniforms;
  let part, added = null;
  const layers = new Map((Array.isArray(st.layers) ? st.layers : []).map((l, i) => [l?.name ?? `layer${i}`, l]));

  // The dome shader from the current clouds function and layers; throws (changing nothing) when a hook is not valid GLSL for its contract
  const rebuild = (cloudsHook, map) => {
    const cl = resolveClouds({ ...(st.clouds ?? {}), glsl: glslOf(cloudsHook), uniforms: { ...(st.clouds?.uniforms), ...(cloudsHook?.uniforms) } });
    const l = resolveDomeLayers([...map.values()].map(v => (typeof v === 'string' ? { glsl: v } : v)));
    const f = 'uFogColor' in U ? domeFog({ color: 'fog' }) : { decl: '', body: '' };   // the fog band exists only when the start fog color was not 'horizon'
    const text = domeFragment(cl, { decl: [f.decl, l.decl].filter(Boolean).join('\n'), body: f.body + l.body });
    return { text, uniforms: { ...cl.uniforms, ...l.uniforms } };
  };
  const apply = r => {
    for (const [k, u] of Object.entries(r.uniforms)) if (!(k in U)) U[k] = u;
    if (sky.dome.material.fragmentShader === r.text) return;
    sky.dome.material.fragmentShader = r.text; sky.dome.material.needsUpdate = true;
  };

  const setBackdrop = v => {
    if (v == null) { sky._backdrop = null; sky.dome.visible = !sky.skybox && !added; scene.background = sky.skybox ?? null; return; }
    sky._backdrop = resolveBackdrop({ backdrop: v });   // the sky writes scene.background and hides the dome each frame (frame.js)
  };

  const hooks = { clouds: { signature: 'vec4 threedogClouds(vec3 dir, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cover)', scope: ['threedogHash', 'threedogNoise', 'uCloud* uniforms'],
    example: 'vec4 threedogClouds(vec3 d, float t, vec3 s, float night, vec3 lit, vec3 shade, float cover){ return vec4(lit, step(0.5, threedogNoise(d.xz * 4.0)) * cover); }' },
  [LAYER + '<name>']: { signature: 'vec4 threedogSkyLayer(vec3 dir, float time, vec3 sunDir, float night)', scope: ['threedogHash', 'threedogNoise', 'uTop', 'uHorizon', 'uSunColor ...'],
    example: "look.sky.patch('layer:aurora', { glsl: 'vec4 threedogSkyLayer(vec3 d, float t, vec3 s, float n){ return vec4(0.2, 1.0, 0.5, n * smoothstep(0.1, 0.6, d.y) * 0.4); }', blend: 'add' })" } };
  // layer:<name> takes any name: the spec lists one documented entry, the check accepts the prefix
  const hookSpec = new Proxy(hooks, { has: (t, k) => k in t || (typeof k === 'string' && /^layer:[\w-]+$/.test(k)) });

  const cloudDesc = { coverage: 'cloud amount 0..1+ (also follows the weather)', scale: 'cloud size (smaller = bigger clouds)', speed: 'drift [x, z] per second', opacity: 'cloud opacity',
    softness: 'edge softness', color: 'lit side color', shade: 'shaded side color' };
  const num = d => ({ type: 'number', min: 0, cost: 'uniform', neutral: true, desc: d });
  part = defineLookPart(e, {
    id: 'sky', group: 'atmosphere', module: 'sky', object: () => sky.dome, applyAtStart: false, docs: ['recipes/52-look.md', 'recipes/36-style.md'],
    params: {
      // all neutral: with coverage 0 (no clouds unless the style gives them) nothing of these is drawn
      'clouds.coverage': { ...num(cloudDesc.coverage), neutral: true, default: 0 },
      'clouds.scale': { ...num(cloudDesc.scale), neutral: true, default: 0.35 },
      'clouds.speed': { type: 'array', default: [0.004, 0.002], neutral: true, cost: 'uniform', desc: cloudDesc.speed },
      'clouds.opacity': { ...num(cloudDesc.opacity), neutral: true, default: 0.9 },
      'clouds.softness': { ...num(cloudDesc.softness), neutral: true, default: 0.3 },
      'clouds.color': { type: 'any', default: '#f4f4f4', neutral: true, cost: 'uniform', desc: cloudDesc.color },
      'clouds.shade': { type: 'any', default: '#aaaaaa', neutral: true, cost: 'uniform', desc: cloudDesc.shade },
      backdrop: { type: 'any', default: null, neutral: true, cost: 'uniform', desc: 'a flat color (or (sky) => color) in place of the dome: no gradient, sun, moon, stars or clouds; null = the dome',
        check: v => (isColorLike(v) || typeof v === 'function' ? null : `must be a color (0xefebe4, '#efebe4') or (sky) => color; got ${JSON.stringify(v)}`) },
    },
    style: () => ({
      'clouds.coverage': U.uCloudCover.value, 'clouds.scale': U.uCloudScale.value, 'clouds.speed': U.uCloudSpeed.value.toArray(), 'clouds.opacity': U.uCloudOpacity.value,
      'clouds.softness': U.uCloudSoft.value, 'clouds.color': '#' + U.uCloudColor.value.getHexString(), 'clouds.shade': '#' + U.uCloudShade.value.getHexString(),
      ...(st.backdrop != null ? { backdrop: st.backdrop } : {}),
      ...(st.clouds?.glsl ? { 'hook:clouds': st.clouds.glsl } : {}),
      ...Object.fromEntries([...layers].map(([n, l]) => [`hook:${LAYER}${n}`, l])),
      ...(st.skybox ? { [REPLACE]: st.skybox } : {}),
    }),
    apply(v, changed) {
      for (const k of changed) {
        const u = CLOUD_KEYS[k];
        if (!u) continue;
        if (k === 'clouds.speed') U[u].value.set(v[k][0], v[k][1]);
        else if (U[u].value?.isColor) U[u].value.set(v[k]);
        else U[u].value = v[k];
      }
      if (changed.has('backdrop')) setBackdrop(v.backdrop);
    },
    hooks: hookSpec,
    applyHook(name, glsl) {
      if (name === 'clouds') { apply(rebuild(glsl, layers)); return; }
      const n = name.slice(LAYER.length), next = new Map(layers);
      if (glsl == null) next.delete(n); else next.set(n, glsl);
      apply(rebuild(part.value('hook:clouds'), next));   // throws before anything changes when the layer's GLSL is not valid
      layers.clear(); for (const [k, v] of next) layers.set(k, v);
    },
    validate: (k, v) => k === REPLACE && typeof v !== 'string' && !v?.isTexture && !v?.isObject3D ? 'is a skybox asset name, a THREE.Texture or a THREE.Object3D; null gives the dome back' : null,
    replace: { accepts: 'a skybox name (equirectangular panorama asset) | a THREE.Texture | a THREE.Object3D used as the background', loses: ['the gradient dome, sun and moon discs, stars, clouds and dome layers'] },
    applyReplace(impl) {
      if (added) { scene.remove(added); added = null; }
      if (impl == null) { sky.skybox = null; scene.background = sky._backdrop?.color ?? null; sky.dome.visible = !sky._backdrop; return; }
      sky.dome.visible = false;
      if (typeof impl === 'string') loadSkybox(sky, impl);
      else if (impl.isTexture) { impl.mapping = THREE.EquirectangularReflectionMapping; scene.background = impl; sky.skybox = impl; }
      else if (impl.isObject3D) { scene.add(impl); added = impl; scene.background = null; sky.skybox = null; }
    },
  });
}

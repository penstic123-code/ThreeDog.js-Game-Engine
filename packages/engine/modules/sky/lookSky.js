// look.sky: the sky dome as a look part.
//   set({ clouds: { coverage, scale, speed, opacity, softness, color, shade }, backdrop })   live uniforms of the dome; backdrop = one flat color instead of the dome
//   patch('clouds', glsl | { glsl, tsl, uniforms })  the cloud function threedogClouds (clouds.js), the one way to write your own; null gives the built-in kind back
//   patch('layer:<name>', glsl | { glsl, tsl, uniforms, order, blend })   add or change a named dome layer (domeLayers.js); null removes it
//   tsl: the WebGPURenderer form of either hook, (ctx) => vec4 node (render/fx/sky.tsl.js); each renderer draws its own form, a missing one throws by name
//   replace(skybox name | Texture | Object3D)   the dome gives way to a panorama or your own background object; null gives the dome back
// Dome layers are addressed by name; a style's array of layers (style.sky.layers) names its entries by their `name` key, else layer0, layer1 ...
// A hook change rebuilds the dome shader text and recompiles that one material (a hitch, so do it at a scene change, not every frame).
import { engineOwned } from '../../core/things.js';
import * as THREE from 'three';
import { defineLookPart, REPLACE } from '../../core/look/part.js';
import { resolveClouds } from './clouds.js';
import { resolveDomeLayers } from './domeLayers.js';
import { domeFragment, loadSkybox, skyNodes } from './shader.js';
import { DOME_FOG } from './fog.js';
import { isWebGPU } from '../../render/backend.js';
import { resolveBackdrop } from './look.js';

const LAYER = 'layer:';
const CLOUD_KEYS = { 'clouds.coverage': 'uCloudCover', 'clouds.scale': 'uCloudScale', 'clouds.speed': 'uCloudSpeed', 'clouds.opacity': 'uCloudOpacity',
  'clouds.softness': 'uCloudSoft', 'clouds.color': 'uCloudColor', 'clouds.shade': 'uCloudShade' };
const isColorLike = v => typeof v === 'number' || typeof v === 'string' || !!v?.isColor;
const colorOrFn = v => (isColorLike(v) || typeof v === 'function' ? null : `must be a color (0xefebe4, '#efebe4') or ({ time, state }) => color; got ${JSON.stringify(v)}`);

/** @param {any} sky @param {object} st style.sky merged with the sky({ ... }) options */
export function defineSkyLook(sky, st) {
  const e = sky.engine, scene = e.scene, U = sky.uniforms;
  let part, added = null, addedHere = false;
  const layers = new Map((Array.isArray(st.layers) ? st.layers : []).map((l, i) => [l?.name ?? `layer${i}`, l]));

  // The dome shader from the current clouds function and layers; throws (changing nothing) when a hook is not valid for its contract
  const rebuild = (cloudsHook, map) => {
    // WebGPU dome (node material, render/fx/sky.tsl.js): the hooks' tsl forms, checked there before anything changes (apply)
    const gpu = isWebGPU(e.renderer);
    const cl = resolveClouds(st.clouds, cloudsHook, gpu);
    const l = resolveDomeLayers([...map.values()].map(v => (typeof v === 'string' ? { glsl: v } : v)), { gpu, names: [...map.keys()] });
    if (gpu) return { nodes: { kind: cl.kind, clouds: cloudsHook ?? null, layers: l.layers }, uniforms: { ...cl.uniforms, ...l.uniforms } };
    const f = DOME_FOG;   // the fog band is always in the dome, switched by a uniform (fog.js)
    const text = domeFragment(cl, { decl: [f.decl, l.decl].filter(Boolean).join('\n'), body: f.body + l.body });
    return { text, uniforms: { ...cl.uniforms, ...l.uniforms } };
  };
  const apply = r => {
    // node dome: a new color node over the uniforms with the hook's own added (setHooks throws first on a bad hook, the dome unchanged)
    if (r.nodes) skyNodes(e).setHooks(sky.dome.material, { ...r.uniforms, ...U }, r.nodes.kind, e, r.nodes);
    for (const [k, u] of Object.entries(r.uniforms)) if (!(k in U)) U[k] = u;
    if (r.nodes) return;
    if (sky.dome.material.fragmentShader === r.text) return;
    sky.dome.material.fragmentShader = r.text; sky.dome.material.needsUpdate = true;
  };

  // the renderer swap (Sky.js) builds a fresh dome from the style; the hooks set since then go back on it
  sky._lookHooks = () => apply(rebuild(part.value('hook:clouds'), layers));

  const setBackdrop = v => {
    if (v == null) { sky._backdrop = null; sky.dome.visible = !sky.skybox && !added; scene.background = sky.skybox ?? null; return; }
    sky._backdrop = resolveBackdrop({ backdrop: v });   // the sky writes scene.background and hides the dome each frame (frame.js)
  };

  const hooks = { clouds: { signature: 'vec4 threedogClouds(vec3 dir, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cover)', scope: ['threedogHash', 'threedogNoise', 'uCloud* uniforms'],
    tsl: 'WebGPU: { glsl, tsl: ({ dir, time, sunDir, night, lit, shade, cover, clouds, uniforms, fx: { noise, hash }, tsl }) => vec4 }',
    example: 'vec4 threedogClouds(vec3 d, float t, vec3 s, float night, vec3 lit, vec3 shade, float cover){ return vec4(lit, step(0.5, threedogNoise(d.xz * 4.0)) * cover); }' },
  [LAYER + '<name>']: { signature: 'vec4 threedogSkyLayer(vec3 dir, float time, vec3 sunDir, float night)', scope: ['threedogHash', 'threedogNoise', 'uTop', 'uHorizon', 'uSunColor ...'],
    tsl: 'WebGPU: { glsl, tsl: ({ dir, time, sunDir, night, color, uniforms, fx: { noise, hash }, tsl }) => vec4 (rgb, amount) }',
    example: "look.sky.patch('layer:aurora', { glsl: 'vec4 threedogSkyLayer(vec3 d, float t, vec3 s, float n){ return vec4(0.2, 1.0, 0.5, n * smoothstep(0.1, 0.6, d.y) * 0.4); }', blend: 'add' })" } };
  // layer:<name> takes any name: the spec lists one documented entry, the check accepts the prefix
  const hookSpec = new Proxy(hooks, { has: (t, k) => k in t || (typeof k === 'string' && /^layer:[\w-]+$/.test(k)) });

  const cloudDesc = { coverage: 'cloud amount 0..1+ (also follows the weather)', scale: 'cloud size (smaller = bigger clouds)', speed: 'drift [x, z] per second', opacity: 'cloud opacity',
    softness: 'edge softness', color: 'lit side color', shade: 'shaded side color' };
  const num = d => ({ type: 'number', min: 0, cost: 'uniform', neutral: true, desc: d });
  part = defineLookPart(e, {
    id: 'sky', group: 'atmosphere', module: 'sky', object: () => sky.dome, applyAtStart: false, docs: ['recipes/52-look.md', 'recipes/36-sky-ground-plant-looks.md'],
    params: {
      // all neutral: with coverage 0 (no clouds unless the style gives them) nothing of these is drawn
      'clouds.coverage': { ...num(cloudDesc.coverage), neutral: true, default: 0 },
      'clouds.scale': { ...num(cloudDesc.scale), neutral: true, default: 0.35 },
      'clouds.speed': { type: 'array', default: [0.004, 0.002], neutral: true, cost: 'uniform', desc: cloudDesc.speed },
      'clouds.opacity': { ...num(cloudDesc.opacity), neutral: true, default: 0.9 },
      'clouds.softness': { ...num(cloudDesc.softness), neutral: true, default: 0.3 },
      'clouds.color': { type: 'any', default: '#f4f4f4', neutral: true, cost: 'uniform', desc: cloudDesc.color },
      'clouds.shade': { type: 'any', default: '#aaaaaa', neutral: true, cost: 'uniform', desc: cloudDesc.shade },
      backdrop: { type: 'any', default: null, neutral: true, fn: true, cost: 'uniform', desc: 'a flat color (or ({ time, state }) => color) in place of the dome: no gradient, sun, moon, stars or clouds; null = the dome',
        check: colorOrFn },
      // over the keyframes (null = the keyframes' color): a fixed color, or a function of the frame context (core/look/state.js) evaluated by frame.js
      top: { type: 'any', default: null, neutral: true, fn: true, cost: 'uniform', desc: "zenith color over style.sky.keyframes: a color or ({ time, weather, season, state, sky }) => color; null = the keyframes", check: colorOrFn },
      horizon: { type: 'any', default: null, neutral: true, fn: true, cost: 'uniform', desc: "horizon color over the keyframes (fog 'horizon' and the hemisphere follow it): a color or a function; null = the keyframes. The color drawn this frame (for your own shader): engine.uniforms.uSkyHorizon", check: colorOrFn },
    },
    style: () => ({
      'clouds.coverage': U.uCloudCover.value, 'clouds.scale': U.uCloudScale.value, 'clouds.speed': U.uCloudSpeed.value.toArray(), 'clouds.opacity': U.uCloudOpacity.value,
      'clouds.softness': U.uCloudSoft.value, 'clouds.color': '#' + U.uCloudColor.value.getHexString(), 'clouds.shade': '#' + U.uCloudShade.value.getHexString(),
      ...(st.backdrop != null ? { backdrop: st.backdrop } : {}),
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
    validate: (k, v) => k !== REPLACE ? null : v === false ? 'false is not a sky: give the dome back with engine.look.sky.replace(null)'
      : typeof v !== 'string' && !v?.isTexture && !v?.isObject3D ? 'is a skybox asset name, a THREE.Texture or a THREE.Object3D; null gives the dome back' : null,
    replace: { accepts: 'a skybox name (equirectangular panorama asset) | a THREE.Texture / CubeTexture | your own THREE.Object3D sky (three/addons Sky, a ShaderMaterial dome); the engine never writes it and keeps feeding engine.uniforms (uSunDir, uDaylight, uTimeOfDay, uWind ...)',
      loses: ['the gradient dome, sun and moon discs, stars, clouds and dome layers (time, lights, fog, weather and the uniforms keep running)'] },
    // The game's own sky (three/addons Sky, a ShaderMaterial dome, a skybox texture) is never written: the engine only hides its dome, adds the
    // object to the scene when it has no parent yet (and takes it out again on hand-back only then), and keeps feeding time / weather / season
    // through engine.uniforms (uSunDir, uDaylight, uTimeOfDay, uWind, uCloud ...) and the day / season / weather events. A plain Texture gets its
    // panorama mapping on a clone, so the game's texture object stays as it was.
    applyReplace(impl) {
      if (added) { if (addedHere) scene.remove(added); added = null; addedHere = false; }
      sky._ownSky = null;
      if (impl == null) { sky.skybox = null; scene.background = sky._backdrop?.color ?? null; sky.dome.visible = !sky._backdrop; return; }
      sky.dome.visible = false;
      if (typeof impl === 'string') loadSkybox(sky, impl);
      else if (impl.isTexture) {
        const tex = impl.isCubeTexture || impl.mapping !== THREE.UVMapping ? impl : Object.assign(impl.clone(), { mapping: THREE.EquirectangularReflectionMapping });
        scene.background = tex; sky.skybox = tex;
      } else if (impl.isObject3D) {
        addedHere = !impl.parent; if (addedHere) scene.add(engineOwned('sky', impl));
        added = impl; sky._ownSky = impl; scene.background = null; sky.skybox = null;
      }
    },
  });
}

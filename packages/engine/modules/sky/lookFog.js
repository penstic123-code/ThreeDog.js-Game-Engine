// look.fog: the sky's fog as a look part. set({ kind, color, density, near, far, height, falloff, enabled }), patch('fog', glsl); manual() stops the sky writing scene.fog.
// A fog of your own is plain three.js (scene.fog = new THREE.Fog(...)): the engine yields, there is no look.fog.replace.
// The sky still writes color and distance every frame (updateFog in fog.js) from the resolved values, so a game set() simply changes what it writes.
// kind 'exp' / 'height', height, falloff and the 'fog' hook are the 'fog' shader patch (fog.js): changing them re-patches the materials, which
// recompile once (cost 'shader'), so they work any time but belong on a settings change, not every frame. color, density, near, far, enabled and
// kind 'linear' <-> 'exp2' are uniforms. Color switches freely at runtime between 'horizon', a fixed color and a function: the dome's fog band (a
// fog-colored fade so the horizon line hides) follows by a uniform (fog.js DOME_FOG).
// Who writes scene.fog has one record, the owned 'fog' entry (frame.js): a direct write yields it, manual() takes it on purpose, manual(false) hands it back.
import { defineLookPart } from '../../core/look/part.js';
import { FOG_FAR } from '../../core/sceneMethods.js';
import { resolveFog, makeFog, setFogPatch, FOG_KINDS, FOG_NEAR, FOG_SIGNATURE, startFar } from './fog.js';

const NEEDS_GLSL = 'needs GLSL that defines `vec4 threedogFog(vec3 color, float depth, vec3 worldPos)` returning (fog rgb, amount 0..1)';
/** The 'fog' hook value: GLSL text, or { glsl?, tsl? } with at least one (glsl for WebGLRenderer, tsl: (ctx) => vec4 node for WebGPURenderer) */
const fogHookProblem = v => {
  if (typeof v === 'string') return FOG_SIGNATURE.test(v) ? null : NEEDS_GLSL;
  if (!v || typeof v !== 'object' || (v.glsl == null && v.tsl == null)) return `${NEEDS_GLSL}, or { glsl, tsl: (ctx) => vec4 node } (tsl draws on WebGPURenderer)`;
  if (v.glsl != null && !(typeof v.glsl === 'string' && FOG_SIGNATURE.test(v.glsl))) return `glsl ${NEEDS_GLSL}`;
  if (v.tsl != null && typeof v.tsl !== 'function') return 'tsl must be (ctx) => vec4 node (fog rgb, amount)';
  const extra = Object.keys(v).filter(k => k !== 'glsl' && k !== 'tsl');
  return extra.length ? `takes { glsl, tsl } only; got ${extra.join(', ')} (no custom uniforms: write constants in the code)` : null;
};

/** @param {any} sky @param {object} spec the style.sky.fog settings in use (look.js keeps them in sky._fogSpec) */
export function defineFogLook(sky, spec) {
  const e = sky.engine, scene = e.scene;
  let part;

  const rebuild = () => {
    const v = part.author.values(), hook = part.value('hook:fog');
    const f = resolveFog({ kind: v.kind, color: v.color, density: v.density ?? undefined, height: v.height, falloff: v.falloff, near: v.near ?? undefined,
      far: v.far ?? undefined, enabled: v.enabled }, hook ?? undefined);
    if (sky._drive.fog !== false) setFogPatch(sky, f);   // first: on WebGPU a GLSL hook throws there, before the settings change
    sky._fog = f;
    // linear is three's Fog, every other kind FogExp2: swap the object (materials recompile for it) when the kind crossed that line
    const cur = scene.fog;
    if ((sky._oFog ? sky._oFog.on : sky._drive.fog === true) && cur &&   // _oFog is registered after the fog part (frame.js)
        (f.kind === 'linear' ? !cur.isFog : !cur.isFogExp2)) {
      scene.fog = makeFog(f, startFar(f, e)); scene.fog.color.copy(cur.color);
    }
  };

  part = defineLookPart(e, {
    id: 'fog', group: 'atmosphere', module: 'sky', object: () => scene.fog, applyAtStart: false, docs: ['recipes/52-look.md', 'recipes/38-environment-look-hooks.md'],
    params: {
      enabled: { type: 'bool', default: true, cost: 'uniform', desc: 'fog on / off without a recompile',
        why: 'distant things melt into the sky and the edge of a streamed world is hidden', off: 'look.fog.set({ enabled: false }), or sky({ fog: false })' },
      kind: { type: 'string', default: 'linear', values: FOG_KINDS, cost: 'shader', desc: "'linear' | 'exp' | 'exp2' | 'height'", neutral: true },
      color: { type: 'any', default: 'horizon', cost: 'uniform', fn: true, desc: "'horizon' (the dome's horizon color, written every frame) | a color | ({ time, weather, season, state, sky }) => either", neutral: true },
      density: { type: 'any', default: null, cost: 'uniform', neutral: true, fn: true, desc: 'per meter for exp / exp2 / height; null = derived so the fog reaches the same distance as linear' },
      far: { type: 'number', default: FOG_FAR, min: 0, cost: 'uniform', fn: true, desc: "fog distance in meters; effects multiply it (weather: engine.mod('look.fog.far', { owner, mul, layer: 'effect' })); terrain({ viewFog: true }) writes its engine layer (owner 'terrainLook')",
        why: `fog reaches full strength at ${FOG_FAR} m unless a style, the terrain view or the game says otherwise, starting at ${FOG_NEAR} x that`, off: 'look.fog.set({ enabled: false })' },
      // not neutral: the start distance is an engine choice, so the catalog shows why and how to change it like any other default
      near: { type: 'any', default: null, cost: 'uniform', fn: true, desc: `linear only: where the fog starts, in meters (or ({ time, weather, season, state, sky }) => meters); null = ${FOG_NEAR} x far`,
        why: `fog starts at ${FOG_NEAR} x far so the near field stays clear while the far edge still hides the world's end`, off: 'look.fog.set({ near: 0 }) (fog from the camera on), or any distance in meters' },
      height: { type: 'number', default: 0, neutral: true, cost: 'shader', desc: "kind 'height': the fog's floor (world y)" },
      falloff: { type: 'number', default: 0.05, min: 0, neutral: true, cost: 'shader', desc: "kind 'height': how fast it thins above the floor (per meter)" },
    },
    style: () => {
      const s = spec ?? {};
      return Object.fromEntries(['enabled', 'kind', 'color', 'density', 'far', 'near', 'height', 'falloff'].filter(k => s[k] != null).map(k => [k, s[k]]));
    },
    // far alone changes every frame under weather: only the distance moves (updateFog reads the point), no fog rebuild
    apply(v, changed) { if (changed.size === 1 && changed.has('far') && sky._fog) { sky._fog.far = v.far; return; } rebuild(); },
    hooks: { fog: { signature: 'vec4 threedogFog(vec3 color, float depth, vec3 worldPos)', scope: ['fogColor', 'cameraPosition', 'fogNear / fogFar (linear)', 'fogDensity (other kinds)', 'THREEDOG_FOG_HEIGHT', 'THREEDOG_FOG_FALLOFF'],
      tsl: 'WebGPU: { glsl, tsl: ({ color, depth, worldPos, cameraPosition, density, near, far, height, falloff, fog, tsl }) => vec4 (fog rgb, amount) }',
      example: 'vec4 threedogFog(vec3 color, float depth, vec3 worldPos){ return vec4(color, 1.0 - exp(-fogDensity * depth)); }' } },
    applyHook() { rebuild(); },
    // wrong hook GLSL stops here, before any layer is written
    validate: (k, v) => (k === 'hook:fog' ? fogHookProblem(v) : null),
    // no replace: a fog of your own is plain three.js. scene.fog = new THREE.Fog(...) is taken as yours (the owned 'fog' entry yields, describe
    // says writer 'three'), so a second spelling of the same thing (look.fog.replace) would only be a second record to keep in step
    noReplace: 'a fog of your own is plain three.js: scene.fog = new THREE.Fog(color, near, far) (or FogExp2); the engine stops writing it. ' +
      'To keep the engine fog and only stop the sky writing it: engine.look.fog.manual(); manual(false) hands it back',
  });
}

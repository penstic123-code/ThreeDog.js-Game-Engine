// look.fog: the sky's fog as a look part. set({ kind, color, density, near, far, height, falloff, enabled }), patch('fog', glsl), replace(THREE.Fog | null); manual() stops the sky writing scene.fog.
// The sky still writes color and distance every frame (updateFog in fog.js) from the resolved values, so a game set() simply changes what it writes.
// kind 'exp' / 'height', height, falloff and the 'fog' hook are the 'fog' shader patch (fog.js): changing them re-patches the materials, which
// recompile once (cost 'shader'), so they work any time but belong on a settings change, not every frame. color, density, near, far, enabled and
// kind 'linear' <-> 'exp2' are uniforms. Color switches freely at runtime between 'horizon', a fixed color and a function: the dome's fog band (a
// fog-colored fade so the horizon line hides) follows by a uniform (fog.js DOME_FOG).
// Who writes scene.fog has one record, the owned 'fog' entry (frame.js): manual() and replace(fog) both put it in manual mode, replace(null) hands it back.
import { defineLookPart, REPLACE } from '../../core/look/part.js';
import { resolveFog, makeFog, setFogPatch, FOG_KINDS, FOG_NEAR, FOG_SIGNATURE, startFar } from './fog.js';

/** @param {any} sky @param {object} spec the style.sky.fog settings in use (look.js keeps them in sky._fogSpec) */
export function defineFogLook(sky, spec) {
  const e = sky.engine, scene = e.scene;
  let part;

  const rebuild = () => {
    const v = part.values(), glsl = part.value('hook:fog');
    const f = resolveFog({ kind: v.kind, color: v.color, density: v.density ?? undefined, height: v.height, falloff: v.falloff, near: v.near ?? undefined,
      far: v.far ?? undefined, enabled: v.enabled }, typeof glsl === 'string' ? glsl : undefined);
    sky._fog = f;
    if (sky._drive.fog !== false) setFogPatch(sky, f);
    // linear is three's Fog, every other kind FogExp2: swap the object (materials recompile for it) when the kind crossed that line
    const cur = scene.fog;
    if ((sky._oFog ? sky._oFog.on : sky._drive.fog === true) && cur &&   // _oFog is registered after the fog part (frame.js)
        (f.kind === 'linear' ? !cur.isFog : !cur.isFogExp2)) {
      scene.fog = makeFog(f, startFar(f, e.fogFar)); scene.fog.color.copy(cur.color);
    }
  };

  part = defineLookPart(e, {
    id: 'fog', group: 'atmosphere', module: 'sky', object: () => scene.fog, applyAtStart: false, docs: ['recipes/52-look.md', 'recipes/38-sky.md'],
    params: {
      enabled: { type: 'bool', default: true, cost: 'uniform', desc: 'fog on / off without a recompile',
        why: 'distant things melt into the sky and the edge of a streamed world is hidden', off: 'look.fog.set({ enabled: false }), or sky({ fog: false })' },
      kind: { type: 'string', default: 'linear', values: FOG_KINDS, cost: 'shader', desc: "'linear' | 'exp' | 'exp2' | 'height'", neutral: true },
      color: { type: 'any', default: 'horizon', cost: 'uniform', fn: true, desc: "'horizon' (the dome's horizon color, written every frame) | a color | ({ time, weather, season, state, sky }) => either", neutral: true },
      density: { type: 'any', default: null, cost: 'uniform', neutral: true, fn: true, desc: 'per meter for exp / exp2 / height; null = derived so the fog reaches the same distance as linear' },
      far: { type: 'any', default: null, cost: 'uniform', fn: true, desc: 'fog distance in meters (weather scales it); null = engine.fogFar (createEngine, terrain view range)',
        why: 'fog reaches full strength at engine.fogFar (600 by default), starting at 0.3 x that', off: 'look.fog.set({ enabled: false })' },
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
    apply() { rebuild(); },
    hooks: { fog: { signature: 'vec4 threedogFog(vec3 color, float depth, vec3 worldPos)', scope: ['fogColor', 'cameraPosition', 'fogNear / fogFar (linear)', 'fogDensity (other kinds)', 'THREEDOG_FOG_HEIGHT', 'THREEDOG_FOG_FALLOFF'],
      example: 'vec4 threedogFog(vec3 color, float depth, vec3 worldPos){ return vec4(color, 1.0 - exp(-fogDensity * depth)); }' } },
    applyHook() { rebuild(); },
    // wrong hook GLSL or replace value stops here, before any layer is written
    validate: (k, v) => k === 'hook:fog' ? (typeof v === 'string' && FOG_SIGNATURE.test(v) ? null : 'needs GLSL that defines `vec4 threedogFog(vec3 color, float depth, vec3 worldPos)` returning (fog rgb, amount 0..1)')
      : k !== REPLACE ? null : v === 'manual' ? "'manual' is not a fog: keep scene.fog and stop the sky writing it with engine.look.fog.manual() (manual(false) gives it back)"
      : !v?.isFog && !v?.isFogExp2 ? 'is a THREE.Fog / THREE.FogExp2 (becomes scene.fog); null gives the fog back to the sky; to keep the current fog: engine.look.fog.manual()' : null,
    replace: { accepts: 'a THREE.Fog / FogExp2 (becomes scene.fog; null gives it back). To keep the fog and only stop the sky writing it: manual()', loses: ["weather fog distance (engine.mod('sky.fog'))", 'the sky-colored horizon fade'] },
    applyReplace(impl) {
      // one record for "who writes scene.fog": the owned entry, not a second flag next to it
      if (impl?.isFog || impl?.isFogExp2) { scene.fog = impl; sky._oFog?.manual(true, 'look.fog.replace'); }
      else if (impl == null) {
        sky._oFog?.manual(false);
        if (sky._drive.fog === true) scene.fog = makeFog(sky._fog, startFar(sky._fog, e.fogFar));
      }
      // (refresh re-reads the owned fog afterwards: core/look/layers.js markOwned)
    },
  });
}

// look.fog: the sky's fog as a look part. set({ kind, color, density, near, far, height, falloff, enabled }), patch('fog', glsl), replace('manual' | THREE.Fog).
// The sky still writes color and distance every frame (updateFog in fog.js) from the resolved values, so a game set() simply changes what it writes.
// What cannot change after the first frame: kind 'exp' / 'height', height, falloff and the 'fog' hook replace three's shared fog_* shader chunks, and
// three compiles each material once (fog.js explains). Those are accepted before the first frame (style, sky({ fog }), or right after createEngine) and
// throw afterwards, naming the way out. kind linear <-> exp2, color, density, near, far, enabled work live. The dome's horizon band (a fog-colored fade
// so the horizon line hides) is part of the dome shader and exists only when the start color was not 'horizon'.
import { defineLookPart, REPLACE } from '../../core/look/part.js';
import { resolveFog, makeFog, applyFogChunks, FOG_KINDS } from './fog.js';

const LATE = "look.fog: {what} changes three.js's shared fog shader chunks, which are compiled once per material, so it can only be set before the first frame " +
  "(style.sky.fog, sky({ fog }), or right after createEngine). Live now: color, density, near, far, enabled, and kind 'linear' <-> 'exp2'";
const chunkKey = f => (f.glsl ? JSON.stringify([f.kind, f.height, f.falloff, f.glsl]) : '');

/** @param {any} sky @param {object} spec the style.sky.fog settings in use (look.js keeps them in sky._fogSpec) */
export function defineFogLook(sky, spec) {
  const e = sky.engine, scene = e.scene;
  const rendered = () => (e.renderer?.info?.render?.frame ?? 0) > 0;
  let part;
  sky._fogHeld = false;
  sky._fogKey = chunkKey(sky._fog);
  const late = (key, what) => v => (rendered() && v !== part?.value(key) && (sky._fogKey || (key === 'kind' && (v === 'exp' || v === 'height'))) ? LATE.replace('{what}', what) : null);

  const rebuild = () => {
    const v = part.values(), glsl = part.value('hook:fog');
    const f = resolveFog({ kind: v.kind, color: v.color, density: v.density ?? undefined, height: v.height, falloff: v.falloff, near: v.near ?? undefined,
      far: v.far ?? undefined, enabled: v.enabled, glsl: typeof glsl === 'string' ? glsl : undefined });
    const key = chunkKey(f);
    if (key !== sky._fogKey) {
      if (rendered()) throw new Error(LATE.replace('{what}', 'this fog change'));
      sky._fogOff();
      try { sky._fogOff = applyFogChunks(f); } catch (err) { sky._fogOff = applyFogChunks(sky._fog); throw err; }
      sky._fogKey = key;
    }
    sky._fog = f;
    // linear is three's Fog, every other kind FogExp2: swap the object (materials recompile for it) when the kind crossed that line
    const cur = scene.fog;
    if (sky._drive.fog === true && !sky._fogHeld && cur && (f.kind === 'linear' ? !cur.isFog : !cur.isFogExp2)) {
      scene.fog = makeFog(f, f.far ?? e.fogFar); scene.fog.color.copy(cur.color);
      for (const o of sky._owned ?? []) o.mark();
    }
  };

  part = defineLookPart(e, {
    id: 'fog', group: 'atmosphere', module: 'sky', object: () => scene.fog, applyAtStart: false, docs: ['recipes/52-look.md', 'recipes/38-sky.md'],
    params: {
      enabled: { type: 'bool', default: true, cost: 'uniform', desc: 'fog on / off without a recompile',
        why: 'distant things melt into the sky and the edge of a streamed world is hidden', off: 'look.fog.set({ enabled: false }), or sky({ fog: false })' },
      kind: { type: 'string', default: 'linear', values: FOG_KINDS, cost: 'shader', desc: "'linear' | 'exp' | 'exp2' | 'height'", neutral: true,
        check: late('kind', "kind 'exp' / 'height'") },
      color: { type: 'any', default: 'horizon', cost: 'uniform', desc: "'horizon' (the dome's horizon color, written every frame) | a color | (sky) => color", neutral: true },
      density: { type: 'any', default: null, cost: 'uniform', neutral: true, desc: 'per meter for exp / exp2 / height; null = derived so the fog reaches the same distance as linear' },
      far: { type: 'any', default: null, cost: 'uniform', desc: 'fog distance in meters (weather scales it); null = engine.fogFar (createEngine, terrain view range)',
        why: 'fog reaches full strength at engine.fogFar (600 by default), starting at 0.3 x that', off: 'look.fog.set({ enabled: false })' },
      near: { type: 'any', default: null, cost: 'uniform', neutral: true, desc: 'linear only: where the fog starts; null = 0.3 x far' },
      height: { type: 'number', default: 0, neutral: true, cost: 'shader', desc: "kind 'height': the fog's floor (world y)", check: late('height', 'height') },
      falloff: { type: 'number', default: 0.05, min: 0, neutral: true, cost: 'shader', desc: "kind 'height': how fast it thins above the floor (per meter)", check: late('falloff', 'falloff') },
    },
    style: () => {
      const s = spec ?? {};
      return { ...Object.fromEntries(['enabled', 'kind', 'color', 'density', 'far', 'near', 'height', 'falloff'].filter(k => s[k] != null).map(k => [k, s[k]])),
        ...(s.glsl ? { 'hook:fog': s.glsl } : {}) };
    },
    apply() { rebuild(); },
    hooks: { fog: { signature: 'vec4 threedogFog(vec3 color, float depth, vec3 worldPos)', scope: ['fogColor', 'cameraPosition', 'fogNear / fogFar (linear)', 'fogDensity (other kinds)', 'THREEDOG_FOG_HEIGHT', 'THREEDOG_FOG_FALLOFF'],
      example: 'vec4 threedogFog(vec3 color, float depth, vec3 worldPos){ return vec4(color, 1.0 - exp(-fogDensity * depth)); }' } },
    applyHook(name, glsl) {
      rebuild();
    },
    // wrong hook GLSL or replace value stops here, before any layer is written
    validate: (k, v) => k === 'hook:fog' ? (typeof v === 'string' && /vec4\s+threedogFog\s*\(/.test(v) ? null : 'needs GLSL that defines `vec4 threedogFog(vec3 color, float depth, vec3 worldPos)` returning (fog rgb, amount 0..1)')
      : k === REPLACE && v !== 'manual' && !v?.isFog && !v?.isFogExp2 ? "is 'manual' or a THREE.Fog / THREE.FogExp2; null gives the fog back to the sky" : null,
    replace: { accepts: "'manual' (the sky stops writing scene.fog) | a THREE.Fog / FogExp2 (becomes scene.fog)", loses: ['weather fog distance (sky.modify fog)', 'the sky-colored horizon fade'] },
    applyReplace(impl) {
      sky._fogHeld = impl != null;
      if (impl?.isFog || impl?.isFogExp2) scene.fog = impl;
      else if (impl == null && sky._drive.fog === true) scene.fog = makeFog(sky._fog, sky._fog.far ?? e.fogFar);
      for (const o of sky._owned ?? []) o.mark();   // the dev guard re-reads the fog it watches
    },
  });
}

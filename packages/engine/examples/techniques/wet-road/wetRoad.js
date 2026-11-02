// @ts-check
// Technique: a road that gets wet in rain and dries after it (README.md next to this file). Copy this file into a game; in a game the import
// below becomes `from 'threedog'`. Three parts, each switchable:
//   1. wetness 0-1 from engine.weather.current.rain, with a dry-out delay (game time, so engine.skip and frozen time behave);
//   2. a material patch (slots color / roughness / normal, no global ShaderChunk edits): darker albedo, lower roughness, soft-edged puddles;
//   3. reflection streaks: one instanced draw of stretched additive quads on the road under each lamp / window / sign (the cheap fake that
//      works at night; real lights also get a sharp GGX highlight for free from the lower roughness).
import { THREE, applyEffects } from 'threedog';

/** Every knob of the technique; createWetRoad(engine, { ...overrides }) */
export const WET_ROAD_DEFAULTS = {
  wetSeconds: 25,        // seconds of full rain from dry to fully wet (light rain wets slower: the rate scales with rain)
  dryDelay: 40,          // seconds after the rain stops before the road starts to dry (puddles stand a while)
  drySeconds: 120,       // seconds from fully wet to dry once drying started
  rainThreshold: 0.05,   // rain below this counts as stopped
  darken: 0.6,           // albedo multiplier when fully wet (porous asphalt / stone darkens; 1 = metal or glazed tile, no change)
  wetRoughness: 0.32,    // roughness cap when wet (the film of water); the dry roughness comes from the material
  puddles: true,         // false: wet film only, one less noise in the shader
  puddleScale: 0.45,     // noise cells per meter (bigger = more, smaller puddles)
  puddleCover: 0.32,     // share of the surface under water when fully wet (puddles grow in from 0 as wetness passes 0.35)
  puddleSoftness: 0.09,  // edge width in noise units: the soft rim where water thins out (0.02 = hard disc edge, avoid)
  puddleDarken: 0.55,    // extra albedo multiplier under a puddle (you see the dark wet ground through the water)
  puddleRoughness: 0.03, // still water is almost a mirror
  streaks: true,         // reflection streaks under emitters (addStreak)
  streakSpread: 0.12,    // radians the reflection smears up and down around the mirror image (the water film's roughness; 0.02 = puddle mirror)
  streakBlur: 0.006,     // radians it smears sideways, on top of the source's own size
  streakFilm: 0.35,      // streak strength on wet film relative to a puddle (1 = puddles do not matter)
  streakFade: 70,        // meters from the camera where streaks have faded out
  bounds: /** @type {number[] | null} */ (null),   // [minX, minZ, maxX, maxZ]: streaks are cut to this world rectangle (the road); null = anywhere
};

// The puddle noise, shared by the surface patch and the streak shader so a streak is bright exactly over the puddles the surface shows.
// Value noise, 3 octaves, world xz in, 0-1 out. Written for this example (the usual hash-and-smoothstep value noise).
const NOISE_GLSL = /* glsl */`
float tdWetHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tdWetValue(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tdWetHash(i), tdWetHash(i + vec2(1, 0)), u.x), mix(tdWetHash(i + vec2(0, 1)), tdWetHash(i + vec2(1, 1)), u.x), u.y);
}
float tdWetNoise(vec2 p) { return 0.57 * tdWetValue(p) + 0.29 * tdWetValue(p * 2.03 + 17.1) + 0.14 * tdWetValue(p * 4.11 - 9.7); }
// cover 0-1 -> threshold on the noise (fbm piles up near 0.5, so the share under water is not linear in the threshold; fitted by eye)
float tdWetPuddle(vec2 xz, float scale, float cover, float soft) {
  if (cover <= 0.0) return 0.0;
  float t = 0.72 - 0.5 * cover;
  return smoothstep(t - soft, t + soft, tdWetNoise(xz * scale));
}`;

/**
 * Wet road: wetness follows rain; patched materials darken, gloss up and grow puddles; optional reflection streaks.
 * @param {any} engine
 * @param {Partial<typeof WET_ROAD_DEFAULTS> & { materials: THREE.Material[] }} options materials: MeshStandard / MeshPhysical materials of the road
 */
export function createWetRoad(engine, { materials, ...over }) {
  const o = { ...WET_ROAD_DEFAULTS, ...over };
  for (const k of Object.keys(over)) if (!(k in WET_ROAD_DEFAULTS)) throw new Error(`createWetRoad: unknown option '${k}' (known: ${Object.keys(WET_ROAD_DEFAULTS).join(', ')})`);
  for (const m of materials) if (!(/** @type {any} */ (m).isMeshStandardMaterial)) throw new Error('createWetRoad: road materials must be MeshStandardMaterial / MeshPhysicalMaterial (roughness is what makes it read as wet)');

  // One uniform object for all patched materials and the streaks: changing a number never recompiles.
  const u = {
    uWet: { value: 0 }, uWetDarken: { value: o.darken }, uWetRough: { value: o.wetRoughness },
    uPuddleScale: { value: o.puddleScale }, uPuddleCover: { value: 0 }, uPuddleSoft: { value: o.puddleSoftness },
    uPuddleDarken: { value: o.puddleDarken }, uPuddleRough: { value: o.puddleRoughness }, uWetMaskView: { value: 0 },
  };
  const puddle = o.puddles ? 'tdWetPuddle(vThreedogWorld.xz, uPuddleScale, uPuddleCover, uPuddleSoft)' : '0.0';
  const patch = {
    name: 'wetRoad', cacheKey: o.puddles ? 'p1' : 'f1', needs: { patches: ['world'] }, uniforms: u,
    pars: { fragment: `uniform float uWet, uWetDarken, uWetRough, uPuddleScale, uPuddleCover, uPuddleSoft, uPuddleDarken, uPuddleRough, uWetMaskView;\n${NOISE_GLSL}` },
    glsl: {
      // the color slot runs first in main(), so the two values declared here are in scope for the later slots
      color: `float tdWet = uWet; float tdPuddle = ${puddle};
        diffuseColor.rgb *= mix(1.0, uWetDarken, tdWet) * mix(1.0, uPuddleDarken, tdPuddle);`,
      // min(): a surface already glossier than the water film stays as it is
      roughness: 'roughnessFactor = mix(roughnessFactor, min(roughnessFactor, uWetRough), tdWet); roughnessFactor = mix(roughnessFactor, uPuddleRough, tdPuddle);',
      // standing water is flat: it hides the bumps of a normal map under it
      normal: 'normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), tdPuddle));',
      // debug view of the puddle mask (wet.maskView = true): white = water
      output: 'if (uWetMaskView > 0.5) outgoingLight = vec3(tdPuddle);',
    },
  };
  for (const m of materials) applyEffects(/** @type {any} */ (m), { patches: [patch] });

  // ---- streaks: one InstancedMesh, matrices placed on the CPU each frame (a few dozen at most) ----
  /** @type {{ at: THREE.Vector3, color: THREE.Color, intensity: number }[]} */
  const sources = [];
  const MAX = 128;
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);   // flat on the ground; x across, z 0 (near) -> 1 (far)
  const aColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  geo.setAttribute('aColor', aColor);
  const aPeak = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);   // where along the quad the mirror image sits, 0-1
  geo.setAttribute('aPeak', aPeak);
  const streakMat = new THREE.ShaderMaterial({
    uniforms: { ...u, uStreakFilm: { value: o.streakFilm }, uStreakFade: { value: o.streakFade }, uBounds: { value: new THREE.Vector4(...(o.bounds ?? [-1e9, -1e9, 1e9, 1e9])) } },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aPeak; varying vec3 vColor; varying vec2 vUv; varying vec3 vWorld; varying float vDist, vPeak;
      void main() {
        vColor = aColor; vPeak = aPeak; vUv = vec2(uv.x * 2.0 - 1.0, 1.0 - uv.y);
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vWorld = w.xyz;
        vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uWet, uPuddleScale, uPuddleCover, uPuddleSoft, uStreakFilm, uStreakFade; uniform vec4 uBounds;
      varying vec3 vColor; varying vec2 vUv; varying vec3 vWorld; varying float vDist, vPeak;
      ${NOISE_GLSL}
      void main() {
        // across: a gaussian. along (vUv.y 0 near -> 1 far): a gaussian around the mirror image, each side stretched to its end of the quad,
        // so the smear is symmetric in view angle although the ground distances on the two sides differ a lot
        float across = exp(-vUv.x * vUv.x * 4.0);
        float a = (vUv.y - vPeak) / (vUv.y < vPeak ? max(vPeak, 1e-3) : max(1.0 - vPeak, 1e-3));
        float along = exp(-a * a * 3.5);
        float edge = 1.0 - smoothstep(0.8, 1.0, abs(vUv.x));
        float water = mix(uStreakFilm, 1.0, ${o.puddles ? 'tdWetPuddle(vWorld.xz, uPuddleScale, uPuddleCover, uPuddleSoft)' : '0.0'});
        float fade = 1.0 - smoothstep(uStreakFade * 0.6, uStreakFade, vDist);
        // shortcut: a rectangle keeps streaks off the curbs; several surfaces or curved roads want a stencil bit written by the road material
        if (any(lessThan(vWorld.xz, uBounds.xy)) || any(greaterThan(vWorld.xz, uBounds.zw))) discard;
        gl_FragColor = vec4(vColor * across * along * edge * water * fade * uWet, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const streakMesh = new THREE.InstancedMesh(geo, streakMat, MAX);
  streakMesh.count = 0; streakMesh.frustumCulled = false; streakMesh.renderOrder = 2; streakMesh.name = 'wetRoadStreaks';
  if (o.streaks) engine.scene.add(streakMesh);

  const C = new THREE.Vector3(), P = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4();
  let groundY = 0;
  function placeStreaks() {
    if (!o.streaks) return;
    streakMesh.visible = state.wetness > 0.001;
    if (!streakMesh.visible) return;
    engine.camera.getWorldPosition(C);
    let n = 0;
    for (const src of sources) {
      const h = src.at.y - groundY, ch = C.y - groundY;
      if (h <= 0 || ch <= 0 || src.intensity <= 0) continue;
      // Mirror image of the source: h below the ground. Seen from the camera at angle th below the horizon; a wet film smears it by
      // +-streakSpread in angle, which on the ground runs from `near` to `far` (far stops at the source's foot: nothing reflects beyond it).
      d.set(src.at.x - C.x, 0, src.at.z - C.z);
      const D = d.length();
      if (D < 0.5) continue;
      d.divideScalar(D);
      const th = Math.atan2(ch + h, D), toGround = (/** @type {number} */ a) => ch / Math.tan(a);
      const peak = toGround(th), near = toGround(Math.min(th + o.streakSpread, 1.5)), far = th - o.streakSpread > 0.001 ? Math.min(toGround(th - o.streakSpread), D) : D;
      if (far <= near) continue;
      const width = (0.6 / Math.hypot(D, ch + h) + o.streakBlur) * Math.hypot(peak, ch) * 2;   // 0.6 m: the apparent size of a lamp head / window
      q.setFromAxisAngle(Y, Math.atan2(d.x, d.z));
      s.set(width, 1, far - near);
      m4.compose(P.set(C.x + d.x * near, groundY + 0.01, C.z + d.z * near), q, s);
      streakMesh.setMatrixAt(n, m4);
      aPeak.setX(n, (peak - near) / (far - near));
      aColor.setXYZ(n, src.color.r * src.intensity, src.color.g * src.intensity, src.color.b * src.intensity);
      if (++n >= MAX) break;
    }
    streakMesh.count = n;
    streakMesh.instanceMatrix.needsUpdate = true;
    aColor.needsUpdate = true; aPeak.needsUpdate = true;
  }

  // ---- wetness from the weather, game time ----
  const rainNow = () => engine.weather?.current?.rain ?? 0;
  const state = { wetness: rainNow() > o.rainThreshold ? 1 : 0, sinceRain: rainNow() > o.rainThreshold ? 0 : Infinity, held: /** @type {number | null} */ (null) };
  function apply() {
    u.uWet.value = state.wetness;
    // puddles start once the film is there (wetness 0.35) and grow to their full cover; they also shrink first when drying
    u.uPuddleCover.value = o.puddleCover * THREE.MathUtils.smoothstep(state.wetness, 0.35, 1);
  }
  apply();
  const hFixed = engine.onFixed((/** @type {number} */ dt) => {
    if (state.held !== null) { state.wetness = state.held; apply(); return; }
    const rain = rainNow();
    if (rain > o.rainThreshold) { state.sinceRain = 0; state.wetness = Math.min(1, state.wetness + dt * rain / o.wetSeconds); }
    else {
      state.sinceRain += dt;
      if (state.sinceRain > o.dryDelay) state.wetness = Math.max(0, state.wetness - dt / o.drySeconds);
    }
    apply();
  });
  const hFrame = engine.onFrame(placeStreaks);

  return {
    /** current wetness 0-1 */
    get wetness() { return state.wetness; },
    /** hold wetness at a value (a cutscene, a test, a puddle-filled level); null gives it back to the weather */
    hold(/** @type {number | null} */ v) { state.held = v === null ? null : THREE.MathUtils.clamp(v, 0, 1); if (v !== null) { state.wetness = state.held ?? 0; apply(); } },
    /** debug: draw the puddle mask on the patched materials (white = water) */
    get maskView() { return u.uWetMaskView.value > 0.5; },
    set maskView(on) { u.uWetMaskView.value = on ? 1 : 0; },
    /** height of the ground the streaks lie on (default 0) */
    set groundY(y) { groundY = y; },
    /**
     * A reflection streak under an emitter: lamp head, window, sign. at = its world position (an Object3D is read once; call again if it moves)
     * @param {THREE.Vector3 | { x: number, y: number, z: number }} at
     * @param {{ color?: THREE.ColorRepresentation, intensity?: number }} [opts] intensity: linear brightness of the streak's core (about the emitter's emissiveIntensity / 2)
     */
    addStreak(at, { color = 0xffffff, intensity = 1 } = {}) {
      const src = { at: new THREE.Vector3(at.x, at.y, at.z), color: new THREE.Color(color), intensity };
      sources.push(src);
      return {
        /** change the streak (a lamp switching on / off follows its light) */
        set(/** @type {{ color?: THREE.ColorRepresentation, intensity?: number }} */ v) { if (v.color !== undefined) src.color.set(v.color); if (v.intensity !== undefined) src.intensity = v.intensity; },
        remove() { const i = sources.indexOf(src); if (i >= 0) sources.splice(i, 1); },
      };
    },
    describe() { return { wetness: +state.wetness.toFixed(3), sinceRain: state.sinceRain, rain: rainNow(), puddleCover: +u.uPuddleCover.value.toFixed(3), streaks: streakMesh.count, held: state.held }; },
    dispose() { hFixed?.remove?.(); hFrame?.remove?.(); streakMesh.removeFromParent(); geo.dispose(); streakMat.dispose(); },
  };
}

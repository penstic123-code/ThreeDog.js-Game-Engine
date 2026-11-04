// @ts-check
// Technique: street lamps, lit windows and signs that read as light at night without glaring (README.md next to this file). Copy this file
// into a game; in a game the import below becomes `from 'threedog'`. Needs engine.use(lightPool({ spot: n })) for the lamps' real lights.
// What it does: lamps = a pooled SpotLight aimed down (a light pool on the ground, walls above stay dark) + an emissive head + an optional
// soft halo sprite. One daylight curve for all of it: the lamps' real lights fade with lightPool.add({ dusk }), and night() below is that same
// curve for what the pool does not drive (windows, signs, lamp heads, halos). The numbers are chosen against the tone curve: the head is the only
// thing bright enough to bloom; windows stay below clipping.
import { THREE } from 'threedog';

/** Every knob of the technique; createNightLights(engine, { ...overrides }) */
export const NIGHT_LIGHTS_DEFAULTS = {
  lampColor: 0xffc58a,   // ~3000 K sodium-free warm white; blue-white (0xdde6ff) reads as LED / modern
  lampIntensity: 80,     // candela (three.js physical units): ground lux under a lamp = intensity / height^2 -> ~2.6 at 5.5 m, a mid-gray pool at exposure 1
  lampDistance: 18,      // meters where three's window fades the light to 0; ~3x the lamp height, so the pool's edge comes from decay, not the cutoff
  lampDecay: 2,          // physical inverse square; 0 or 1 make a light near a wall flood it evenly (the classic glare)
  lampAngle: 1.0,        // spot cone half-angle (radians): a wide cut-off fixture
  lampPenumbra: 0.8,     // soft pool edge
  headEmissive: 2.5,     // lamp head brightness (linear): above the bloom threshold, so only it blooms; small, so it clips only in its core
  windowEmissive: 0.6,   // lit window (linear): reads as warm light, stays well below clipping after the tone curve
  signEmissive: 1.4,     // neon sign: brighter than windows, saturated colors keep it from going white
  halo: true,            // a soft sprite around each head: glow without post (or on top of a gentle bloom)
  haloSize: 1.6,         // meters
  haloOpacity: 0.18,     // additive: keep it low, it stacks on the bloom
  dusk: 0.3,             // daylight (engine.calendar.daylight, 0-1) below which lamps, heads, windows and halos fade in
};

/** One soft radial gradient shared by every halo (64 px is plenty: it is blurred by nature) */
let haloTexture = /** @type {THREE.CanvasTexture | null} */ (null);
function haloMap() {
  if (haloTexture) return haloTexture;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  // falloff close to 1/(1+d^2): a bright core that fades without a visible rim
  for (const [t, a] of [[0, 1], [0.15, 0.55], [0.35, 0.2], [0.6, 0.06], [1, 0]]) r.addColorStop(t, `rgba(255,255,255,${a})`);
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  haloTexture = new THREE.CanvasTexture(c);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

/**
 * Night lights: lamps, windows and signs that fade in at dusk.
 * @param {any} engine
 * @param {Partial<typeof NIGHT_LIGHTS_DEFAULTS>} [over]
 */
export function createNightLights(engine, over = {}) {
  const o = { ...NIGHT_LIGHTS_DEFAULTS, ...over };
  for (const k of Object.keys(over)) if (!(k in NIGHT_LIGHTS_DEFAULTS)) throw new Error(`createNightLights: unknown option '${k}' (known: ${Object.keys(NIGHT_LIGHTS_DEFAULTS).join(', ')})`);
  if (!engine.lightPool) throw new Error('createNightLights: install the light pool first: engine.use(lightPool({ point: 4, spot: 8 }))');

  /** @type {{ light: any, head: any, halo: THREE.Sprite | null, intensity: number }[]} */
  const lamps = [];
  /** material -> its emissiveIntensity at full night; a Map, because many lamps may share one head material */
  const glows = /** @type {Map<any, number>} */ (new Map());
  const haloMat = new THREE.SpriteMaterial({ map: haloMap(), color: o.lampColor, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const group = new THREE.Group(); group.name = 'nightLights';
  engine.scene.add(group);

  // 0 by day, 1 at night: the curve lightPool applies to a source with dusk, on the daylight the pool reads (the calendar's, the sky's without one)
  const night = () => {
    const x = Math.min(1, Math.max(0, (engine.calendar?.daylight ?? engine.sky?.daylight ?? 1) / o.dusk));
    return 1 - x * x * (3 - 2 * x);
  };
  // its own hook, so this file works alone in any game; onRender, not onFrame, so a time change shows in the same frame
  const hook = engine.onRender(() => {
    const n = night();
    haloMat.opacity = o.haloOpacity * n;
    for (const [m, full] of glows) m.emissiveIntensity = full * n;
  });

  return {
    /** 0 = day (all off) ... 1 = full night */
    get night() { return night(); },
    /**
     * A street lamp. at = the light's position (just under the head). head = the lamp head's material (its emissive is driven).
     * @param {THREE.Vector3 | { x: number, y: number, z: number }} at
     * @param {{ head?: THREE.Material, color?: THREE.ColorRepresentation, intensity?: number, spot?: boolean }} [opts]
     */
    addLamp(at, { head, color = o.lampColor, intensity = o.lampIntensity, spot = true } = {}) {
      const p = new THREE.Vector3(at.x, at.y, at.z);
      const light = engine.lightPool.add(p, { type: spot ? 'spot' : 'point', color, intensity, distance: o.lampDistance, decay: o.lampDecay,
        angle: o.lampAngle, penumbra: o.lampPenumbra, name: 'street lamp', dusk: o.dusk });   // dusk: off by day
      let halo = null;
      if (o.halo) { halo = new THREE.Sprite(haloMat); halo.position.copy(p).y += 0.1; halo.scale.setScalar(o.haloSize); halo.renderOrder = 3; group.add(halo); }
      const lamp = { light, head: head ?? null, halo, intensity };
      lamps.push(lamp);
      if (head) { /** @type {any} */ (head).emissive?.set?.(color); glows.set(head, o.headEmissive); }
      return lamp;
    },
    /** A lit window or sign: the material's emissiveIntensity fades to `base` at night (pass o.signEmissive for signs) */
    addGlow(/** @type {THREE.Material} */ material, base = o.windowEmissive) { glows.set(material, base); },
    describe() { return { night: night(), lamps: lamps.length, glows: glows.size, daylight: engine.calendar?.daylight ?? engine.sky?.daylight ?? null }; },
    dispose() { hook.remove(); for (const l of lamps) l.light.remove(); group.removeFromParent(); haloMat.dispose(); },
  };
}

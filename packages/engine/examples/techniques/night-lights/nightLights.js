// @ts-check
// Technique: street lamps, lit windows and signs that read as light at night without glaring (README.md next to this file). Copy this file
// into a game; in a game the import below becomes `from 'threedog'`. Needs engine.use(lightPool({ spot: n })) for the lamps' real lights.
// What it does: lamps = a pooled SpotLight aimed down (a light pool on the ground, walls above stay dark) + an emissive head + an optional
// soft halo sprite. One daylight curve for all of it, the engine's: the lamps' real lights fade with lightPool.add({ dusk }), windows, signs
// and lamp heads with look.materials.glow (the same curve, render/lookGlow.js), and the halos read the night factor from a glow rule too, so
// nothing here computes daylight itself. The numbers are
// chosen against the tone curve: the head is the only thing bright enough to bloom; windows stay below clipping.
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
  dusk: 0.3,             // daylight (engine.calendar.daylight, 0-1) below which lamps, heads, windows and halos fade in (lightPool / glow dusk)
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
  /** @type {{ remove(): void }[]} */
  const glows = [];
  const haloMat = new THREE.SpriteMaterial({ map: haloMap(), color: o.lampColor, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const group = new THREE.Group(); group.name = 'nightLights';
  engine.scene.add(group);

  // the night factor 0-1 for what has no emissive (the additive halo sprites): a glow rule with night 1 on a hidden reference material writes
  // exactly the engine's factor into its emissiveIntensity (a glow rule only reaches materials of objects in the scene, so it sits in the group)
  const ref = new THREE.MeshLambertMaterial({ emissive: 0xffffff, name: 'nightLights:night' });
  const refMesh = new THREE.Mesh(new THREE.BufferGeometry(), ref); refMesh.visible = false; group.add(refMesh);
  glows.push(engine.look.materials.glow(ref, { night: 1, dusk: o.dusk, owner: 'nightLights' }));
  const hFrame = engine.onFrame(() => { haloMat.opacity = o.haloOpacity * ref.emissiveIntensity; });

  return {
    /** 0 = day (all off) ... 1 = full night (the engine's glow curve at this dusk) */
    get night() { return ref.emissiveIntensity; },
    /**
     * A street lamp. at = the light's position (just under the head). head = the lamp head's material (its emissive is driven).
     * @param {THREE.Vector3 | { x: number, y: number, z: number }} at
     * @param {{ head?: THREE.Material, color?: THREE.ColorRepresentation, intensity?: number, spot?: boolean }} [opts]
     */
    addLamp(at, { head, color = o.lampColor, intensity = o.lampIntensity, spot = true } = {}) {
      const p = new THREE.Vector3(at.x, at.y, at.z);
      const light = engine.lightPool.add(p, { type: spot ? 'spot' : 'point', color, intensity, distance: o.lampDistance, decay: o.lampDecay,
        angle: o.lampAngle, penumbra: o.lampPenumbra, name: 'street lamp', dusk: o.dusk });   // dusk: off by day, on the glow curve
      let halo = null;
      if (o.halo) { halo = new THREE.Sprite(haloMat); halo.position.copy(p).y += 0.1; halo.scale.setScalar(o.haloSize); halo.renderOrder = 3; group.add(halo); }
      const lamp = { light, head: head ?? null, halo, intensity };
      lamps.push(lamp);
      if (head) { /** @type {any} */ (head).emissive?.set?.(color); glows.push(engine.look.materials.glow(head, { night: o.headEmissive, dusk: o.dusk, owner: 'nightLights' })); }
      return lamp;
    },
    /** A lit window or sign (a Material, role or name, as look.materials.glow takes): emissiveIntensity fades to `base` at night (pass o.signEmissive for signs) */
    addGlow(/** @type {any} */ material, base = o.windowEmissive) { const h = engine.look.materials.glow(material, { night: base, dusk: o.dusk, owner: 'nightLights' }); glows.push(h); return h; },
    describe() { return { night: this.night, lamps: lamps.length, glows: glows.length, daylight: engine.calendar?.daylight ?? engine.sky?.daylight ?? null }; },
    dispose() { hFrame?.remove?.(); refMesh.geometry.dispose(); ref.dispose(); for (const l of lamps) l.light.remove(); for (const g of glows) g.remove(); group.removeFromParent(); haloMat.dispose(); },
  };
}

// @ts-check
// Plain-picture lights: sun and ambient from the signals, and the street lamps. Lamp pools are painted (a soft disc on the ground) instead of lit,
// the way an illustrator draws them; a few real PointLights add the warm spill.
import { THREE } from '../../../index.js';
import { PALETTE, DAY, NIGHT, nightOf } from './palette.js';

/** @param {any} engine */
export function createLights(engine) {
  const { scene } = engine;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  scene.add(hemi, sun, sun.target);

  // lamps: an emissive head (main.js builds it), a painted pool on the ground, and a real PointLight for the nearest few only
  const pools = [], lamps = [];
  const poolMat = new THREE.MeshBasicMaterial({ map: radialTexture(), color: PALETTE.lamp, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  /** @param {number} x @param {number} y @param {number} z */
  function addLamp(x, y, z) {
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(7, 7).rotateX(-Math.PI / 2), poolMat);
    pool.position.set(x * 0.85, 0.02, z); scene.add(pool); pools.push(pool);
    if (lamps.length < 6) {   // more real lights than this slows every lit pixel; far lamps read fine with only the pool and the head
      const l = new THREE.PointLight(PALETTE.lamp, 0, 14, 1.6);
      l.position.set(x, y, z); scene.add(l); lamps.push(l);
    }
  }

  return {
    sun, hemi, addLamp,
    /** @param {any} signals engine.uniforms */
    update(signals) {
      const day = signals.uDaylight.value, night = nightOf(day), rain = signals.uRain.value;
      // sun: points along the engine's sun direction; off at night (the facades' own glow and the lamps carry the night)
      sun.position.copy(signals.uSunDir.value).multiplyScalar(100).add(sun.target.position);
      sun.intensity = 2.2 * day * (1 - rain * 0.6);
      sun.color.set(0xfff0d8);
      // ambient stays warm-ish at night (a cold blue ambient multiplied onto warm walls is what turns them muddy)
      hemi.color.copy(NIGHT.hemiSky).lerp(DAY.hemiSky, day);
      hemi.groundColor.copy(NIGHT.hemiGround).lerp(DAY.hemiGround, day);
      hemi.intensity = 0.6 + 2.2 * day;   // Lambert under a hemisphere light gives about color x intensity / pi: ~2.8 is 'the wall's own color' at noon
      poolMat.opacity = 0.8 * night;
      for (const l of lamps) l.intensity = 30 * night;
    },
  };
}

// a soft white disc fading to transparent at the edge, drawn once on a canvas
function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

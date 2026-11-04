// @ts-check
// The yard's sun and ambient. The sun starts with the loose shadow; contactShadows.js tightens it on this same light.
import { THREE } from 'threedog';
import { LIGHT, LOOSE_SHADOW } from './palette.js';

/** @param {any} engine */
export function createLights(engine) {
  const { ambient, sun: key } = LIGHT, { extent, mapSize, normalBias, bias } = LOOSE_SHADOW;
  const hemi = new THREE.HemisphereLight(ambient.dayColor, ambient.ground, ambient.intensity);
  const sun = new THREE.DirectionalLight(key.dayColor, key.day);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(mapSize);
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 120 });
  Object.assign(sun.shadow, { normalBias, bias });
  engine.scene.add(hemi, sun, sun.target);

  const dir = new THREE.Vector3(), day = new THREE.Color(), night = new THREE.Color();
  return {
    sun, hemi,
    /** @param {any} s engine.uniforms */
    update(s) {
      const d = s.uSunDir.value, light = s.uDaylight.value;
      // below the horizon the same light is the moon, across the sky from where the sun went
      dir.set(d.y < 0 ? -d.x : d.x, Math.abs(d.y), d.z).normalize();
      // the shadow box sits on what the camera looks at: a tight box only helps where the player is looking
      sun.target.position.copy(engine.focus);
      sun.position.copy(dir).multiplyScalar(60).add(sun.target.position);
      sun.intensity = (key.night + (key.day - key.night) * light) * Math.min(1, Math.abs(d.y) / 0.08);
      sun.color.copy(night.set(key.nightColor)).lerp(day.set(key.dayColor), light);
      // color only: hemi.intensity is the fill, and it belongs to the technique
      hemi.color.copy(night.set(ambient.nightColor)).lerp(day.set(ambient.dayColor), light);
    },
  };
}

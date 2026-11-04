// @ts-check
// The sky and the fog. The engine's dome stays because this world shows its sun, moon, stars and clouds; its colors are this game's, written into the
// dome's uniforms after the sky module's own pass, so what is drawn is the palette. A gradient sphere of our own would lose all four, and GLSL of our own
// would stop the ?renderer=webgpu route; the dome's uniforms work on both renderers.
import { THREE } from '../../../index.js';
import { AMBIENT_PEAK, CLOUDS, FOG_NEAR, OVERCAST, sampleSky, skyNow } from './palette.js';

/** @param {any} engine */
export function createSky(engine) {
  const { scene, uniforms: E } = engine, U = engine.sky.uniforms, weather = engine.weather;
  const fog = scene.fog = new THREE.Fog(0x000000, 70, 240);
  U.uCloudCover.value = CLOUDS.coverage; U.uCloudScale.value = CLOUDS.scale; U.uCloudSpeed.value.set(...CLOUDS.speed);
  U.uCloudColor.value.set(CLOUDS.color); U.uCloudShade.value.set(CLOUDS.shade);
  E.uCloudShadow.value = CLOUDS.groundShadow;

  const now = skyNow(), grey = new THREE.Color();
  return {
    now,
    /** @param {any} s engine.uniforms */
    update(s) {
      sampleSky(now, s.uTimeOfDay.value);
      // weather closes the sky toward grey, a grey that dims with the hour; the zenith goes first, the horizon keeps a little of its color
      const amount = weather?.current.grey ?? 0;
      if (amount) {
        grey.set(OVERCAST).multiplyScalar(now.ambient / AMBIENT_PEAK);
        now.top.lerp(grey, amount); now.horizon.lerp(grey, amount * 0.8);
      }
      const flash = weather?.flash ?? 0;
      if (flash) { now.top.addScalar(flash * 0.4); now.horizon.addScalar(flash * 0.3); }
      U.uTop.value.copy(now.top); U.uHorizon.value.copy(now.horizon); U.uSunColor.value.copy(now.sun);
      E.uSkyTop.value.copy(now.top); E.uSkyHorizon.value.copy(now.horizon);
      // the fog is the horizon itself, so the dome needs no band to hide where the ground stops
      U.uFogBand.value = 0;
      fog.color.copy(now.horizon);
      fog.far = s.uViewDistance.value * s.uWeatherFog.value;
      fog.near = fog.far * FOG_NEAR;
    },
  };
}

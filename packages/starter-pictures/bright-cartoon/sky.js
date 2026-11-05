// @ts-check
// Sky and fog: a two-color gradient with cut-out clouds, the same clean edge as every other surface. The fog takes the horizon color.
// With a sky() module its dome is hidden and its signals still run the day; without one the sky simply stays at noon.
import { THREE } from 'threedog';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { color, mix, mx_worley_noise_float, normalize, positionLocal, smoothstep, uniform, vec3 } from 'three/tsl';
import { uniforms } from 'threedog/tsl';
import { blotch, cut } from './paint.js';
import { palette } from './palette.js';

/** @param {any} engine */
export function createSky(engine) {
  const { sky: S, fog: F } = palette, { scene } = engine;
  const top = new THREE.Color(), horizon = new THREE.Color(), c = new THREE.Color(), cloudLight = uniform(1);
  const fog = scene.fog = new THREE.Fog(S.horizon, F.near, F.far);

  const d = normalize(positionLocal), up = d.y.max(0);
  // flatten the dome into a ceiling, so clouds shrink toward the horizon instead of wrapping round it
  const ceiling = vec3(d.x, 0, d.z).div(up.add(0.18)).add(vec3(uniforms(engine).uTime.mul(S.cloudDrift), 0, 0));
  // clouds shrink away near the horizon instead of fading: a soft fade would be a second kind of edge
  const edge = smoothstep(0.25, 0.04, up).mul(0.5).add(S.cloudCover);
  // cell noise on top of the blob: round bumps along the outline, the shape a child draws a cloud with
  const puffy = /** @param {any} p */ p => blotch(p, S.cloudSize).sub(mx_worley_noise_float(p.div(S.cloudPuff)).mul(0.3));
  const body = cut(puffy(ceiling), edge.sub(0.15)), belly = cut(puffy(ceiling.add(vec3(0, 0, 0.09))), edge.sub(0.15));
  const air = mix(uniform(horizon), uniform(top), smoothstep(0, 0.5, up));
  const cloud = mix(color(S.cloudShade), color(S.cloud), belly).mul(cloudLight);

  const mat = new MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  mat.colorNode = mix(air, cloud, body);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  dome.name = 'sky'; dome.renderOrder = -1; dome.frustumCulled = false;
  scene.add(dome);
  if (engine.sky) engine.sky.dome.visible = false;

  return {
    dome,
    /** @param {any} s engine.uniforms */
    update(s) {
      const day = s.uDaylight.value;
      top.set(S.nightTop).lerp(c.set(S.top), day);
      horizon.set(S.nightHorizon).lerp(c.set(S.horizon), day);
      fog.color.copy(horizon);
      cloudLight.value = 0.25 + 0.75 * day;
      dome.position.copy(engine.camera.position);
    },
  };
}

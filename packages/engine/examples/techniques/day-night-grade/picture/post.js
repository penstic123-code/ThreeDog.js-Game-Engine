// @ts-check
// The color grade: one plain ShaderPass whose uniforms the keyframes write directly, so nothing sits between the table and the shader.
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GRADE, sample } from './palette.js';

/** @param {any} engine */
export function createPost(engine) {
  const pass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTemp: { value: 0 }, uSat: { value: 1 }, uContrast: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTemp; uniform float uSat; uniform float uContrast; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv);
        c.rgb += vec3(uTemp * 0.06, 0.0, -uTemp * 0.06);
        c.rgb = clamp((c.rgb - 0.5) * uContrast + 0.5, 0.0, 1.0);
        c.rgb = mix(vec3(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))), c.rgb, uSat);
        gl_FragColor = c; }`,
  });
  const u = pass.uniforms, handle = engine.post.add(pass, { name: 'grade', slot: 'ldr' });   // 'ldr': after the tone curve, on display colors
  return {
    grade: () => ({ temperature: u.uTemp.value, saturation: u.uSat.value, contrast: u.uContrast.value }),
    remove: () => handle.remove(),
    /** @param {any} s engine.uniforms */
    update(s) { [u.uTemp.value, u.uSat.value, u.uContrast.value] = sample(GRADE, s.uTimeOfDay.value); },
  };
}

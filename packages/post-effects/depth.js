// What the depth-reading effects (dof, outline) share: the fullscreen vertex shader and scene depth as distance from the camera, in GLSL and as nodes.
import { CopyShader } from 'three/addons/shaders/CopyShader.js';

export const FULLSCREEN_VERT = CopyShader.vertexShader;

/** GLSL lin(depth texture, uv): distance from the camera. Goes with depthUniforms() */
export const DEPTH_GLSL = `uniform float uNear; uniform float uFar; uniform float uOrtho;
  float lin(sampler2D t, vec2 uv){ float z = texture2D(t, uv).x * 2.0 - 1.0; if (uOrtho > 0.5) return uNear + (z * 0.5 + 0.5) * (uFar - uNear); return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }`;

export const depthUniforms = () => ({ uNear: { value: 0.3 }, uFar: { value: 1000 }, uOrtho: { value: 0 } });

/** The camera into depthUniforms() before a draw; ortho depth is linear already @param {any} u @param {any} camera */
export function writeDepthUniforms(u, camera) {
  u.uNear.value = camera.near; u.uFar.value = camera.far; u.uOrtho.value = camera.isOrthographicCamera ? 1 : 0;
}

/**
 * The same on WebGPU. far: the camera's far as a uniform node; lin(texture node, uv): distance from the camera (the depth -> view z helpers follow the backend's depth range).
 * @param {any} T three/tsl @param {any} camera
 */
export function depthNodes(T, camera) {
  const near = T.uniform(camera.near).onRenderUpdate(() => camera.near), far = T.uniform(camera.far).onRenderUpdate(() => camera.far);
  const ortho = T.uniform(0).onRenderUpdate(() => (camera.isOrthographicCamera ? 1 : 0));
  const lin = (tex, uv) => { const d = tex.sample(uv).x; return T.select(ortho.greaterThan(0.5), T.orthographicDepthToViewZ(d, near, far), T.perspectiveDepthToViewZ(d, near, far)).negate(); };
  return { far, lin };
}

import { codedError } from '../../core/errorHints.js';
// Orthographic projection for engine.camera, without replacing the camera object: engine.camera is an EngineCamera (core/engineCamera.js), whose
// own updateProjectionMatrix draws orthographic while orthoSize is set. Nothing is patched on the instance; describe().camera.projection reports it.

/**
 * Switch engine.camera between perspective and orthographic.
 * @param {import('three').PerspectiveCamera} cam engine.camera
 * @param {'perspective' | 'orthographic'} projection
 * @param {number} [size] orthographic only: world units covered by the view height (before camera.zoom)
 */
export function setProjection(cam, projection = 'perspective', size = 20) {
  if (projection !== 'perspective' && projection !== 'orthographic') throw codedError('camera-option', `projection must be 'perspective' or 'orthographic', got '${projection}'`);
  if (projection === 'orthographic' && !(size > 0)) throw codedError('camera-option', `orthographic projection needs size > 0 (world units of view height), got ${size}`);
  const c = /** @type {any} */ (cam);
  if (!('orthoSize' in c)) throw codedError('camera-option', "orthographic projection needs engine.camera (an EngineCamera); a camera you made yourself is plain three.js: use a THREE.OrthographicCamera and render with it");
  const ortho = projection === 'orthographic';
  if (ortho ? c.orthoSize === size : !c.orthoSize) return;
  c.orthoSize = ortho ? size : 0;
  c.isOrthographicCamera = ortho; c.isPerspectiveCamera = !ortho;
  c.updateProjectionMatrix();
}

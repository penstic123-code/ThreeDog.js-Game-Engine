// Orthographic projection for engine.camera, without replacing the camera object.
//
// engine.camera is one PerspectiveCamera that the render pass, post chain, cascaded shadows, sky and every module hold a reference to.
// Swapping in a THREE.OrthographicCamera would leave those pointing at the old camera, so the rig flips this same instance instead:
// updateProjectionMatrix() builds an orthographic matrix while camera.orthoSize is set (isPerspectiveCamera / isOrthographicCamera and
// left/right/top/bottom follow, so code that branches on the camera type keeps working), and the original perspective one otherwise.
// Resize needs nothing extra: canvasBox sets camera.aspect and calls updateProjectionMatrix().

/**
 * Switch engine.camera between perspective and orthographic.
 * @param {import('three').PerspectiveCamera} cam engine.camera
 * @param {'perspective' | 'orthographic'} projection
 * @param {number} [size] orthographic only: world units covered by the view height (before camera.zoom)
 */
export function setProjection(cam, projection = 'perspective', size = 20) {
  if (projection !== 'perspective' && projection !== 'orthographic') throw new Error(`projection must be 'perspective' or 'orthographic', got '${projection}'`);
  if (projection === 'orthographic' && !(size > 0)) throw new Error(`orthographic projection needs size > 0 (world units of view height), got ${size}`);
  if (!cam._perspectiveUpdate) {
    const original = cam.updateProjectionMatrix;
    cam._perspectiveUpdate = original;
    cam.updateProjectionMatrix = function () {
      if (!this.orthoSize) return original.call(this);
      const top = this.orthoSize / 2 / this.zoom, right = top * this.aspect;
      this.left = -right; this.right = right; this.top = top; this.bottom = -top;
      this.projectionMatrix.makeOrthographic(-right, right, top, -top, this.near, this.far, this.coordinateSystem);
      this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    };
  }
  const ortho = projection === 'orthographic';
  if (ortho ? cam.orthoSize === size : !cam.orthoSize) return;
  cam.orthoSize = ortho ? size : 0;
  cam.isOrthographicCamera = ortho; cam.isPerspectiveCamera = !ortho;
  cam.updateProjectionMatrix();
}

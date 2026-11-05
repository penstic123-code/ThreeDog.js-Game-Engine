// engine.camera's class: a THREE.PerspectiveCamera that can also draw orthographic (camera rigs with projection: 'orthographic').
//
// Why a subclass and not a swap to THREE.OrthographicCamera: engine.camera is one object that the render pass, post chain, cascaded shadows,
// sky, particles and every module hold a reference to; a swap would leave them drawing with the old camera. Why not a method replaced on the
// instance: that would be a second, invisible takeover form on a plain three.js object that nothing reports. Here the behavior is the class's
// own method, marked by camera.isEngineCamera and reported by describe().camera.projection; a game that wants a real THREE.OrthographicCamera renders with its own (engine.renderer.render(scene, cam)).
// While orthoSize is set, isPerspectiveCamera / isOrthographicCamera and left / right / top / bottom follow, so code that branches on the camera
// type (three's renderer, raycaster, CSM) keeps working. Resize needs nothing extra: the resize follow-up (canvasBox.js) writes camera.aspect and calls updateProjectionMatrix().
import * as THREE from 'three';

export class EngineCamera extends THREE.PerspectiveCamera {
  constructor(fov, aspect, near, far) {
    super(fov, aspect, near, far);
    /** World units covered by the view height while orthographic (before zoom); 0 = perspective. Set through a camera rig's projection */
    this.orthoSize = 0;
    /** Marks engine.camera's class (minified builds rename it): the orthographic switch lives in this class, never on the instance */
    this.isEngineCamera = true;
  }
  updateProjectionMatrix() {
    if (!this.orthoSize) return super.updateProjectionMatrix();
    const top = this.orthoSize / 2 / this.zoom, right = top * this.aspect;
    this.left = -right; this.right = right; this.top = top; this.bottom = -top;
    this.projectionMatrix.makeOrthographic(-right, right, top, -top, this.near, this.far, this.coordinateSystem);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
  copy(source, recursive) {
    super.copy(source, recursive);
    this.orthoSize = source.orthoSize ?? 0;
    this.isOrthographicCamera = !!this.orthoSize; this.isPerspectiveCamera = !this.orthoSize;
    return this;
  }
}

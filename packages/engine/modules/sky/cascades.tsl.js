// Sky cascaded shadows on WebGPURenderer (the WebGPU half of cascades.js; loaded only through threedog/tsl, render/fx/index.js).
// Why three's CSMShadowNode and not the WebGL design: the cascades become the shadow node of the one sun light (sun.shadow.shadowNode),
// so a material is lit by the sun once and shadowed by whichever cascade covers it. Nothing is patched and the scene is never walked:
// the 'csm' patch, the per-frame scene visitor and look.shadow.include() exist on WebGL only because there every cascade is a full
// DirectionalLight that would light an unpatched material N times (user decision 4, docs/plans/2026-11-03-webgpu-phase2.md).
// How it differs from the node used as-is, each one because the plain node would break something here:
// - The sun's shadow camera gets near 1 / far lightMargin + 2 * maxFar before the node clones it into the cascades. The node only sizes
//   each cascade sideways and puts its light lightMargin behind the slice; with the sky's far kept, the far cascades' ground lies past far
//   and draws no shadow at all (what E2 saw). Three's WebGL CSM sets the same lightFar itself.
// - The cascades are built with engine.camera, never with whatever camera compiles first (a probe or photo render would own them).
// - Placement waits for frames whose cascade maps redraw (shadow.updateEvery > 1): moving the cascade lights while the maps stay old
//   shifts every shadow, the same reason cascades.js only calls csm.update() on shadow frames.
// - Switching it on or off tells three's light node to rebuild its shadow (the light's 'dispose' event): the node caches the shadow it
//   built first and would keep drawing the old one.
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { setShadowUpdate, shadowUpdatePending, registerWebGPUPart } from '../../render/backend.js';

class SkyCascadeNode extends CSMShadowNode {
  /** @param {any} sky @param {any} S sky.shadow */
  constructor(sky, S) {
    const custom = typeof S.split === 'function';
    super(sky._sun, { cascades: S.cascades, maxFar: S.maxFar, mode: custom ? 'custom' : S.split, customSplitsCallback: custom ? S.split : undefined, lightMargin: S.lightMargin });
    this.isSkyCascadeNode = true;
    this.fade = S.fade;
    this._sky = sky;   // underscore names: three walks a node's public fields looking for child nodes
    /** the WebGL route's material bookkeeping, empty here (nothing is patched): includeInCascades and the describe().owned row read it */
    this.mats = new Map();
    this._at = { x: Infinity, y: 0, z: 0 };   // camera position at the last early update
    this._proj = '';
    const sc = sky._sun.shadow.camera;
    Object.assign(sc, { near: 1, far: S.lightMargin + 2 * S.maxFar }); sc.updateProjectionMatrix();
    sky._sun.shadow.shadowNode = this;
    rebuildShadow(sky._sun);
  }
  setup(builder) {
    // _init is the node's own first-build step (cascade stand-in lights, frustums); run it with the engine camera instead of builder.camera
    // (private to three, so not in @types/three)
    if (this.camera === null) /** @type {any} */ (this)._init({ camera: this._sky.engine.camera, renderer: builder.renderer });
    return super.setup(builder);
  }
  /** @param {any} frame @returns {boolean} false would make three call it again this frame (NodeFrame) */
  updateBefore(frame) {
    if (this.lights.length && !this.lights.some(l => l.shadow.autoUpdate || l.shadow.needsUpdate)) return true;   // no cascade map redraws this frame
    return super.updateBefore(frame);
  }
  fit() {}
  gameMaterials() { return []; }
  /** Copy look.shadow fields to the cascades (the node itself scales bias by cascade: bias x (i + 1), kept) @param {any} S */
  shadowParams(S) {
    this.lights.forEach((l, i) => Object.assign(l.shadow, { bias: S.bias * (i + 1), normalBias: S.normalBias, radius: S.radius, blurSamples: S.blurSamples }));
  }
  /** Per frame (cascades.js cascadeFrame): aim the sun, follow a new camera / projection, update early after a jump @param {any} lightDir unit vector toward the light */
  frame(lightDir) {
    const sky = this._sky, e = sky.engine, cam = e.camera, sun = sky._sun, S = sky.shadow;
    sun.position.copy(sun.target.position).addScaledVector(lightDir, sky.orbit.distance);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    if (this.camera === null) return;   // not built yet: setup() takes engine.camera
    const proj = cam.isPerspectiveCamera ? `${cam.fov},${cam.aspect},${cam.near},${cam.far},${cam.zoom}` : `${cam.left},${cam.right},${cam.near},${cam.far},${cam.zoom}`;
    let force = false;
    if (this.camera !== cam || proj !== this._proj) { this.camera = cam; this._proj = proj; this.updateFrustums(); force = true; }
    cam.updateMatrixWorld();
    if (S.updateEvery <= 1) return;
    // not updating every frame: also update early when the camera left a quarter of the nearest cascade (teleport, fast travel)
    const near = this.breaks[0] * Math.min(cam.far, this.maxFar), p = cam.position, d = (p.x - this._at.x) ** 2 + (p.y - this._at.y) ** 2 + (p.z - this._at.z) ** 2;
    if (force || d > (near / 4) ** 2) { setShadowUpdate(e.renderer, e.scene, { now: true }); this._at = { x: p.x, y: p.y, z: p.z }; }
    else if (shadowUpdatePending(e.renderer, e.scene)) this._at = { x: p.x, y: p.y, z: p.z };
  }
  /** Switch off: the cascade lights and maps go, the sun gets its plain shadow back */
  drop() {
    const sun = this._sky._sun;
    delete sun.shadow.shadowNode;   // three tests `!== undefined`: null would count as a node
    for (const n of /** @type {any} */ (this)._shadowNodes) n.dispose();   // the node's own dispose() leaves the cascade maps on the GPU (private field)
    this.dispose();
    rebuildShadow(sun);
  }
}

/** Make three's light node drop the shadow it cached (AnalyticLightNode listens for the light's 'dispose'; its version bump recompiles) */
function rebuildShadow(light) { light.dispatchEvent({ type: 'dispose' }); }

// cascades.js looks this up when the renderer is a WebGPURenderer (the WebGL bundle never imports three/webgpu); nothing to call
registerWebGPUPart('cascades', Object.freeze({ create: (sky, S) => new SkyCascadeNode(sky, S) }));

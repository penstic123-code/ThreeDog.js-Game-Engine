// Outline post effect: dark lines where depth jumps (object silhouettes), where surface normals turn sharply (creases), or both;
// optional hand-drawn wobble and per-object exemption through a three.js layer.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
/** @import { PostEffect } from 'threedog' */

/** Layer number to put on objects that should get no outline: mesh.layers.enable(OUTLINE_OFF_LAYER), with outline({ offLayer: OUTLINE_OFF_LAYER }) */
export const OUTLINE_OFF_LAYER = 29;
const MODES = { depth: 0, normal: 1, both: 2 };

class OutlinePass extends Pass {
  /** @param {any} scene @param {any} camera @param {Record<string, any>} p */
  constructor(scene, camera, p) {
    super();
    this.scene = scene; this.camera = camera; this.p = p; this.time = 0;
    this.normalMat = new THREE.MeshNormalMaterial();
    this.maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.normalRT = null; this.maskRT = null;
    this.material = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, tNormal: { value: null }, tMask: { value: null }, tMaskDepth: { value: null },
        uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.3 }, uFar: { value: 1000 }, uOrtho: { value: 0 }, uColor: { value: new THREE.Color(p.color) },
        uThick: { value: 1 }, uStrength: { value: 1 }, uMode: { value: 0 }, uFade: { value: 1 }, uWobble: { value: 0 }, uTime: { value: 0 }, uUseMask: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform sampler2D tNormal; uniform sampler2D tMask; uniform sampler2D tMaskDepth;
        uniform vec2 uTexel; uniform float uNear; uniform float uFar; uniform float uOrtho; uniform vec3 uColor; uniform float uThick; uniform float uStrength;
        uniform float uMode; uniform float uFade; uniform float uWobble; uniform float uTime; uniform float uUseMask;
        varying vec2 vUv;
        float lin(sampler2D t, vec2 uv){ float z = texture2D(t, uv).x * 2.0 - 1.0; if (uOrtho > 0.5) return uNear + (z * 0.5 + 0.5) * (uFar - uNear); return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
        // object in the exempt layer at this pixel: its own render is not behind what the scene depth saw
        float masked(vec2 uv){ return texture2D(tMask, uv).r > 0.5 && lin(tMaskDepth, uv) <= lin(tDepth, uv) + 0.05 ? 1.0 : 0.0; }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          vec2 o = uTexel * uThick;
          vec2 uv = vUv;
          if (uWobble > 0.0) uv += (vec2(vn(vUv / uTexel * 0.04 + uTime), vn(vUv / uTexel * 0.04 + 17.3 + uTime)) - 0.5) * 2.0 * uWobble * uTexel;
          vec2 nb[4] = vec2[4](vec2(o.x, 0.0), vec2(-o.x, 0.0), vec2(0.0, o.y), vec2(0.0, -o.y));   // the four neighbors, thickness apart
          float d = lin(tDepth, uv), edge = 0.0;
          if (uMode != 1.0) {
            float e = 0.0;
            for (int i = 0; i < 4; i++) e += abs(lin(tDepth, uv + nb[i]) - d);
            edge = smoothstep(0.08, 0.3, e / max(d, 0.5) * 4.0);
          }
          if (uMode != 0.0) {
            vec3 n = texture2D(tNormal, uv).xyz * 2.0 - 1.0;
            float k = 0.0;
            for (int i = 0; i < 4; i++) k += 1.0 - dot(n, texture2D(tNormal, uv + nb[i]).xyz * 2.0 - 1.0);
            edge = max(edge, smoothstep(0.35, 0.8, k));
          }
          if (uFade > 0.5) edge *= 1.0 - smoothstep(uFar * 0.4, uFar * 0.9, d);
          if (uUseMask > 0.5) { float m = masked(vUv); for (int i = 0; i < 4; i++) m = max(m, masked(vUv + nb[i])); edge *= 1.0 - m; }
          gl_FragColor = vec4(mix(c.rgb, uColor, edge * uStrength), c.a);
        }`,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  // Render the scene once with an override material into a target the size of the input
  _pass(renderer, rt, mat, layer) {
    const { scene, camera } = this, bg = scene.background, fog = scene.fog, mask = camera.layers.mask, color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;   // an override material is unlit: redrawing the shadow maps for it would be pure waste
    scene.overrideMaterial = mat; scene.background = null; scene.fog = null;
    if (layer != null) camera.layers.set(layer);
    // linear (0.5, 0.5, 1): an empty pixel reads as a normal facing the camera, and for the mask its red 0.5 stays below the > 0.5 test
    renderer.setClearColor(new THREE.Color().setRGB(0.5, 0.5, 1, THREE.LinearSRGBColorSpace), 1);
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, camera);
    scene.overrideMaterial = null; scene.background = bg; scene.fog = fog; camera.layers.mask = mask; renderer.setClearColor(color, alpha);
    renderer.shadowMap.autoUpdate = shadows;
  }
  _target(rt, w, h, depth) {
    if (rt && (rt.width !== w || rt.height !== h)) { rt.setSize(w, h); return rt; }
    if (rt) return rt;
    rt = new THREE.WebGLRenderTarget(w, h);
    if (depth) rt.depthTexture = new THREE.DepthTexture(w, h);
    return rt;
  }
  render(renderer, writeBuffer, readBuffer, deltaTime) {
    const u = this.material.uniforms, p = this.p, mode = MODES[p.mode], w = readBuffer.width, h = readBuffer.height;
    // wobble redraws at 8 steps a second, like a hand-drawn flip book, so the lines tremble instead of swimming
    this.time = (this.time + deltaTime) % 64;
    if (mode !== 0) { this.normalRT = this._target(this.normalRT, w, h, true); this._pass(renderer, this.normalRT, this.normalMat); u.tNormal.value = this.normalRT.texture; }
    const useMask = p.offLayer != null;
    if (useMask) { this.maskRT = this._target(this.maskRT, w, h, true); this._pass(renderer, this.maskRT, this.maskMat, p.offLayer); u.tMask.value = this.maskRT.texture; u.tMaskDepth.value = this.maskRT.depthTexture; }
    u.tDiffuse.value = readBuffer.texture; u.tDepth.value = readBuffer.depthTexture;
    u.uTexel.value.set(1 / w, 1 / h);
    u.uNear.value = this.camera.near; u.uFar.value = this.camera.far; u.uOrtho.value = this.camera.isOrthographicCamera ? 1 : 0;   // ortho depth is linear already
    u.uMode.value = mode; u.uUseMask.value = useMask ? 1 : 0; u.uTime.value = Math.floor(this.time * 8);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.material.dispose(); this.quad.dispose(); this.normalMat.dispose(); this.maskMat.dispose(); this.normalRT?.dispose(); this.maskRT?.dispose(); }
}

function apply(pass, p) {
  if (!(p.mode in MODES)) throw new Error(`outline: unknown mode '${p.mode}', use 'depth' | 'normal' | 'both'`);
  pass.p = p;
  const u = pass.material.uniforms;
  u.uColor.value.set(p.color); u.uThick.value = p.thickness; u.uStrength.value = p.strength; u.uFade.value = p.fadeWithDistance ? 1 : 0; u.uWobble.value = p.wobble;
}

/**
 * Dark lines (cartoon look), hdr slot, before bloom so the glow does not blur the lines.
 * mode 'depth' (default): silhouettes where depth jumps; 'normal': creases where surface normals turn (the scene is drawn once more with
 * normals; costly, off by default on low-tier devices); 'both': either. Objects can opt out of the lines with offLayer.
 * @example
 * engine.look.post.add(outline({ enabled: true, color: 0x222222, thickness: 1.5 }))
 * engine.look.post.add(outline({ enabled: true, mode: 'both', wobble: 1.5, offLayer: OUTLINE_OFF_LAYER }))   // hand-drawn; then: sky.layers.enable(OUTLINE_OFF_LAYER)
 * @param {{ color?: any, thickness?: number, strength?: number, mode?: 'depth' | 'normal' | 'both', fadeWithDistance?: boolean, wobble?: number,
 *   offLayer?: number | null, enabled?: boolean, order?: number }} [o]
 *   fadeWithDistance: lines fade out in the far 40..90% of the camera range (default true); wobble: line jitter in pixels (0 = straight);
 *   offLayer: objects with this three.js layer enabled get no outline (costs one extra render of just those objects; null = off)
 * @returns {PostEffect}
 */
export function outline({ color = 0x222222, thickness = 1, strength = 0.8, mode = 'depth', fadeWithDistance = true, wobble = 0, offLayer = null, enabled, order = 10 } = {}) {
  return { name: 'outline', slot: 'hdr', order, enabled, needsDepth: true, costly: mode !== 'depth', params: { color, thickness, strength, mode, fadeWithDistance, wobble, offLayer },
    create: ({ scene, camera, params }) => { const pass = new OutlinePass(scene, camera, params); apply(pass, params); return pass; },
    update: apply, node: outlineNode };
}

/**
 * WebGPU: the same steps as OutlinePass's fragment shader, as one node (not three's OutlineNode, which outlines selected objects, a different
 * effect). Depth comes from the scene pass; the normal and mask views are extra scene renders made through ctx.display.pass, so this file never
 * imports three/webgpu. Number / boolean params are live uniforms (ctx.p); mode and offLayer on / off rebuild the node, as any non-number param does.
 * @param {any} input @param {any} ctx
 */
function outlineNode(input, { tsl: T, display, scenePass, scene, camera, params, p }) {
  const mode = MODES[params.mode];
  if (mode === undefined) throw new Error(`outline: unknown mode '${params.mode}', use 'depth' | 'normal' | 'both'`);
  const near = T.uniform(camera.near).onRenderUpdate(() => camera.near), far = T.uniform(camera.far).onRenderUpdate(() => camera.far);
  const ortho = T.uniform(0).onRenderUpdate(() => (camera.isOrthographicCamera ? 1 : 0));
  // the color param may be a number (then ctx.p holds a float uniform, not a color) or a Color: read the param itself every render
  const tint = new THREE.Color(), col = T.uniform(tint).onRenderUpdate(() => { tint.set(params.color); });
  // distance from the camera, from a depth texture; the depth -> view z helpers follow the backend's depth range, the GLSL does it by hand
  const lin = (tex, uv) => { const d = tex.sample(uv).x; return T.select(ortho.greaterThan(0.5), T.orthographicDepthToViewZ(d, near, far), T.perspectiveDepthToViewZ(d, near, far)).negate(); };
  const depthTex = scenePass.getTextureNode('depth');
  const texel = T.vec2(1).div(T.screenSize), o = texel.mul(p.thickness), base = T.screenUV;
  const nb = [T.vec2(o.x, 0), T.vec2(o.x.negate(), 0), T.vec2(0, o.y), T.vec2(0, o.y.negate())];   // the four neighbors, thickness apart
  // wobble: value noise on the pixel grid, redrawn 8 times a second (flip-book trembling); the GLSL counts its own clock modulo 64 s the same way
  const h2 = q => T.fract(T.sin(T.dot(q, T.vec2(127.1, 311.7))).mul(43758.5453));
  const vn = q => { const i = T.floor(q), f0 = T.fract(q), f = f0.mul(f0).mul(f0.mul(-2).add(3));
    return T.mix(T.mix(h2(i), h2(i.add(T.vec2(1, 0))), f.x), T.mix(h2(i.add(T.vec2(0, 1))), h2(i.add(T.vec2(1, 1))), f.x), f.y); };
  const tick = T.floor(T.mod(T.time, 64).mul(8)), px = base.div(texel).mul(0.04);
  const jitter = T.vec2(vn(px.add(tick)), vn(px.add(17.3).add(tick))).sub(0.5).mul(2).mul(p.wobble).mul(texel);
  const uv = T.select(p.wobble.greaterThan(0), base.add(jitter), base);
  const d = lin(depthTex, uv);
  let edge = T.float(0);
  if (mode !== 1) {
    const e = nb.reduce((s, n) => s.add(lin(depthTex, uv.add(n)).sub(d).abs()), T.float(0));
    edge = T.smoothstep(0.08, 0.3, e.div(T.max(d, 0.5)).mul(4));
  }
  // An extra render of the scene with one material, no background or fog. three's MeshNormalNodeMaterial stores its packed normal as an sRGB
  // color (decoded to linear, so the canvas looks like WebGL's), unlike WebGL's MeshNormalMaterial in a render target, so the sample is
  // re-encoded with the sRGB curve before unpacking; the clear is the sRGB (0.5, 0.5, 1) for the same reason: an empty pixel then reads as a
  // normal facing the camera (as OutlinePass._pass), and for the mask its red (0.21 linear) stays below the > 0.5 test
  const view = (mat, layer) => {
    const v = display.pass(scene, camera);
    v.overrideMaterial = mat;
    const L = layer && new THREE.Layers(), run = v.updateBefore.bind(v), free = v.dispose.bind(v), clear = new THREE.Color(), was = new THREE.Color();
    if (L) v.setLayers(L);
    v.updateBefore = frame => {
      const r = frame.renderer, bg = scene.background, fog = scene.fog, a = r.getClearAlpha();
      if (L) L.set(params.offLayer);
      r.getClearColor(was);
      r.setClearColor(clear.setRGB(0.5, 0.5, 1, THREE.SRGBColorSpace), 1);
      scene.background = null; scene.fog = null;
      try { run(frame); } finally { scene.background = bg; scene.fog = fog; r.setClearColor(was, a); }
    };
    v.dispose = () => { free(); mat.dispose(); };
    return v;
  };
  if (mode !== 0) {
    const nTex = view(new THREE.MeshNormalMaterial()).getTextureNode(), unpack = q => T.sRGBTransferOETF(nTex.sample(q).xyz).mul(2).sub(1), n = unpack(uv);
    const k = nb.reduce((s, q) => s.add(T.float(1).sub(T.dot(n, unpack(uv.add(q))))), T.float(0));
    edge = T.max(edge, T.smoothstep(0.35, 0.8, k));
  }
  edge = edge.mul(T.select(p.fadeWithDistance.greaterThan(0.5), T.float(1).sub(T.smoothstep(far.mul(0.4), far.mul(0.9), d)), T.float(1)));
  if (params.offLayer != null) {
    const m = view(new THREE.MeshBasicMaterial({ color: 0xffffff }), true), mTex = m.getTextureNode(), mDepth = m.getTextureNode('depth');
    // object in the exempt layer at this pixel: its own render is not behind what the scene depth saw (unwobbled uv, as the GLSL)
    const masked = q => T.select(mTex.sample(q).r.greaterThan(0.5).and(lin(mDepth, q).lessThanEqual(lin(depthTex, q).add(0.05))), T.float(1), T.float(0));
    edge = edge.mul(T.float(1).sub(nb.reduce((s, q) => T.max(s, masked(base.add(q))), masked(base))));
  }
  return T.vec4(T.mix(input.rgb, col, edge.mul(p.strength)), input.a);
}

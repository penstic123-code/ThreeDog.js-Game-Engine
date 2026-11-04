// Depth of field: blur by distance from a focus plane, read from the scene depth texture (hdr slot, needsDepth).
// It swaps buffers like any pass, but copies the scene depth into its output target (gl_FragDepth, same fullscreen draw, no extra pass or target),
// so a later depth reader such as outline still finds the scene's depth in the buffer it reads; keepsDepth tells the chain check so.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
/** @import { PostEffect } from 'threedog' */

class DofPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.keepsDepth = true;
    this.material = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.3 }, uFar: { value: 1000 }, uOrtho: { value: 0 },
        uFocus: { value: 10 }, uRange: { value: 2 }, uFalloff: { value: 20 }, uMaxBlur: { value: 6 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uNear; uniform float uFar; uniform float uOrtho;
        uniform float uFocus; uniform float uRange; uniform float uFalloff; uniform float uMaxBlur;
        varying vec2 vUv;
        float lin(vec2 uv){ float z = texture2D(tDepth, uv).x * 2.0 - 1.0; if (uOrtho > 0.5) return uNear + (z * 0.5 + 0.5) * (uFar - uNear); return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        float coc(float d){ return clamp((abs(d - uFocus) - uRange) / uFalloff, 0.0, 1.0) * uMaxBlur; }
        void main(){
          gl_FragDepth = texture2D(tDepth, vUv).x;
          float r = coc(lin(vUv));
          if (r < 0.5) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
          vec3 sum = texture2D(tDiffuse, vUv).rgb; float w = 1.0;
          // golden-angle disk; a neighbor in sharp focus (smaller blur than its distance) is left out so a crisp object does not bleed into the haze
          for (int i = 1; i < 16; i++) {
            float t = float(i) / 16.0, a = float(i) * 2.39996;
            vec2 o = vec2(cos(a), sin(a)) * sqrt(t) * r;
            float s = step(length(o) * 0.5, coc(lin(vUv + o * uTexel)) + 0.5);
            sum += texture2D(tDiffuse, vUv + o * uTexel).rgb * s; w += s;
          }
          gl_FragColor = vec4(sum / w, 1.0);
        }`,
    });
    // the depth test always passes; depth writes are on only to store gl_FragDepth
    this.material.depthTest = true; this.material.depthWrite = true; this.material.depthFunc = THREE.AlwaysDepth;
    this.quad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture; u.tDepth.value = readBuffer.depthTexture;
    u.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    u.uNear.value = this.camera.near; u.uFar.value = this.camera.far; u.uOrtho.value = this.camera.isOrthographicCamera ? 1 : 0;   // ortho depth is linear already
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.material.dispose(); this.quad.dispose(); }
}

/**
 * Depth of field (hdr slot, heavy on weak devices): everything farther from `focus` than `range` blurs, up to `maxBlur` pixels over `falloff` meters.
 * It reads scene depth, so it must run before any pass that swaps buffers; it passes the scene depth on in its output, so a depth reader
 * after it (outline, whose default order is later) works: both can be on, lines drawn over the blurred image. Move the focus per frame with
 * engine.post.get('dof').set({ focus: distanceToTarget }).
 * @example engine.post.add(dof({ enabled: true, focus: 8, range: 3, maxBlur: 5 }))
 * @param {{ focus?: number, range?: number, falloff?: number, maxBlur?: number, enabled?: boolean, order?: number }} [o]
 *   focus, range, falloff in meters; maxBlur in device pixels
 * @returns {PostEffect}
 */
export function dof({ focus = 10, range = 2, falloff = 20, maxBlur = 6, enabled, order = 5 } = {}) {
  const update = (pass, p) => { const u = pass.material.uniforms; u.uFocus.value = p.focus; u.uRange.value = p.range; u.uFalloff.value = p.falloff; u.uMaxBlur.value = p.maxBlur; };
  return { name: 'dof', slot: 'hdr', order, enabled, needsDepth: true, params: { focus, range, falloff, maxBlur },
    create: ({ camera, params }) => { const pass = new DofPass(camera); update(pass, params); return pass; }, update, node: dofNode };
}

/**
 * WebGPU: DofPass's fragment shader as a node (not three's DepthOfFieldNode, whose focus / blur parameters mean other things), same
 * golden-angle disk and the same rule that keeps sharp neighbors out. The color so far becomes a texture (ctx.display.texture) because the disk
 * samples it at other pixels; depth is always the scene pass's own, so no depth copy is needed here (that is the WebGL pass's keepsDepth).
 * All four params are numbers, so set() of any of them writes a uniform and never rebuilds.
 * @param {any} input @param {any} ctx
 */
function dofNode(input, { tsl: T, display, scenePass, camera, p }) {
  const near = T.uniform(camera.near).onRenderUpdate(() => camera.near), far = T.uniform(camera.far).onRenderUpdate(() => camera.far);
  const ortho = T.uniform(0).onRenderUpdate(() => (camera.isOrthographicCamera ? 1 : 0));
  const depth = scenePass.getTextureNode('depth'), color = display.texture(input), uv = T.screenUV, texel = T.vec2(1).div(T.screenSize);
  const lin = q => { const d = depth.sample(q).x; return T.select(ortho.greaterThan(0.5), T.orthographicDepthToViewZ(d, near, far), T.perspectiveDepthToViewZ(d, near, far)).negate(); };
  const coc = d => T.clamp(d.sub(p.focus).abs().sub(p.range).div(p.falloff), 0, 1).mul(p.maxBlur);
  const r = coc(lin(uv)).toVar();
  let sum = color.sample(uv).rgb, w = T.float(1);
  for (let i = 1; i < 16; i++) {
    const t = i / 16, a = i * 2.39996;
    const o = T.vec2(Math.cos(a), Math.sin(a)).mul(Math.sqrt(t)).mul(r), q = uv.add(o.mul(texel));
    const s = T.step(r.mul(Math.sqrt(t) * 0.5), coc(lin(q)).add(0.5));   // length(o) * 0.5, with |o| = sqrt(t) * r
    sum = sum.add(color.sample(q).rgb.mul(s)); w = w.add(s);
  }
  return T.select(r.lessThan(0.5), color.sample(uv), T.vec4(sum.div(w), 1));
}

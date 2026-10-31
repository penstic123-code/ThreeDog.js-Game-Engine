// Lowpoly post effects: bloom, ambient occlusion (GTAO) and a depth-based outline, as engine.post effects.
// Other style packs reuse them: import { bloom, outline } from '@threedog/style-lowpoly' and list them in their own style.post.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
/** @import { PostEffect } from 'threedog' */

/**
 * Bloom (glow around bright pixels), hdr slot. Off by default on low-tier devices.
 * @example post: [bloom({ strength: 0.35, radius: 0.5, threshold: 0.85 })]
 * @param {{ strength?: number, radius?: number, threshold?: number, enabled?: boolean, order?: number }} [o]
 * @returns {PostEffect}
 */
export function bloom({ strength = 0.35, radius = 0.5, threshold = 0.85, enabled, order = 30 } = {}) {
  return { name: 'bloom', slot: 'hdr', order, enabled, costly: true, params: { strength, radius, threshold },
    create: ({ width, height, params: p }) => new UnrealBloomPass(new THREE.Vector2(width, height), p.strength, p.radius, p.threshold),
    update: (pass, p) => { pass.strength = p.strength; pass.radius = p.radius; pass.threshold = p.threshold; } };
}

/**
 * Ambient occlusion (soft contact shadows in corners; costly), hdr slot, off unless enabled.
 * @example post: [ao({ enabled: true })]
 * @param {{ enabled?: boolean, order?: number }} [o]
 * @returns {PostEffect}
 */
export function ao({ enabled = false, order = 20 } = {}) {
  return { name: 'ao', slot: 'hdr', order, enabled, costly: true,
    create: ({ scene, camera, width, height }) => new GTAOPass(scene, camera, width, height) };
}

// Outline: compare neighbor depths; a depth jump is an object edge (perspective camera)
class OutlinePass extends Pass {
  /** @param {any} camera @param {Record<string, any>} p */
  constructor(camera, { color, thickness, strength }) {
    super();
    this.camera = camera;
    this.material = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.3 }, uFar: { value: 1000 },
        uColor: { value: new THREE.Color(color) }, uThick: { value: thickness }, uStrength: { value: strength } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uNear; uniform float uFar; uniform vec3 uColor; uniform float uThick; uniform float uStrength;
        varying vec2 vUv;
        float lin(vec2 uv){ float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          vec2 o = uTexel * uThick; float d = lin(vUv);
          float e = abs(lin(vUv + vec2(o.x, 0.0)) - d) + abs(lin(vUv - vec2(o.x, 0.0)) - d) + abs(lin(vUv + vec2(0.0, o.y)) - d) + abs(lin(vUv - vec2(0.0, o.y)) - d);
          float edge = smoothstep(0.08, 0.3, e / max(d, 0.5) * 4.0) * (1.0 - smoothstep(uFar * 0.4, uFar * 0.9, d));
          gl_FragColor = vec4(mix(c.rgb, uColor, edge * uStrength), c.a);
        }`,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture; u.tDepth.value = readBuffer.depthTexture;
    u.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.material.dispose(); this.quad.dispose(); }
}

/**
 * Dark edges where depth jumps (cartoon look), hdr slot, before bloom so the glow does not blur the lines.
 * @example post: [outline({ enabled: true, color: 0x222222, thickness: 1.5 })]
 * @param {{ color?: any, thickness?: number, strength?: number, enabled?: boolean, order?: number }} [o]
 * @returns {PostEffect}
 */
export function outline({ color = 0x222222, thickness = 1, strength = 0.8, enabled = false, order = 10 } = {}) {
  return { name: 'outline', slot: 'hdr', order, enabled, needsDepth: true, params: { color, thickness, strength },
    create: ({ camera, params }) => new OutlinePass(camera, params),
    update: (pass, p) => { const u = pass.material.uniforms; u.uColor.value.set(p.color); u.uThick.value = p.thickness; u.uStrength.value = p.strength; } };
}

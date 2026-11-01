// Bloom and ambient occlusion (GTAO) as engine.post effects (hdr slot). Both are costly, so they start off on low-tier devices.
import * as THREE from 'three';
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

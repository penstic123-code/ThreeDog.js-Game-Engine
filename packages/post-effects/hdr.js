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
 * Ambient occlusion (soft contact shadows in corners; costly), hdr slot, on when listed (enabled: false lists it off). radius: how far a surface looks for
 * occluders, in world units; intensity: 0 = none, 1 = full. Defaults are three's GTAOPass defaults (no look chosen here).
 * Order 20 puts it before bloom (30) and outline, so they see the darkened corners. Other GTAOPass settings: post.object().
 * @example post: [ao({ enabled: true, radius: 0.5 })]
 * @param {{ radius?: number, intensity?: number, enabled?: boolean, order?: number }} [o]
 * @returns {PostEffect}
 */
export function ao({ radius = 0.25, intensity = 1, enabled, order = 20 } = {}) {
  // update in place: GTAOPass keeps its targets and noise, so changing radius never rebuilds it
  const update = (pass, p) => { pass.updateGtaoMaterial({ radius: p.radius }); pass.blendIntensity = p.intensity; };
  return { name: 'ao', slot: 'hdr', order, enabled, costly: true, params: { radius, intensity }, update,
    create: ({ scene, camera, width, height, params }) => { const pass = new GTAOPass(scene, camera, width, height); update(pass, params); return pass; } };
}

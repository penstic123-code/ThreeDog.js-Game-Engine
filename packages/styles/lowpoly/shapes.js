// Lowpoly style pack - procedural shapes the engine asks the style pack for: the default character and the ground pickup.
// Without a style pack the engine draws neutral placeholders (gray capsule, plain box) instead.
import * as THREE from 'three';

// Materials come from the engine passed down by the caller (engine.makeMaterial), so two engines with different styles never share one
function part(engine, geo, color) {
  const m = new THREE.Mesh(geo, engine.makeMaterial('character', { color }));
  m.castShadow = true;
  return m;
}

/**
 * Low-poly humanoid (cylinder body, icosahedron head, box limbs). Each joint is an empty Group with the limb under it; rotating the joint swings the limb.
 * Returns the rig format Character understands; `joints` are exposed on the character as c.armL / c.armR / c.legL / c.legR.
 */
export function humanoid(engine, c) {
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.85; root.add(hips);
  hips.add(part(engine, new THREE.CylinderGeometry(0.28, 0.33, 0.7, 6).translate(0, 0.35, 0), c.body));
  const head = new THREE.Group(); head.position.y = 0.78; hips.add(head);
  head.add(part(engine, new THREE.IcosahedronGeometry(0.27, 0).translate(0, 0.2, 0), c.skin));
  head.add(part(engine, new THREE.IcosahedronGeometry(0.28, 0).scale(1, 0.55, 1).translate(0, 0.36, -0.03), c.hair));
  const limb = (len, w, color, x, y) => { const j = new THREE.Group(); j.position.set(x, y, 0); j.add(part(engine, new THREE.BoxGeometry(w, len, w).translate(0, -len / 2, 0), color)); hips.add(j); return j; };
  const armL = limb(0.6, 0.13, c.body, -0.37, 0.65), armR = limb(0.6, 0.13, c.body, 0.37, 0.65);
  const legL = limb(0.85, 0.17, c.legs, -0.14, 0.02), legR = limb(0.85, 0.17, c.legs, 0.14, 0.02);
  return {
    root, body: hips, head, joints: { armL, armR, legL, legR },
    limbs: [
      { joint: legL, offset: 0, amp: 0.9, kind: 'leg' }, { joint: legR, offset: Math.PI, amp: 0.9, kind: 'leg' },
      { joint: armL, offset: Math.PI, amp: 0.8, kind: 'arm', side: -1 }, { joint: armR, offset: 0, amp: 0.8, kind: 'arm', side: 1 },
    ],
  };
}

/** Faceted glowing octahedron in the item's color (materials.pickup decides shading). */
export function pickup(item, { color, size }, engine) {
  return new THREE.Mesh(new THREE.OctahedronGeometry(size, 0),
    engine.makeMaterial('pickup', { color, emissive: color, emissiveIntensity: 0.35, flatShading: true }));
}

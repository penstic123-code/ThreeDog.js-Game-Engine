// @ts-check
// A neutral four-legged test body made of boxes: a torso, a head with two ears, a two-segment tail and four legs. It exists only so the animation
// in proceduralAnim.js has something to move; replace it with your own model (any shape, any style). What the animator needs is the pivots,
// listed in `parts`: each moving part hangs from a Group placed at its joint, so a rotation turns it about the joint, not about its middle.
import * as THREE from 'three';

/**
 * @param {{ material?: THREE.Material, legLength?: number, bodyLength?: number }} [o]
 * @returns {{ root: THREE.Group, parts: CreatureParts }}
 */
export function buildCreature({ material = new THREE.MeshStandardMaterial({ color: 0x9a9a9a }), legLength = 0.45, bodyLength = 0.9 } = {}) {
  const box = (w, h, d, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(0, y, z); m.castShadow = true;
    return m;
  };
  const pivot = (name, x, y, z, child) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); if (child) g.add(child); return g; };
  const root = new THREE.Group(); root.name = 'creature';
  // body pivot at the hips' height; everything above the legs hangs from it, so bob / squash move the whole upper body together
  const body = pivot('body', 0, legLength, 0);
  const torso = box(0.42, 0.32, bodyLength, 0.12);
  torso.name = 'torso';
  body.add(torso);
  const head = pivot('head', 0, 0.3, bodyLength / 2, box(0.3, 0.28, 0.32, 0, 0.1));
  const ear = (name, x) => pivot(name, x, 0.14, 0.04, box(0.07, 0.16, 0.04, 0.08));   // pivot at the ear's base
  const earL = ear('earL', 0.09), earR = ear('earR', -0.09);
  head.add(earL, earR);
  const tail = pivot('tail', 0, 0.2, -bodyLength / 2, box(0.07, 0.07, 0.25, 0, -0.12));
  const tailTip = pivot('tailTip', 0, 0, -0.25, box(0.06, 0.06, 0.22, 0, -0.11));
  tail.add(tailTip);
  body.add(head, tail);
  // legs hang from hip / shoulder pivots at the top of the leg; +Z is forward (facing 0 in the engine). They hang from the root, not the body,
  // so the body's bob and squash do not push the feet into the ground
  const leg = (name, x, z) => pivot(name, x, legLength, z, box(0.1, legLength, 0.1, -legLength / 2));
  const legs = { FL: leg('legFL', 0.15, bodyLength / 2 - 0.1), FR: leg('legFR', -0.15, bodyLength / 2 - 0.1),
    BL: leg('legBL', 0.15, -bodyLength / 2 + 0.1), BR: leg('legBR', -0.15, -bodyLength / 2 + 0.1) };
  root.add(body, ...Object.values(legs));
  return { root, parts: { body, torso, head, earL, earR, tail, tailTip, legs } };
}

/**
 * @typedef {{ body: THREE.Object3D, torso: THREE.Object3D, head: THREE.Object3D, earL: THREE.Object3D, earR: THREE.Object3D,
 *   tail: THREE.Object3D, tailTip: THREE.Object3D, legs: { FL: THREE.Object3D, FR: THREE.Object3D, BL: THREE.Object3D, BR: THREE.Object3D } }} CreatureParts
 */

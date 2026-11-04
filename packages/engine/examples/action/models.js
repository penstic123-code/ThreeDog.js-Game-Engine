// Models this example builds in code (floor, wall, pillar, enemy), registered by name through assets.js and placed by content/templates.js + props.js.
// Shapes only: every material comes by name from picture/materials.js.
import { THREE } from '../../index.js';
import { mat } from './picture/materials.js';

const mesh = (geo, material) => {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = m.receiveShadow = true;
  return m;
};

/** Model generators */
export const models = {
  floor() { return mesh(new THREE.BoxGeometry(16, 0.2, 16).translate(0, -0.1, 0), mat.floor); },
  wall() { return mesh(new THREE.BoxGeometry(16, 2.4, 0.5).translate(0, 1.2, 0), mat.wall); },
  pillar() { return mesh(new THREE.CylinderGeometry(0.5, 0.6, 2.8, 8).translate(0, 1.4, 0), mat.pillar); },
  // A squat body with two eyes: the eyes face +Z, the facing every character uses (CONVENTIONS: characters face +Z)
  enemy() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.SphereGeometry(0.55, 10, 8).scale(1, 0.75, 1).translate(0, 0.42, 0), mat.enemy));
    for (const x of [-0.2, 0.2]) g.add(mesh(new THREE.SphereGeometry(0.09, 6, 4).translate(x, 0.6, 0.48), mat.eye));
    return g;
  },
};

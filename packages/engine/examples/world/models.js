// Models this game builds in code: the cabin (registered by name in main.js, placed by content/props.js) and the physics prop meshes (content/bodies.js).
import { THREE, mergeColored } from '../../index.js';
import { mat, pickupMaterial } from './picture/materials.js';
import items from './content/items.js';
import { pickup } from './art/shapes.js';

/** Low-poly cabin: one merged mesh, plus a 'lamp' mesh (picture.doorLamp lights it) and a 'chimney' point that main.js animates by name */
export function cabin() {
  const g = mergeColored([
    [new THREE.BoxGeometry(6, 3, 5).translate(0, 1.5, 0), 0xe8dcc4],
    [new THREE.ConeGeometry(4.8, 2.6, 4).rotateY(Math.PI / 4).scale(1.05, 1, 0.9).translate(0, 4.3, 0), 0xa4553c],
    [new THREE.BoxGeometry(1.1, 2, 0.12).translate(0, 1, 2.52), 0x6b4a32],
    [new THREE.BoxGeometry(1, 0.9, 0.1).translate(-1.8, 1.7, 2.52), 0x9cc6d6],
    [new THREE.BoxGeometry(0.6, 1.6, 0.6).translate(1.8, 5, -0.8), 0x7d736a],
  ]);
  const house = new THREE.Mesh(g, mat.building);
  house.castShadow = true; house.receiveShadow = true;
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.3), mat.doorLamp);
  lamp.name = 'lamp'; lamp.position.set(0.9, 2.3, 2.7);
  const chimney = new THREE.Object3D(); chimney.name = 'chimney'; chimney.position.set(1.8, 6, -0.8);
  const root = new THREE.Group(); root.add(house, lamp, chimney);
  return root;
}

const crateGeo = mergeColored([[new THREE.BoxGeometry(0.8, 0.8, 0.8), 0xb08850]]);
/** Mesh and rigid-body options of a physics prop shape (crate, ball, barrel) */
export const BODIES = {
  crate: () => [new THREE.Mesh(crateGeo, mat.crate), 'addBox', { mass: 4 }],
  ball: () => [new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), mat.ball), 'addBall', { radius: 0.35, mass: 1, restitution: 0.55, angularDamping: 0.3 }],
  barrel: () => [new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 8), mat.barrel), 'addHull', { mass: 3 }],
};

/** One ground shape per item, models 'pickup:<item>' (pickups picture for that name first): the shape of art/shapes.js in the item's color */
export const pickups = Object.fromEntries(Object.entries(items).map(([id, item]) => [`pickup:${id}`, () => {
  const m = new THREE.Mesh(pickup(), pickupMaterial(item.color));
  m.castShadow = true;
  return m;
}]));

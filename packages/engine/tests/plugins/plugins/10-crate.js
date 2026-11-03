// A plain three.js mesh: plugged into the scene, registered as engine.thing('10-crate').
import * as THREE from 'three';

const crate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x8a6a40 }));
crate.position.set(0, 0.5, 0);
export default crate;

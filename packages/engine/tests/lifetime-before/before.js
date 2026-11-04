// A stand-in third-party library that wraps Object3D.prototype.add / remove BEFORE the engine's files are evaluated (dynamic import below), as a library loaded ahead of the engine would.
import * as THREE from 'three';
const P = THREE.Object3D.prototype, lib = window.thirdParty = { adds: 0, removes: 0, before: { add: P.add, remove: P.remove } };
const add = P.add, remove = P.remove;
P.add = function (...a) { lib.adds++; return add.apply(this, a); };
P.remove = function (...a) { lib.removes++; return remove.apply(this, a); };
lib.wrapper = { add: P.add, remove: P.remove };
await import('../lifetime/main.js');

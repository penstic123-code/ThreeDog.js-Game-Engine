// Lowpoly style pack - procedural models. No art files needed: trees, rocks, grass and flowers built in code.
// To use your own models: engine.assets.manifest({ models: { pine: '/models/pine.glb' } }),
// then geometry: await engine.assets.geometry('pine').
import * as THREE from 'three';
import { mergeColored } from 'threedog';

export const models = {
  pine: () => mergeColored([
    [new THREE.CylinderGeometry(0.22, 0.32, 1.8, 5).translate(0, 0.9, 0), 0x7a5536],
    [new THREE.ConeGeometry(1.55, 2.7, 7).translate(0, 2.95, 0), 0x4c8a3b],
    [new THREE.ConeGeometry(1.1, 2.1, 7).translate(0, 4.2, 0), 0x5e9f46]]),
  pineLow: () => mergeColored([[new THREE.ConeGeometry(1.5, 4.6, 4).translate(0, 2.7, 0), 0x52903f]]),
  roundTree: () => mergeColored([
    [new THREE.CylinderGeometry(0.2, 0.3, 2.2, 5).translate(0, 1.1, 0), 0x84603d],
    [new THREE.IcosahedronGeometry(1.6, 0).translate(0, 3.3, 0), 0x77ad4a]]),
  roundTreeLow: () => mergeColored([[new THREE.OctahedronGeometry(1.7, 0).translate(0, 3.0, 0), 0x77ad4a]]),
  rock: () => mergeColored([[new THREE.IcosahedronGeometry(0.8, 0), 0x958f83]]),
  flower: (hex = 0xf2d16b) => mergeColored([
    [new THREE.CylinderGeometry(0.02, 0.02, 0.5, 3).translate(0, 0.25, 0), 0x5b8a3c],
    [new THREE.OctahedronGeometry(0.11, 0).translate(0, 0.55, 0), hex]]),
  grass: () => {
    const pos = [], col = [], nor = [];
    const base = new THREE.Color(0x4f8236), tip = new THREE.Color(0xb3d572);
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI / 3 + 0.3, dx = Math.cos(a) * 0.11, dz = Math.sin(a) * 0.11, lean = (k - 1) * 0.12;
      const tx = lean * Math.sin(a), ty = 0.85 - k * 0.08, tz = -lean * Math.cos(a);
      // One triangle per side (rather than double-sided rendering), normals all pointing up: both sides stay lit and shading is soft
      pos.push(-dx, 0, -dz, dx, 0, dz, tx, ty, tz, dx, 0, dz, -dx, 0, -dz, tx, ty, tz);
      for (let s = 0; s < 2; s++) col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
      for (let v = 0; v < 6; v++) nor.push(0, 1, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  },
};


// Procedural models of this look: trees, rocks, grass and flowers built in code, no files. Exported as an asset pack (index.js `assets`):
// engine.assets.manifest(assets) registers each name, and content names them like any file model ({ model: 'pine' }, ['flower', 0xff0000]).
// To swap one for a file, register the same name later: engine.assets.manifest({ models: { pine: '/models/pine.glb' } }).
// Colors come from the palette: the engine calls a `function` generator with this.palette = style.palette (a part of the style, so one change
// retints every tree and rock: style: [style, { palette: { leaf: 0xd98a3a } }]); keys left out keep the values below. Called by hand
// (models.pine()) the defaults are used. Existing .glb files are not touched by the palette.
import * as THREE from 'three';
import { mergeColored } from '../../../index.js';

/** Default palette (the current look): style.palette of this pack */
export const PALETTE = {
  bark: 0x7a5536,        // pine trunk
  barkWarm: 0x84603d,    // round tree trunk
  pine: 0x4c8a3b,        // pine lower cone
  pineLight: 0x5e9f46,   // pine upper cone
  pineLow: 0x52903f,     // low-detail pine
  leaf: 0x77ad4a,        // round tree crown (also the low-detail one)
  rock: 0x958f83,
  stem: 0x5b8a3c,        // flower stem
  bloom: 0xf2d16b,       // flower head unless the content gives one
  grassBase: 0x4f8236,   // grass blade root
  grassTip: 0xb3d572,
};
const pal = ctx => ({ ...PALETTE, ...ctx?.palette });

export const models = {
  pine: function () { const c = pal(this); return mergeColored([
    [new THREE.CylinderGeometry(0.22, 0.32, 1.8, 5).translate(0, 0.9, 0), c.bark],
    [new THREE.ConeGeometry(1.55, 2.7, 7).translate(0, 2.95, 0), c.pine],
    [new THREE.ConeGeometry(1.1, 2.1, 7).translate(0, 4.2, 0), c.pineLight]]); },
  pineLow: function () { return mergeColored([[new THREE.ConeGeometry(1.5, 4.6, 4).translate(0, 2.7, 0), pal(this).pineLow]]); },
  roundTree: function () { const c = pal(this); return mergeColored([
    [new THREE.CylinderGeometry(0.2, 0.3, 2.2, 5).translate(0, 1.1, 0), c.barkWarm],
    [new THREE.IcosahedronGeometry(1.6, 0).translate(0, 3.3, 0), c.leaf]]); },
  roundTreeLow: function () { return mergeColored([[new THREE.OctahedronGeometry(1.7, 0).translate(0, 3.0, 0), pal(this).leaf]]); },
  rock: function () { return mergeColored([[new THREE.IcosahedronGeometry(0.8, 0), pal(this).rock]]); },
  flower: function (hex) { const c = pal(this); return mergeColored([
    [new THREE.CylinderGeometry(0.02, 0.02, 0.5, 3).translate(0, 0.25, 0), c.stem],
    [new THREE.OctahedronGeometry(0.11, 0).translate(0, 0.55, 0), hex ?? c.bloom]]); },
  grass: function () {
    const c = pal(this), pos = [], col = [], nor = [];
    const base = new THREE.Color(c.grassBase), tip = new THREE.Color(c.grassTip);
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


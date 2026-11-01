// __NAME__ procedural models: built in code, no files. Published as an asset pack (index.js `assets`): content names them ({ model: 'block' }).
// Colors come from the palette: the engine calls a `function` generator with this.palette = style.palette, so
// style: [__NAME__, { palette: { base: 0xd98a3a } }] retints every model; keys left out keep the values below.
import * as THREE from 'three';
import { mergeColored } from 'threedog';

/** Default palette of this pack: style.palette */
export const PALETTE = {
  base: 0x9a9a9a,    // main body color
  accent: 0xc08a50,  // small detail on top
};
const pal = ctx => ({ ...PALETTE, ...ctx?.palette });

export const models = {
  // A box with a smaller box on top: the smallest example of a palette-colored model. Replace it with the shapes of your look.
  block: function () { const c = pal(this); return mergeColored([
    [new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), c.base],
    [new THREE.BoxGeometry(0.4, 0.4, 0.4).translate(0, 1.2, 0), c.accent]]); },
};

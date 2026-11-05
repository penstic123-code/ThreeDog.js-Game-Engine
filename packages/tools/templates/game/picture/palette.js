// @ts-check
// __NAME__ palette: the picture's colors and key values, one copy for the whole game; lights.js and materials.js read them.
import { THREE } from 'threedog';

export const palette = {
  toneMapping: THREE.AgXToneMapping,   // the one line that picks the curve; THREE.NoToneMapping: colors come out as written
  background: 0x8c8c8c,                // behind everything when nothing is drawn there; a sky() dome draws over it
  sun: { color: 0xffffff, noon: 2, shadowMap: { low: 1024, high: 2048 } },   // shadowMap: size per engine.tier
  ambient: { sky: 0xffffff, ground: 0x555555, noon: 1.2, night: 0.3 },
  material: { color: 0xa0a0a0, roughness: 0.9 },
};

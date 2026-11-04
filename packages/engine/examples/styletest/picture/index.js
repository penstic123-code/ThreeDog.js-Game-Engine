// @ts-check
// The picture this page judges: wiring only. The picture under test is the world example's; this folder adds what the exhibits need.
// To judge your own picture, point the import below, and the ones in palette.js and materials.js, at your game's picture/.
import { createPicture as createPictureUnderTest } from '../../world/picture/index.js';
import { createMaterials } from './materials.js';
import { addLamp } from './lights.js';
import { createEnv } from './env.js';

/** Call after engine.use(...) @param {any} engine @param {{ env: boolean }} opts env: environment lighting from the sky */
export function createPicture(engine, { env }) {
  const picture = createPictureUnderTest(engine);
  createMaterials(engine);
  // registered after the picture under test's onRender, so it reads this frame's sky and scales the ambient that was just written
  if (env) { const part = createEnv(engine, [picture.hemi, picture.fill]); engine.onRender(() => part.update(engine.uniforms)); }
  return { sun: picture.sun, hemi: picture.hemi, addLamp: (/** @type {{ x: number, y: number, z: number }} */ at) => addLamp(engine, picture.doorLamp, at) };
}

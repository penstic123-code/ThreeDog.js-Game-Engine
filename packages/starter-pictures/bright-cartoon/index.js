// @ts-check
// STARTER PICTURE: a clear, bright cartoon look in plain three.js and TSL. It was copied into this game, it is this game's code now, and nothing links
// back. Nothing in it is required, and it is meant to be changed: if the game still looks like this starter when it ships, it has failed.
//
// What each file controls:
//   palette.js    every color and number. Start here.
//   paint.js      the one texture language: flat colors with a clean edge. Also the lit material all surfaces share.
//   lights.js     sun and fill.          sky.js    gradient, cut-out clouds, fog.
//   materials.js  named surfaces.        ground.js / water.js    a ground from your height function, water with depth bands.
//   props.js      tree, bush, rock, fence, hut, lamp, grass tufts. Replace these with your game's own shapes.
//   sampler.js    a test yard to look at the picture. Delete it when your game has a scene.
//
// Make it yours, in this order, and look at a shot after each step:
//   1. Pick the game's mood in one sentence, then rewrite palette.js for it: sky, ground, and the ramp's dark entry (the color of every shadow).
//   2. Change the mark in paint.js: blobs could be stripes, dots, or brush strokes. This is what stops two games looking alike.
//   3. Replace the shapes in props.js with silhouettes that belong to this game.
//   4. Move the sun low, or change the time of day: long shadows or a dusk sky change more than any single color.
// Not this look at all (dark, realistic, ink, pixel)? Delete the folder and write your own; the engine does not need any of it.
import { palette } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';
import { createSky } from './sky.js';
import { createGround } from './ground.js';
import { createWater } from './water.js';
import * as props from './props.js';

/** @param {any} engine */
export function createPicture(engine) {
  engine.renderer.toneMapping = palette.toneMapping;
  const lights = createLights(engine), sky = createSky(engine), { materials, glow } = createMaterials();
  // onRender, not onFrame: it runs after every module updated, so the signals are this frame's
  engine.onRender(() => {
    const s = engine.uniforms;
    lights.update(s); sky.update(s);
    glow.value = palette.glow.night + (palette.glow.day - palette.glow.night) * s.uDaylight.value;
  });
  return {
    lights, sky, materials, props,
    /** @param {Parameters<typeof createGround>[0]} [o] */
    ground: o => { const m = createGround(o); engine.scene.add(m); return m; },
    /** @param {Parameters<typeof createWater>[1]} [o] */
    water: o => { const m = createWater(engine, o); engine.scene.add(m); return m; },
  };
}

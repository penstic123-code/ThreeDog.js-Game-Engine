// @ts-check
// __NAME__ picture: wiring only, no values. Each part is one file here and writes plain three.js; numbers and colors live in palette.js.
// The engine hands over signals (engine.uniforms) and writes none of this; recipe 62 lists them and shows how to add sky.js, post.js or shaders/.
// Gray on purpose: a starting point, not a picture. Change anything here, or delete the folder and write your own.
import { THREE } from 'threedog';
import { palette } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';

// A picture module: what it adds goes through ctx, so engine.use(another(), { replaces: 'picture' }) swaps the whole picture and leaves nothing behind (recipe 62).
/** @returns {import('threedog').ModuleDef} */
export function createPicture() {
  return {
    name: 'picture', type: 'picture', provides: ['picture', 'tone', 'sun'],
    /** @param {any} engine @param {any} ctx */
    install(engine, ctx) {
      ctx.borrow(engine.renderer, { toneMapping: palette.toneMapping });
      // Colors the background the engine already holds, so a sky() dome still draws over it. Assigning engine.scene.background = ... takes over from the dome, on purpose
      // (engine.sky.backdrop gives one flat color and keeps the sky signals).
      const { r, g, b } = new THREE.Color(palette.background);
      ctx.borrow(engine.scene.background, { r, g, b });
      const lights = createLights(engine, ctx), materials = createMaterials();
      ctx.track({ remove() { for (const m of Object.values(materials)) m.dispose(); } });
      // onRender, not onFrame: it runs after every module updated, so the signals are this frame's. Without a sky there is no day and night: uDaylight stays 1
      ctx.track(engine.onRender(() => lights.update(engine.uniforms)));
      // One object's state gets a name here, so gameplay never touches a light or a material, e.g. lamp: id => ({ off() { lamps.get(id).intensity = 0; } }),
      // and combat code calls picture.lamp(id).off(). The names are this game's own.
      return { lights, materials };
    },
  };
}

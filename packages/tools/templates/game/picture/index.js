// @ts-check
// __NAME__ picture: wiring only, no values. Each part is one file here and writes plain three.js; numbers and colors live in palette.js.
// The engine hands over signals (engine.uniforms) and writes none of this; recipe 62 lists them and shows how to add sky.js, post.js or shaders/.
// Gray on purpose: a starting point, not a picture. Change anything here, or delete the folder and write your own.
import { THREE } from 'threedog';
import { palette } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';

/** @param {any} engine */
export function createPicture(engine) {
  engine.renderer.toneMapping = palette.toneMapping;
  engine.scene.background = new THREE.Color(palette.background);
  const lights = createLights(engine), materials = createMaterials();
  // onRender, not onFrame: it runs after every module updated, so the signals are this frame's. Without a sky there is no day and night: uDaylight stays 1
  engine.onRender(() => lights.update(engine.uniforms));
  // One object's state gets a name here, so gameplay never touches a light or a material, e.g. lamp: id => ({ off() { lamps.get(id).intensity = 0; } }),
  // and combat code calls picture.lamp(id).off(). The names are this game's own.
  return { lights, materials };
}

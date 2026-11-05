// The asset packs this game registers (main.js: engine.assets.manifest(packs)): names -> files or generators; content and code use the names only.
// Kept in their own file so `npm run check` imports the same objects and checks the model / sound names content uses against them.
// A model made in code is a generator: it returns a geometry (drawn gray) or an Object3D, and runs once per name; content/props.js places it by name.
// Shape in code, placement in content: marker below is the example, placed in content/props.js. Delete both when the game has its own. Recipe 05.
// Files and sounds: [{ name, models: { crate: '/models/crate.glb' }, sounds: { door: '/sfx/door.ogg' } }]; a texture made in code goes in textures: { name: () => texture }; a material in picture/materials.js
import { THREE } from 'threedog';

/** A small post, base on y = 0: one plain geometry, no look (it is drawn with the neutral gray material) */
const marker = () => new THREE.CylinderGeometry(0.2, 0.25, 1.2, 12).translate(0, 0.6, 0);

export default [{ name: 'starter', models: { marker } }];

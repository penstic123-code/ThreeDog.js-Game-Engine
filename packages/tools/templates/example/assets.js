// The asset packs this game registers (main.js: engine.assets.manifest(packs)): names -> files or generators. Content and code use the names only.
// Kept in their own file so `npm run check` imports the same objects and checks the model / sound names content uses against them.
// A file:        models: { crate: '/models/crate.glb' }          A model made in code: models: { crate: () => geometry | Object3D }
// A sound file:  sounds: { door: '/sfx/door.ogg' }             A sound made in code: sounds: { ding: (audio, p, out) => seconds }
// A texture made in code: textures: { brick: () => new THREE.CanvasTexture(canvas) }.  A material made in code goes in picture/materials.js instead.
import { THREE } from 'threedog';

export default [{
  name: '__NAME__',
  models: { crate: () => new THREE.BoxGeometry(1, 0.8, 0.8).translate(0, 0.4, 0) },   // a gray box (a generator returning geometry)
}];

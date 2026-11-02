// The asset packs this game registers (main.js: engine.assets.manifest(packs)): names -> files or generators; content and code use the names only.
// Kept in their own file so `npm run check` imports the same objects and checks the model / sound names content uses against them.
// Example: [{ name: '__NAME__', models: { crate: '/models/crate.glb', rock: () => geometry }, sounds: { door: '/sfx/door.ogg' } }]
// (a texture made in code goes in textures: { name: () => texture }; a material made in code is a style.materials role)
export default [];

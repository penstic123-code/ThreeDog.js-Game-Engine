// @ts-check
// __NAME__: blank minimal start — a flat piece of ground + a player + a follow camera, so it opens and you can walk. Write gameplay ideas in DESIGN.md.
import { createEngine, world, sky, collision, followCamera, characters, THREE, makeMaterial } from 'threedog';
import lowpoly from 'threedog/styles/lowpoly';   // style pack: all the art lives here

const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), style: lowpoly, ui: { loading: { title: '__NAME__' } }, saveKey: '__NAME__' });
// For a first-person / strategy camera, replace followCamera() with firstPersonCamera() / rtsCamera(). For the full open-world terrain, use openWorld instead (see recipes/01).
engine.use(world(), sky({ time: 0.4 }), collision(), followCamera(), characters({ npcs: false }));   // the player is a record in world: creating a player needs world

// Temporary ground (a 200 x 200 slab): replace it with terrain or a level later
const ground = new THREE.Mesh(new THREE.BoxGeometry(200, 1, 200), makeMaterial('ground', { color: 0x9a9a96 }));
ground.position.y = -0.5; ground.receiveShadow = true;
engine.add(ground);

engine.characters.createPlayer({ spawn: { x: 0, z: 0 } });

window.engine = engine;   // tests, screenshots and the console all rely on it (before start, so the dev bridge can wait for it)
await engine.start();      // when start returns the modules are ready; anything that needs the terrain / physics generated (finding a shore, reading ground height) goes after this line

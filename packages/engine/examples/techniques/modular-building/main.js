// @ts-check
// Modular building demo (page /modular-building.html): one seeded street from kit.js, drawn with one of three material sets.
// URL: ?set=gray|warm|cool (gray = the block-out, the default) &seed=1 &count=10 &view=street|close &batch=0 (draw every piece on its own) | merge (kit.merge: one mesh per material).
// The two coloured sets exist to show the kit is style-free: same seed, same shapes, other slots and trim profiles. They are demo values,
// not a recommended picture. Test page for tests/specs/modular-building.mjs: window.mbTest = { kit, street, createModularKit, bakeVertexAO, THREE }.
// Shapes only here; the whole picture is picture/.
import { createEngine, fixedCamera, bakeVertexAO, THREE } from 'threedog';
import { createModularKit, PROFILES } from './kit.js';
import { createPicture } from './picture/index.js';

const url = new URLSearchParams(location.search);
const set = url.get('set') ?? 'gray', seed = Number(url.get('seed') ?? 1), count = Number(url.get('count') ?? 10);
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: false }, saveKey: 'threedog-modular-building',
  batching: url.get('batch') === '0' || url.get('batch') === 'merge' ? false : undefined });
const { mat: { ground: groundMat, ...slots } } = createPicture(engine, { set });

// a style swaps trim profiles too: same names (so a seed picks the same trim slot), other cross-sections. Hard-edged for the cool set
const cutProfiles = { flat: PROFILES.flat, step: [[0, 0], [1, 0], [1, 0.35], [0.4, 0.35], [0.4, 1], [0, 1]], cove: [[0, 0], [0.6, 0], [1, 0.4], [1, 1], [0, 1]] };
const kit = createModularKit({ slots, profiles: set === 'cool' ? cutProfiles : PROFILES });
engine.assets.manifest(kit.pack);   // every module, a building and the street, by name: threedog gallery, hot swap, ?panel=1 tuning

const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
engine.scene.add(ground);

const shots = /** @type {any} */ ({
  street: { position: [-9, 10, 22], lookAt: [22, 3, -4], fov: 50 },
  close: { position: [3, 4.5, 11], lookAt: [6, 3.2, -2], fov: 45 },
});
engine.use(fixedCamera({ shots, start: url.get('view') ?? 'street' }));

// built directly here so the URL can pick the seed; a game names it in content instead: { model: ['mb-street', { seed: 7 }], x: 0, z: 0 }
const built = kit.street({ seed, count });
built.userData.batch = true;   // opt in to engine.batching before adding: identical module meshes become one InstancedMesh per cell
const street = url.get('batch') === 'merge' ? kit.merge(built) : built;
engine.scene.add(street);

Object.assign(window, { engine, mbTest: { kit, street, createModularKit, bakeVertexAO, THREE } });
engine.start();

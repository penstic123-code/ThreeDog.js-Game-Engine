// @ts-check
// Modular building demo (page /modular-building.html): one seeded street from kit.js, drawn with one of three material sets.
// URL: ?set=gray|warm|cool (gray = the block-out, the default) &seed=1 &count=10 &view=street|close &batch=0 (draw every piece on its own) | merge (kit.merge: one mesh per material).
// The two coloured sets exist to show the kit is style-free: same seed, same shapes, other slots and trim profiles. They are demo values,
// not a recommended look. Test page for tests/specs/modular-building.mjs: window.mbTest = { kit, street, createModularKit, makeSlots, bakeVertexAO, THREE }.
import { createEngine, fixedCamera, makeMaterial, bakeVertexAO, THREE } from '../../../index.js';
import { createModularKit, PROFILES } from './kit.js';

const url = new URLSearchParams(location.search);
const set = url.get('set') ?? 'gray', seed = Number(url.get('seed') ?? 1), count = Number(url.get('count') ?? 10);
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), ui: { loading: false }, saveKey: 'threedog-modular-building',
  batching: url.get('batch') === '0' || url.get('batch') === 'merge' ? false : undefined });

/** Slot materials for one set. A game makes these from its own style (makeMaterial roles, or plain three.js materials) */
function makeSlots(name = 'gray') {
  const m = (/** @type {number} */ color, extra = {}) => makeMaterial('prop', { color, ...extra });
  if (name === 'gray') return { wall: m(0x9c9c9c), trim: m(0xbdbdbd), roof: m(0x6c6c6c), frame: m(0x5c5c5c), glass: m(0x3c4046, { roughness: 0.3 }),
    accent: m(0x7c7c7c), awning: m(0xc4c4c4), sign: m(0xd2d2d2) };
  if (name === 'warm') return { wall: m(0xd9c7a3), trim: m(0xf0e9da), roof: m(0xa4553a), frame: m(0x3f5b45), glass: m(0x2e3d4f, { roughness: 0.2 }),
    accent: m(0x7a4e33), awning: m(0xb8433a), sign: m(0xe0b54a) };
  if (name === 'cool') return { wall: m(0x4a5260), trim: m(0x9aa3ad), roof: m(0x2c3038), frame: m(0x30c0d0, { emissive: 0x1a6a74, emissiveIntensity: 0.6 }),
    glass: m(0x1b2a33, { roughness: 0.15, emissive: 0x0e2a33, emissiveIntensity: 0.5 }), accent: m(0xd07a30), awning: m(0x2f8f9a), sign: m(0xe6edf2) };
  throw new Error(`modular-building: unknown set "${name}" (gray, warm, cool)`);
}
// a style swaps trim profiles too: same names (so a seed picks the same trim slot), other cross-sections. Hard-edged for the cool set
const cutProfiles = { flat: PROFILES.flat, step: [[0, 0], [1, 0], [1, 0.35], [0.4, 0.35], [0.4, 1], [0, 1]], cove: [[0, 0], [0.6, 0], [1, 0.4], [1, 1], [0, 1]] };
const kit = createModularKit({ slots: makeSlots(set), profiles: set === 'cool' ? cutProfiles : PROFILES });
engine.assets.manifest(kit.pack);   // every module, a building and the street, by name: threedog gallery, hot swap, ?panel=1 tuning

const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), makeMaterial('terrain', { color: 0x8c8c86 }));
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

Object.assign(window, { engine, mbTest: { kit, street, createModularKit, makeSlots, bakeVertexAO, THREE } });
engine.start();

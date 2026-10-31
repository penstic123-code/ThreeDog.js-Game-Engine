// Test page: the engine with no style pack, no model and no terrain generator. Everything should be the neutral placeholder look
// (gray capsules, gray boxes, flat gray ground at y = 0, plain lights) and each missing piece warned once with its fix.
import { createEngine, presets, world, terrain, collision, followCamera, characters, interactions, inventory } from '../../index.js';

const warns = window.placeholderWarns = [];
const warn = console.warn;
console.warn = (...a) => { warns.push(String(a[0])); warn(...a); };
const engine = window.engine = createEngine({ canvas: document.getElementById('view'), ui: { loading: false }, saveKey: 'test-placeholders', adaptiveResolution: false });
engine.use(world(), terrain({ viewChunks: 2 }), collision(), followCamera(), characters(), interactions({ ...presets.interactions.nearest }), inventory());
engine.characters.createPlayer({ ...presets.player.thirdPerson, spawn: { x: 0, z: 0 } });
engine.npcs.add({ id: 'walker', name: 'walker', position: [3, 0, -2] });
engine.inventory.define('gem', { name: 'gem' });
window.gemPickup = engine.inventory.spawnPickup('gem', { x: -2, z: 2 });
engine.inventory.spawnPickup('gem', { x: 1.5, z: 3 });
await engine.start();

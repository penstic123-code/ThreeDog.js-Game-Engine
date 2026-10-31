// Terrain edit test page: modules for specs/terrain-edit.mjs, which builds its own headless engines (threads on vs off, terrain vs level only).
import { createEngine, terrain, vegetation, collision, characters, level, THREE } from '../../index.js';

window.threedogTerrain = { createEngine, terrain, vegetation, collision, characters, level, THREE };
window.engine = createEngine({ canvas: document.getElementById('view'), headless: true, loading: false, urlState: false, saveKey: 'terrain-edit-test' });
window.engine.start();

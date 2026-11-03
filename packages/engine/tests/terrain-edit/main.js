// Terrain edit test page: modules for specs/terrain-edit.mjs, which builds its own headless engines (threads on vs off, terrain vs level only).
import { createEngine, terrain, vegetation, collision, characters, level, rigid, settings, createTerrain, world, grids, hlod, THREE } from '../../index.js';

// loadTsl: specs/terrain-split.mjs also runs on renderer: 'webgpu', which needs threedog/tsl (loaded only there, the other specs stay WebGL)
window.threedogTerrain = { createEngine, terrain, vegetation, collision, characters, level, rigid, settings, createTerrain, world, grids, hlod, THREE, loadTsl: () => import('../../render/fx/index.js') };
window.engine = createEngine({ canvas: document.getElementById('view'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'terrain-edit-test' });
window.engine.start();

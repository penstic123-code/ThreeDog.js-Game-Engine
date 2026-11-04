// Page for the picture parts guard (packages/tools/tests/picture-parts.mjs). ?case=together: three parts in three styles, one game. ?case=plain: engine sky() plus a part
// holding fog, for the built-in module's slot. Every collision is installed by the guard from window.clash once the page runs, so its console sees them.
import * as THREE from 'three';
import { createEngine, calendar, weather, sky, PICTURE_SLOTS } from 'threedog';
import { GradientSky } from './parts/sky.js';
import { rain } from './parts/rain.js';
import { sea } from './parts/sea.js';
import * as clash from './parts/clash.js';

const params = new URLSearchParams(location.search), which = params.get('case') ?? 'together';
// ?renderer=webgpu: the guard's WebGPU pass, and the check that real-webgpu.mjs runs on a real device
const gpu = params.get('renderer') === 'webgpu';
if (gpu) await import('threedog/tsl');
const engine = createEngine({ canvas: document.getElementById('c'), lights: false, ...(gpu && { renderer: 'webgpu' }) });
window.engine = engine;
window.clash = clash;
window.parts = { GradientSky, rain, sea, sky };
window.PICTURE_SLOTS = PICTURE_SLOTS;
window.THREE = THREE;
// the state half of weather only: the signals, not the engine's drops. This game's rain draws itself
engine.use(calendar({ time: '12:00' }), weather({ types: { clear: {}, rain: { rain: 1, cloud: 0.8 } } })[0]);
if (which === 'together') engine.use(new GradientSky(), rain(), sea());
if (which === 'plain') engine.use(sky(), clash.haze());
// a plain line of the game, outside any part
window.strayWrite = () => { engine.scene.fog.near = 3; };
await engine.start();

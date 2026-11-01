// @ts-check
// __NAME__: clean start — a player on generated ground with a follow camera and a sky. No gameplay yet: build what DESIGN.md describes.
// main.js holds rules only (modules, ops, state, presentation). Everything placed in the level is content: content/templates.js + content/props.js (rule R33).
import { createEngine, presets, openWorld, followCamera, content } from 'threedog';
__STYLE_IMPORT__
import { terrainPreset } from '@threedog/terrain-noise';   // optional: a terrain generator (the engine ships none)
import data from './content/index.js';

const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), __STYLE_OPT__ui: { loading: { title: '__NAME__' } }, saveKey: '__NAME__' });   // sounds are content: content/audio.js
// openWorld installs the world and environment (terrain, vegetation, sky, weather, water, collision, camera, characters, settings, debug); add gameplay modules yourself.
// More you can add: interactions() inventory() hud() dialogue() quests() entities() triggers() timeline() particles() music() photo() grids(), usage in node_modules/threedog/docs/api/<module>.md
engine.use(openWorld({ camera: followCamera({ pointerLock: true }), seed: 42, terrain: terrainPreset(), time: 0.3, sky: presets.calendar.cycle }), content());
// Camera: click the view once to capture the mouse, then the mouse turns the view (Esc releases it). For drag-to-turn instead: followCamera({ pointerLock: false }).

const home = engine.characters.findSpawn([0, 0, 0], { minH: 3, maxH: 14 });   // the terrain is generated: find a flat spot as "home". home is a Vector3, use home.x / home.z, not home[0]
engine.characters.createPlayer({ ...presets.player.thirdPerson, spawn: home });
engine.content.load(data, { places: { home } });   // content/ is empty for now; place things relative to home with { place: 'home', x, z }

window.engine = engine;   // tests, screenshots and the console all rely on it (before start, so the dev bridge can wait for it)
await engine.start();      // when start returns the modules are ready; anything that needs the terrain generated (finding a shore, reading ground height) goes after this line

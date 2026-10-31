// @ts-check
// __NAME__: open-world starter template — a player on generated terrain, with a few apples to pick up. Write gameplay ideas in DESIGN.md.
import { createEngine, openWorld, interactions, inventory, content } from 'threedog';
import lowpoly from 'threedog/styles/lowpoly';   // style pack: all the art lives here
import data from './content/index.js';

const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), style: lowpoly, ui: { loading: { title: '__NAME__' } }, saveKey: '__NAME__' });
// openWorld installs only the world and environment (terrain, vegetation, sky, weather, water, collision, camera, characters, settings, debug); add gameplay modules yourself.
// More you can add: dialogue() quests() entities() triggers() timeline() particles() music() hud() photo(), usage in node_modules/threedog/docs/api/<module>.md
engine.use(openWorld({ seed: 42, time: 0.3 }), interactions(), inventory(), content());

const home = engine.characters.findSpawn([0, 0, 0], { minH: 3, maxH: 14 });   // the terrain is generated: find a flat spot as "home". home is a Vector3, use home.x / home.z, not home[0]
engine.characters.createPlayer({ spawn: home });
engine.content.load(data, { places: { home } });   // in content/, place things relative to home with { place: 'home', x, z }

window.engine = engine;   // tests, screenshots and the console all rely on it (before start, so the dev bridge can wait for it)
await engine.start();      // when start returns the modules are ready; anything that needs the terrain generated (finding a shore, reading ground height) goes after this line

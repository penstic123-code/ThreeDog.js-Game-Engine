// @ts-check
// __NAME__: open-world start (--open-world) — a player on generated ground with a follow camera and a day/night sky. No gameplay yet: build what DESIGN.md describes.
// main.js holds rules by default (modules, ops, state, presentation), and things placed in the level default to content (content/templates.js + content/props.js),
// because saves and GAMEMAP read it. Plain three.js objects work just as well. The one fact to keep: what a save stores whole must not be made again at startup (rule R33).
// Wired already, because nearly every game needs them and they cost one line each: start screen (ui.title: Continue / Start), autosave, Esc = pause + settings menu,
// third-person walking and camera. Don't want one? Delete or swap its line. Rewriting one by hand is the slow way; CLAUDE.md "Already here" lists the rest.
__TSL_IMPORT__
import { createEngine, presets, openWorld, followCamera, content } from 'threedog';
import { createPicture } from './picture/index.js';   // the game's own picture in plain three.js: gray for now; make it yours, recipe 62
import { terrainPreset } from '@threedog/terrain-noise';   // optional: a terrain generator (the engine ships none)
import data from './content/index.js';
import packs from './assets.js';

const engine = createEngine({ __RENDERER__bindings: { ...presets.bindings.walk, ...presets.bindings.interact, ...presets.bindings.debug }, canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: { title: '__NAME__' }, title: { title: '__NAME__' } }, saveKey: '__NAME__' });   // sounds are content: content/audio.js
// openWorld installs the world and environment (terrain, vegetation, sky, weather, water, collision, camera, characters, settings, debug); add gameplay modules yourself.
// More you can add: interactions() inventory() pickups() (items lying on the ground) hud() dialogue() quests() triggers() timeline() particles() music() photo() grids(), usage in node_modules/threedog/docs/api/<module>.md
engine.use(openWorld({ camera: followCamera({ pointerLock: true }), seed: 42, terrain: terrainPreset(), time: 0.3, weather: presets.weather.temperate, calendar: presets.calendar.cycle,
  settings: { freezeWorld: true } }), content());   // the sky gives the signals and draws its dome; lights and fog are picture/'s; settings: Esc pauses and opens the menu
engine.saves.autosave(0.5);   // minutes of play; Continue on the start screen loads it. The game's own state joins with engine.saves.register('game', { version: 1, save, load }), recipe 20
engine.use(createPicture());   // a picture module; to switch looks: engine.use(another(), { replaces: 'picture' })
const { picture } = engine;   // picture.materials: the game's materials by name
engine.assets.manifest(packs);   // assets.js: the models / sounds / textures content names (the marker example for now)
// Camera: click the view once to capture the mouse, then the mouse turns the view (Esc releases it). For drag-to-turn instead: followCamera({ pointerLock: false }).

const home = engine.characters.findSpawn([0, 0, 0], { minH: 3, maxH: 14 });   // the terrain is generated: find a flat spot as "home". home is a Vector3, use home.x / home.z, not home[0]
engine.characters.createPlayer({ ...presets.player.thirdPerson, spawn: home });
engine.content.load(data, { places: { home } });   // content/ is empty for now; place things relative to home with { place: 'home', x, z }

Object.assign(window, { engine, picture });   // tests, screenshots and the console all rely on it (before start, so the dev bridge can wait for it)
await engine.start();      // when start returns the modules are ready; anything that needs the terrain generated (finding a shore, reading ground height) goes after this line

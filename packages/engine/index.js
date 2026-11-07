// Engine entry.
//
// Core (always present): rendering, main loop, events, input, assets, audio, saves, UI base, loading screen, ground API
// Modules (opt-in): installed with engine.use(...), like the list below
//
//   import { createEngine, terrain, vegetation, sky, weather, water, collision, rigid,
//            followCamera, characters, interactions, dialogue, inventory, quests, photo, ambience, debug } from 'threedog';
//   import { terrainPreset } from '@threedog/terrain-noise';   // optional: the engine ships no terrain generator either
//
//   const engine = createEngine({ canvas });   // lights, fog and materials are plain three.js the game writes (its picture/ folder); the engine gives signals
//   engine.use(terrain({ seed: 7, ...terrainPreset() }), vegetation(), sky(), weather(), water(), collision(), followCamera(), characters());
//   engine.start();
//
// Or install the usual open-world set at once with a preset: engine.use(openWorld({ seed: 7, camera: 'follow', terrain: terrainPreset() }))
import * as THREE from 'three';
import { Engine } from './core/engine/Engine.js';
import { CAP_CONTRACTS } from './core/engine/moduleSlots.js';
import { terrain } from './modules/terrain/index.js';
import { vegetation } from './modules/vegetation/index.js';
import { sky } from './modules/sky/skyModule.js';
import { calendar } from './modules/calendar/index.js';
import { weather } from './modules/weather/Weather.js';
import { water } from './modules/water/Water.js';
import { collision } from './modules/collision/Collision.js';
import { rigid } from './modules/rigid/RigidBodies.js';
import { followCamera } from './modules/camera/FollowCamera.js';
import { characters } from './modules/characters/index.js';
import { interactions } from './modules/gameplay/Interactions.js';
import { dialogue } from './modules/gameplay/Dialogue.js';
import { inventory } from './modules/gameplay/Inventory.js';
import { pickups } from './modules/gameplay/pickups.js';
import { quests } from './modules/gameplay/Quests.js';
import { photo } from './modules/photo/Photo.js';
import { ambience } from './modules/ambience/Ambience.js';
import { debug } from './modules/debug/DebugPanel.js';
import { level } from './modules/level/index.js';
import { triggers } from './modules/triggers/index.js';
import { particles } from './modules/particles/Particles.js';
import { swarm } from './modules/swarm/Swarm.js';
import { settings } from './modules/settings/index.js';
import { music } from './modules/music/index.js';
import { firstPersonCamera, fixedCamera, rtsCamera } from './modules/camera/index.js';
import { timeline } from './modules/timeline/Timeline.js';
import { nav } from './modules/nav/index.js';
import { hlod } from './modules/hlod/index.js';
import { lightPool } from './modules/lights/index.js';
import { content } from './modules/content/index.js';
import { flow } from './modules/flow/index.js';
import { hud } from './modules/hud/index.js';
import { world } from './modules/world/index.js';
import { grids } from './modules/grid/index.js';
import calendarContract from './modules/calendar/contract.js';
import cameraContract from './modules/camera/contract.js';
import charactersContract from './modules/characters/contract.js';
import collisionContract from './modules/collision/contract.js';
import flowContract from './modules/flow/contract.js';
import dialogueContract from './modules/gameplay/dialogue.contract.js';
import interactionsContract from './modules/gameplay/interactions.contract.js';
import inventoryContract from './modules/gameplay/inventory.contract.js';
import questsContract from './modules/gameplay/quests.contract.js';
import levelContract from './modules/level/contract.js';
import navContract from './modules/nav/contract.js';
import particlesContract from './modules/particles/contract.js';
import collider3dContract from './modules/rigid/collider3d.contract.js';
import { checkOptions, DEV, fmt } from './core/base/validate.js';
import { readParams, keysSchema } from './core/base/params.js';
import { codedError } from './core/base/errorHints.js';

// The contract of each capability, so a provider is checked where it binds even when the engine's own module of that name was never installed. Here and not in core: core imports
// no module. Plain data, a few KB; a build cannot drop it behind DEV (only the literal import.meta.env test folds). tools/tests/contracts.mjs fails on a contract left out.
for (const c of [calendarContract, cameraContract, charactersContract, collisionContract, flowContract, dialogueContract, interactionsContract, inventoryContract, questsContract,
  levelContract, navContract, particlesContract, collider3dContract]) CAP_CONTRACTS.set(c.name, c);

// Engine and Animator are exported for types and instanceof; make them with createEngine / engine.assets.animate (AI.md entry-point table)
export { THREE, Engine };
export { Animator } from './core/assets/Animator.js';
export { terrain, vegetation, calendar, sky, weather, water, collision, rigid, followCamera, characters, interactions, dialogue, inventory, pickups, quests, photo, ambience, debug,
  level, triggers, particles, swarm, settings, music, firstPersonCamera, fixedCamera, rtsCamera, timeline, nav, hlod, lightPool, content, flow, hud, world, grids };
export { net, fakeNetwork, webSocket } from './modules/net/index.js';
export { screenToGround } from './core/scene/screenToGround.js';
export { ease } from './core/base/easing.js';
export { sampleGrid } from './core/scene/grid.js';   // a grid of numbers (height, moisture, density, walkable) as a function (x, z) -> value; assets.gridFromImage reads one from an image. 'threedog/grid' is the same file without three.js (workers, tests)
export { checkOptions };   // only for extensible data (game-defined fields); an options bag goes through readParams
export { contentParts } from './modules/content/parts.js';   // one content kind split over files: content/props/*.js joined in file-name order (recipes/30)
export { threePatches } from './core/scene/threePatches.js';   // the engine's page-wide changes to three.js classes: list(), off(id) (THREE.md "Global changes")
export { readParams } from './core/base/params.js';   // params schema for game-made modules (recipes/14): validated, defaults filled, shown by engine.catalog()
export { compositeGround } from './core/scene/compositeGround.js';   // several ground providers (terrain({ part: true }), level({ part: true })) answering by region; holds the 'ground' slot
export { createTerrain } from './modules/terrain/index.js';
export { Character, NPC } from './modules/characters/index.js';
export { presets } from './presets.js';   // opt-in gameplay presets (weather tables, calendars, player feel, camera): never applied by the engine itself
export { terrainMaterial, mergeColored, applyEffects } from './render/materials.js';
export { rampTexture } from './render/lighting.js';   // a toon material's gradientMap from grays or colors (recipes/09)
export { bakeVertexAO } from './render/modeling.js';   // procedural-modeling gaps three.js lacks (THREE.md lists what three already has)
export { materialPatches } from './render/patches.js';
export { toast, makeWindow, worldToScreen, fadeScreen, uiFocus, toggleOnKey } from './ui/UI.js';
export { parseClock, formatClock, inRange } from './core/time/dayTime.js';
export { pickTarget, switchTarget } from './core/scene/targeting.js';
export { PICTURE_SLOTS } from './core/scene/pictureSlots.js';

/** Create an engine (core only). For the options see core/engine/Engine.js */
export function createEngine(opts) { return new Engine(opts); }

const CAMERAS = { follow: followCamera, firstPerson: firstPersonCamera, rts: rtsCamera, fixed: fixedCamera };
const OPEN_WORLD_PARTS = { world, terrain, vegetation, calendar, sky, weather, water, collision, rigid, characters, ambience, settings, debug };
const OPEN_WORLD_SHORT = ['seed', 'viewChunks', 'density', 'flatten', 'time', 'dayLength', 'autoWeather', 'camera'];
const OW_ERR = { camera: 'openWorld(): camera has no kind \'{k}\'; available: {list}, or pass a camera module (e.g. rtsCamera({ height: 60 })) or false',
  noCamera: "openWorld(): no camera given; pick one: openWorld({ camera: 'follow' }) (or 'firstPerson' / 'rts' / 'fixed', a camera module such as followCamera(presets.camera.overShoulder), or false for none)",
  part: 'openWorld(): {k} must be false (leave it out), true or an options object, e.g. openWorld({ {k}: false }); got {got}',
  noOpts: 'openWorld(): {k} takes no options, only true / false; got {got}. {hint}' };
// vegetation takes options only on its own chunks: on terrain an options object would be dropped silently, so it throws and points to where the setting lives
const VEGETATION_HINT = 'How much vegetation grows is a terrain setting: openWorld({ density: 1.5 }) or terrain({ density }); the species are game content (content vegetation; a style only paints them). On ground without terrain (a level) it takes its own options: openWorld({ terrain: false, vegetation: { area, density } })';
/**
 * Open-world preset: covers only "world and environment" plus the basics every game needs:
 *   world, terrain, vegetation, calendar, sky, weather, water, collision, rigid, camera, characters, ambience, settings, debug (debug only in dev builds).
 * Gameplay modules (interactions, dialogue, inventory, quests, photo mode, timeline, trigger zones, particles, music, markers...) are not included:
 *   engine.use(openWorld({ seed: 7, camera: 'follow' }), interactions({ ...presets.interactions.nearest }), dialogue(), inventory(), quests());   // keys: createEngine({ bindings: { ...presets.bindings.interact, ...presets.bindings.inventory } })
 * Every part takes false (leave it out) or an object (that module's own options), so the preset never has to be abandoned for one setting:
 *   openWorld({ seed: 7, camera: 'follow', calendar: { seasons: ['wet', 'dry'], daysPerSeason: 28 }, characters: { npcs: false }, rigid: false, ambience: false })
 * The bundle turns on the signal uViewDistance (terrain viewFog: true) and writes no fog: the game's own fog reads it to hide the far edge; openWorld({ terrain: { viewFog: false } }) leaves it alone.
 * Shorthands still work and go to their module: seed / viewChunks / density / flatten → terrain, time / dayLength → calendar,
 *   weather: 'rain' (starting weather) and autoWeather → weather. An object for the same module wins over the shorthand.
 * debug: installed only in dev builds by default (players of a release build get no F3 panel); true installs it in release builds too.
 * Camera (required: the bundle picks no camera feel for the game): 'follow' / 'firstPerson' / 'rts' / 'fixed', a camera module with options, or false:
 *   engine.use(openWorld({ seed: 7, camera: followCamera({ shoulder: 0.7, distance: 3 }) }));
 * Switch at runtime: engine.setCamera('firstPerson') (see recipes/21-camera.md).
 * @param {{ camera: 'follow' | 'firstPerson' | 'rts' | 'fixed' | false | import('./types/core').ModuleDef, [k: string]: any }} opts
 */
export function openWorld(opts = {}) {
  readParams('openWorld()', keysSchema([...OPEN_WORLD_SHORT, ...Object.keys(OPEN_WORLD_PARTS)]), opts);
  const { seed, viewChunks, density, flatten = [], time, dayLength, autoWeather = false, camera } = opts;
  if (camera === undefined) throw codedError('open-world-camera', OW_ERR.noCamera);   // no default camera feel: the game names one (genericity rule)
  if (typeof camera === 'string' && !CAMERAS[camera]) throw codedError('preset-option', fmt(OW_ERR.camera, { k: camera, list: Object.keys(CAMERAS).join(', ') }));
  const w = opts.weather;
  // characters: a walking game's preset chooses to bring what falls back; the engine alone never does. openWorld({ characters: { fall: false } }) leaves it to the game
  const short = { terrain: { seed, viewChunks, density, flatten, viewFog: true }, calendar: { time, dayLength }, weather: { start: typeof w === 'string' ? w : undefined, auto: autoWeather }, characters: { fall: 'rescue' } };   // no start: weather() picks one from the game's table
  const part = k => {
    const v = opts[k];
    if (v === false || (k === 'debug' && v === undefined && !DEV)) return null;
    if (v !== undefined && v !== true && typeof v !== 'object' && !(k === 'weather' && typeof v === 'string')) {
      throw codedError('preset-option', fmt(OW_ERR.part, { k, got: String(JSON.stringify(v)) }));
    }
    if (k === 'vegetation' && opts.terrain !== false && v && typeof v === 'object' && Object.keys(v).length) throw codedError('preset-option', fmt(OW_ERR.noOpts, { k, got: JSON.stringify(v), hint: VEGETATION_HINT }));
    return OPEN_WORLD_PARTS[k]({ ...short[k], ...(typeof v === 'object' ? v : null) });
  };
  const cam = camera === false ? null : typeof camera === 'string' ? CAMERAS[camera]() : camera;
  return [part('world'), part('terrain'), part('vegetation'), part('calendar'), part('sky'), part('weather'), part('water'), part('collision'), part('rigid'),
    cam, part('characters'), part('ambience'), part('settings'), part('debug')].filter(Boolean).flat();   // flat: terrain(), vegetation() and weather() are two modules each (data + drawing)
}

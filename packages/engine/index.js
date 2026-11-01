// Engine entry.
//
// Core (always present): rendering, main loop, events, input, assets, audio, saves, UI base, loading screen, ground API
// Modules (opt-in): every lowercase function exported below is a module
//
//   import { createEngine, terrain, vegetation, sky, weather, water, collision, rigid,
//            followCamera, characters, interactions, dialogue, inventory, quests, photo, ambience, debug } from 'threedog';
//   import lowpoly from '@threedog/style-lowpoly';              // optional: the engine itself ships no art
//   import { terrainPreset } from '@threedog/terrain-noise';   // optional: nor a terrain generator
//
//   const engine = createEngine({ canvas, style: lowpoly });   // without a style pack: neutral gray placeholders
//   engine.use(terrain({ seed: 7, ...terrainPreset() }), vegetation(), sky(), weather(), water(), collision(), followCamera(), characters());
//   engine.start();
//
// Or install the usual open-world set at once with a preset: engine.use(openWorld({ seed: 7, camera: 'follow', terrain: terrainPreset() }))
import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { terrain } from './modules/terrain/index.js';
import { vegetation } from './modules/vegetation/index.js';
import { sky } from './modules/sky/skyModule.js';
import { weather } from './modules/weather/Weather.js';
import { water } from './modules/water/Water.js';
import { collision } from './modules/collision/Collision.js';
import { rigid } from './modules/rigid/RigidBodies.js';
import { followCamera } from './modules/camera/FollowCamera.js';
import { characters } from './modules/characters/index.js';
import { interactions } from './modules/gameplay/Interactions.js';
import { dialogue } from './modules/gameplay/Dialogue.js';
import { inventory } from './modules/gameplay/Inventory.js';
import { quests } from './modules/gameplay/Quests.js';
import { photo } from './modules/photo/Photo.js';
import { ambience } from './modules/ambience/Ambience.js';
import { debug } from './modules/debug/DebugPanel.js';
import { level } from './modules/level/index.js';
import { triggers } from './modules/triggers/index.js';
import { entities } from './modules/entities/index.js';
import { particles } from './modules/particles/Particles.js';
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
import { checkOptions, DEV } from './core/validate.js';
import { codedError } from './core/errorHints.js';

// Engine and Animator are exported for types and instanceof; make them with createEngine / engine.assets.animate (AI.md entry-point table)
export { THREE, Engine };
export { Animator } from './core/Animator.js';
export { terrain, vegetation, sky, weather, water, collision, rigid, followCamera, characters, interactions, dialogue, inventory, quests, photo, ambience, debug,
  level, triggers, entities, particles, settings, music, firstPersonCamera, fixedCamera, rtsCamera, timeline, nav, hlod, lightPool, content, flow, hud, world, grids };
export { net, fakeNetwork, webSocket } from './modules/net/index.js';
export { screenToGround } from './core/screenToGround.js';
export { EASINGS, ease } from './core/easing.js';
export { checkOptions };   // for game-made modules (recipes/14): the package exposes no core/* deep paths
export { createTerrain } from './modules/terrain/index.js';
export { Character, NPC } from './modules/characters/index.js';
export { presets } from './presets.js';   // opt-in gameplay presets (weather tables, calendars, player feel, camera): never applied by the engine itself
export { terrainMaterial, mergeColored, applyEffects, makeMaterial, MATERIAL_PURPOSES } from './render/materials.js';
export { materialPatches } from './render/patches.js';
export { toast, makeWindow, worldToScreen, fadeScreen, uiFocus, toggleOnKey } from './ui/UI.js';
export { parseClock, formatClock, inRange } from './core/dayTime.js';
export { pickTarget, switchTarget } from './core/targeting.js';

/** Create an engine (core only). For the options see core/Engine.js */
export function createEngine(opts) { return new Engine(opts); }
export { postAdd, postRemove } from './core/styleParts.js';

/**
 * Open-world preset: covers only "world and environment" plus the basics every game needs:
 *   world, terrain, vegetation, sky, weather, water, collision, rigid, camera, characters, ambience, settings, debug (debug only in dev builds).
 * Gameplay modules (interactions, dialogue, inventory, quests, photo mode, timeline, trigger zones, entities, particles, music, markers...) are not included:
 *   engine.use(openWorld({ seed: 7, camera: 'follow' }), interactions({ ...presets.interactions.nearest }), dialogue(), inventory({ ...presets.keys.inventory }), quests({ ...presets.keys.quests }));
 * Every part takes false (leave it out) or an object (that module's own options), so the preset never has to be abandoned for one setting:
 *   openWorld({ seed: 7, camera: 'follow', sky: { seasons: ['wet', 'dry'], daysPerSeason: 28 }, characters: { npcs: false }, rigid: false, ambience: false })
 * The bundle hides the terrain's far edge in fog (terrain viewFog: true; openWorld({ terrain: { viewFog: false } }) keeps the game's fogFar).
 * Shorthands still work and go to their module: seed / viewChunks / density / flatten → terrain, time / dayLength → sky,
 *   weather: 'rain' (starting weather) and autoWeather → weather. An object for the same module wins over the shorthand.
 * debug: installed only in dev builds by default (players of a release build get no F3 panel); true installs it in release builds too.
 * Camera (required: the bundle picks no camera feel for the game): 'follow' / 'firstPerson' / 'rts' / 'fixed', a camera module with options, or false:
 *   engine.use(openWorld({ seed: 7, camera: followCamera({ shoulder: 0.7, distance: 3 }) }));
 * Switch at runtime: engine.setCamera('firstPerson') (see recipes/21-camera.md).
 * @param {{ camera: 'follow' | 'firstPerson' | 'rts' | 'fixed' | false | import('./types/core').ModuleDef, [k: string]: any }} opts
 */
const CAMERAS = { follow: followCamera, firstPerson: firstPersonCamera, rts: rtsCamera, fixed: fixedCamera };
const OPEN_WORLD_PARTS = { world, terrain, vegetation, sky, weather, water, collision, rigid, characters, ambience, settings, debug };
const OPEN_WORLD_SHORT = ['seed', 'viewChunks', 'density', 'flatten', 'time', 'dayLength', 'autoWeather', 'camera'];
const OW_ERR = { camera: 'openWorld(): camera has no kind \'{k}\'; available: {list}, or pass a camera module (e.g. rtsCamera({ height: 60 })) or false',
  noCamera: "openWorld(): no camera given; pick one: openWorld({ camera: 'follow' }) (or 'firstPerson' / 'rts' / 'fixed', a camera module such as followCamera(presets.camera.overShoulder), or false for none)",
  part: 'openWorld(): {k} must be false (leave it out), true or an options object, e.g. openWorld({ {k}: false }); got {got}',
  noOpts: 'openWorld(): {k} takes no options, only true / false; got {got}. {hint}' };
// parts whose module takes no options: an options object would be dropped silently, so it throws and points to where the setting lives
const NO_OPTIONS = { vegetation: 'How much vegetation grows is a terrain setting: openWorld({ density: 1.5 }) or terrain({ density }); the species are game content (content vegetation; a style pack only paints them). On ground without terrain (a level) it takes its own options: openWorld({ terrain: false, vegetation: { area, density } })' };
export function openWorld(opts = {}) {
  checkOptions('openWorld()', opts, [...OPEN_WORLD_SHORT, ...Object.keys(OPEN_WORLD_PARTS)]);
  const { seed, viewChunks, density, flatten = [], time, dayLength, autoWeather = false, camera } = opts;
  if (camera === undefined) throw codedError('open-world-camera', OW_ERR.noCamera);   // no default camera feel: the game names one (genericity rule)
  if (typeof camera === 'string' && !CAMERAS[camera]) throw new Error(OW_ERR.camera.replace('{k}', camera).replace('{list}', Object.keys(CAMERAS).join(', ')));
  const w = opts.weather;
  const short = { terrain: { seed, viewChunks, density, flatten, viewFog: true }, sky: { time, dayLength }, weather: { start: typeof w === 'string' ? w : undefined, auto: autoWeather } };   // no start: weather() picks one from the game's table
  const part = k => {
    const v = opts[k];
    if (v === false || (k === 'debug' && v === undefined && !DEV)) return null;
    if (v !== undefined && v !== true && typeof v !== 'object' && !(k === 'weather' && typeof v === 'string')) {
      throw new Error(OW_ERR.part.replaceAll('{k}', k).replace('{got}', JSON.stringify(v)));
    }
    // vegetation takes options only when it grows on its own chunks (terrain: false); on terrain those settings belong to terrain
    if (NO_OPTIONS[k] && !(k === 'vegetation' && opts.terrain === false) && v && typeof v === 'object' && Object.keys(v).length) throw new Error(OW_ERR.noOpts.replace('{k}', k).replace('{got}', JSON.stringify(v)).replace('{hint}', NO_OPTIONS[k]));
    return OPEN_WORLD_PARTS[k]({ ...short[k], ...(typeof v === 'object' ? v : null) });
  };
  const cam = camera === false ? null : typeof camera === 'string' ? CAMERAS[camera]() : camera;
  return [part('world'), part('terrain'), part('vegetation'), part('sky'), part('weather'), part('water'), part('collision'), part('rigid'),
    cam, part('characters'), part('ambience'), part('settings'), part('debug')].filter(Boolean);
}

// @ts-check
// __NAME__: open-world starter template — a player on generated terrain, a few apples and one searchable stash. Write gameplay ideas in DESIGN.md.
// main.js holds rules only (modules, ops, state, presentation). Everything placed in the level is content: content/templates.js + content/props.js (rule R33).
import { createEngine, presets, openWorld, followCamera, interactions, inventory, pickups, content, hud } from 'threedog';
import style from './style/index.js';   // the game's own style: empty for now (gray placeholders); fill it, recipes 09 and 52
import { terrainPreset } from '@threedog/terrain-noise';   // optional: a terrain generator (the engine ships none)
import data from './content/index.js';
import packs from './assets.js';

const engine = createEngine({ bindings: { ...presets.bindings.walk, ...presets.bindings.interact, ...presets.bindings.inventory, ...presets.bindings.quests, ...presets.bindings.photo, ...presets.bindings.debug }, canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), style, ui: { loading: { title: '__NAME__' } }, saveKey: '__NAME__' });   // sounds are content: content/audio.js
// openWorld installs the world and environment (terrain, vegetation, calendar, sky, weather, water, collision, camera, characters, settings, debug); add gameplay modules yourself.
// More you can add (installed above: interactions inventory pickups content hud): dialogue() quests() triggers() timeline() particles() music() photo() grids(), usage in node_modules/threedog/docs/api/<module>.md
engine.use(openWorld({ camera: followCamera({ pointerLock: true }), seed: 42, terrain: terrainPreset(), time: 0.3, calendar: presets.calendar.cycle }), interactions({ ...presets.interactions.nearest }), inventory(), pickups(), content(), hud());

const home = engine.characters.findSpawn([0, 0, 0], { minH: 3, maxH: 14 });   // the terrain is generated: find a flat spot as "home". home is a Vector3, use home.x / home.z, not home[0]
engine.assets.manifest(packs);   // assets.js: the names content uses (crate, a gray box made in code); add GLB files and sounds there the same way
engine.characters.createPlayer({ ...presets.player.thirdPerson, spawn: home });   // no model: a gray capsule body (recipe 13 for a model)
engine.content.load(data, { places: { home } });   // in content/, place things relative to home with { place: 'home', x, z }

// ---------- The game's own state, inside the engine's systems ----------
const game = { hp: 10, maxHp: 10, hunger: 0, restCooldown: 0 };   // plain values only, so it saves and describes as is
engine.describe.add('game', () => ({ ...game }));   // describe(), the dev bridge and MCP see it as describe().game
engine.saves.register('game', { version: 1, save: () => ({ ...game }), load: d => { Object.assign(game, d); } });   // saved, and reset by session.newGame

// ---------- Gameplay actions are ops: keys, UI, tests and the AI all run them the same way (engine.ops.run('player.rest')) ----------
engine.ops.define('player.rest', {
  desc: 'Rest to recover hp (then 10 s cooldown)',
  can: () => game.restCooldown > 0 ? 'tired' : game.hp >= game.maxHp ? 'full' : true,
  run: () => { game.hp = game.maxHp; game.restCooldown = 10; },
  reasons: { tired: 'Rested too recently', full: 'Already at full hp' },
});
// The stash template's interact runs this op with the instance id (content/templates.js)
engine.ops.define('stash.search', {
  desc: 'Take everything from a stash', args: { id: 'string' },
  can: (e, { id }) => e.inventory.container(id).list().length > 0 || 'empty',
  run: (e, { id }, ctx) => { for (const it of e.inventory.container(id).list()) e.inventory.transfer(id, ctx.actor, it.id, it.count); },
  reasons: { empty: 'Nothing left' },
});

// onFixed: game time — damage, cooldowns, AI, timers, gameplay keys (same result at any frame rate)
engine.onFixed(dt => {
  game.restCooldown = Math.max(0, game.restCooldown - dt);
  game.hunger += dt;
  if (game.hunger >= 60) { game.hunger = 0; game.hp = Math.max(1, game.hp - 1); }   // a timer on the fixed-step dt: -1 hp per minute of play
  if (engine.input.pressed('rest')) engine.ops.run('player.rest', {}, { source: 'player' });
});
// onFrame: presentation only — animation, camera feel, HUD
let shownHp = -1;
engine.onFrame(() => { if (game.hp !== shownHp) engine.hud.counter('hp', { icon: '❤', label: 'HP', value: shownHp = game.hp, max: game.maxHp }); });

window.engine = engine;   // tests, screenshots and the console all rely on it (before start, so the dev bridge can wait for it)
await engine.start();      // when start returns the modules are ready; anything that needs the terrain generated (finding a shore, reading ground height) goes after this line

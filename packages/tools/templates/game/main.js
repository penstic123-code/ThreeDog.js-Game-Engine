// @ts-check
// __NAME__: blank start — an empty scene and a camera (plus the engine's always-on render baseline: lights, tone, color). No gameplay yet: build what DESIGN.md describes.
// main.js holds rules only (modules, ops, state, presentation). Everything placed in the level is content: content/templates.js + content/props.js (rule R33).
// Nothing here assumes a genre: add the modules your design needs (terrain, sky, a camera rig, characters...), or plain three.js objects to engine.scene.
// Want a ready open world instead (generated ground, day/night sky, follow camera, a player)? threedog new-game name --open-world
import { createEngine, world, content } from 'threedog';
import style from './style/index.js';   // the game's own style: empty for now (gray placeholders); fill it, recipes 09 and 52
import data from './content/index.js';
import packs from './assets.js';

const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), style, ui: { loading: { title: '__NAME__' } }, saveKey: '__NAME__' });   // sounds are content: content/audio.js
// world() stores what content/ places (props, pickups) and saves their changes; content() loads content/. Modules you can add (interactions, inventory, pickups for items on the ground, dialogue, quests, hud...): node_modules/threedog/docs/api/<module>.md
engine.use(world(), content());
engine.assets.manifest(packs);   // assets.js: the models / sounds / textures content names (empty for now)

// The camera is a plain THREE.PerspectiveCamera: place it yourself, or add a camera module (followCamera, rtsCamera...; recipe 21)
engine.camera.position.set(0, 6, 12);
engine.camera.lookAt(0, 0, 0);
engine.content.load(data, { places: data.places });   // the places of content/places.js get their coordinates here (a place computed at startup: { ...data.places, home })

window.engine = engine;   // tests, screenshots and the console all rely on it (before start, so the dev bridge can wait for it)
await engine.start();      // when start returns the modules are ready

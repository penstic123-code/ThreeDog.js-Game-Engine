// @ts-check
// __NAME__: blank start — an empty scene and a camera (plus the starting picture in picture/: a gray sun and ambient light, written by this game). No gameplay yet: build what DESIGN.md describes.
// main.js holds rules by default (modules, ops, state, presentation), and things placed in the level default to content (content/templates.js + content/props.js),
// because saves and GAMEMAP read it. Plain three.js objects work just as well. The one fact to keep: what a save stores whole must not be made again at startup (rule R33).
// Nothing here assumes a genre: add the modules your design needs (terrain, sky, a camera rig, characters...), or plain three.js objects to engine.scene.
// Wired already, because nearly every game needs them and they cost one line each: start screen (ui.title: Continue / Start), autosave, Esc = pause + settings menu.
// Why they are here: nearly every game needs a start screen, a save and a pause menu, and writing them by hand costs far more code and leaves them out of
// saves and tests. Keep it, replace it (engine.ui.set), or delete it; a hand-written one needs its own save and test hooks. CLAUDE.md "Already here" lists the rest.
// Want a ready open world instead (generated ground, day/night sky, follow camera, a player)? threedog new-game name --open-world
__TSL_IMPORT__
import { createEngine, presets, world, content, settings /*, THREE, characters, collision, followCamera, hud, interactions, dialogue, quests, vegetation */ } from 'threedog';
import { createPicture } from './picture/index.js';   // the game's own picture in plain three.js: gray for now; make it yours, recipe 62
import data from './content/index.js';
import packs from './assets.js';

const engine = createEngine({ __RENDERER__bindings: { ...presets.bindings.walk, ...presets.bindings.interact }, canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: { title: '__NAME__' }, title: { title: '__NAME__' } }, saveKey: '__NAME__' });   // sounds are content: content/audio.js
// world() stores what content/ places (props, pickups) and saves their changes; content() loads content/. Modules you can add (interactions, inventory, pickups for items on the ground, dialogue, quests, hud...): node_modules/threedog/docs/api/<module>.md
engine.use(world(), content(), settings({ freezeWorld: true }));   // settings: Esc pauses and opens the menu (graphics quality, audio, keys, language, saves)
engine.saves.autosave(0.5);   // minutes of play; Continue on the start screen loads it. The game's own state joins with engine.saves.register('game', { version: 1, save, load }), recipe 20
engine.use(createPicture());   // a picture module; to switch looks: engine.use(another(), { replaces: 'picture' })
const { picture } = engine;   // picture.materials: the game's materials by name
engine.assets.manifest(packs);   // assets.js: the models / sounds / textures content names (empty for now)

// ---- Ready lines, all commented: uncomment what the design needs (and its names in the import above). They save writing; they limit nothing: the picture and
// every object stay plain three.js, and you may mix both freely. Rules and the full set: recipe 63 and node_modules/threedog/docs/recipes/.
// engine.use(collision(), characters({ fall: 'rescue' }), followCamera({ pointerLock: true }), hud(), interactions({ ...presets.interactions.nearest }), dialogue(), quests());
// engine.characters.createPlayer({ ...presets.player.thirdPerson, spawn: [0, 0, 0] });   // walks (WASD / stick), camera behind it; Shift runs, Space jumps (presets.bindings.walk above)
// engine.collision.addBlocked((x, z) => Math.abs(x) > 20 || Math.abs(z) > 20);            // the walkable shape (here a 40 m square); engine.collision.addObject(mesh) makes a mesh solid
// const guide = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1, 4, 8), new THREE.MeshStandardMaterial({ color: 0xc89a5a })); guide.position.set(4, 0.9, -3); engine.scene.add(guide);   // any three.js object
// engine.dialogue.define('guide', { start: { text: 'Hello! Visit the well.', choices: [{ text: 'On my way', do: s => { s.flags.met = true; } }, { text: 'Later' }] } });   // flags are saved
// const shell = new THREE.Mesh(new THREE.SphereGeometry(0.25), new THREE.MeshStandardMaterial({ color: 0xd8c8a8 })); shell.name = 'shell'; shell.position.set(-3, 0.25, -2); engine.scene.add(shell);
// engine.interactions.add(shell, { id: 'shell-1', label: 'Pick up', once: true, counter: 'coins' });   /* counter: the HUD's count (describe hud), not engine.vars */   // E (presets.bindings.interact above) near any mesh: hides it, counts it, both saved
// engine.interactions.add(guide, { label: 'Talk', onUse: () => engine.dialogue.start('guide') });   // E near it; works on any mesh, "Talk" can as well be "Open" or "Pick up"
// engine.hud.counter('coins', { label: 'Coins', value: 0 });   // update: call it again with the new value
// engine.input.action('use', { label: 'Use', keys: ['KeyE'] });   // your own key: read it with engine.input.pressed('use') in onFixed; every key the game needs must be bound
// engine.quests.define('visit', { title: 'Visit the well', steps: [{ text: 'Talk to the guide', target: guide, done: e => !!e.dialogue.state.flags.met }, { text: 'Go to the well', target: { x: -6, z: 5 }, done: e => { const p = e.actorPosition(); return !!p && Math.hypot(p.x + 6, p.z - 5) < 2; } }] });   // a marker arrow shows the target
// engine.quests.start('visit');
// engine.input.bind(presets.bindings.quests);   // J opens the quest log
// Grass, trees, flowers on your own geometry at your own spots: engine.use(vegetation()); engine.vegetation.define('flower', { geometry, positions: [[3, 2], [5, 4, 1.2]] }) (recipe 05 §2e).

// The camera is a plain THREE.PerspectiveCamera: place it yourself, or add a camera module (followCamera, rtsCamera...; recipe 21)
engine.camera.position.set(0, 6, 12);
engine.camera.lookAt(0, 0, 0);
engine.content.load(data);   // content/places.js comes with data; a place computed at startup goes on top: engine.content.load(data, { places: { home } })

Object.assign(window, { engine, picture });   // tests, screenshots and the console all rely on it (before start, so the dev bridge can wait for it)
await engine.start();      // when start returns the modules are ready

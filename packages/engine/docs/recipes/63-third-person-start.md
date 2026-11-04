# Third-person start: walking, camera, save, pause, menu

**In this recipe**: 1. The sixteen lines · 2. What each line gives · 3. Where it stops · 4. Talk, press E, a quest, a counter · 5. Not worth it for a small game

The shortest working path for a game where a character walks around a place you built yourself. It is the blank template's `main.js` plus a few lines, on any
ground (`--open-world` adds generated terrain and a sky on top of the same parts). The picture stays plain three.js in `picture/`; nothing here touches it.

## 1. The sixteen lines
```js
import { createEngine, presets, world, content, settings, characters, collision, followCamera, hud } from 'threedog';
import { createPicture } from './picture/index.js';
import data from './content/index.js';

const engine = createEngine({ canvas: document.getElementById('view'), lights: false,
  bindings: { ...presets.bindings.walk, ...presets.bindings.interact },                                                   // Shift runs, Space jumps, E uses; WASD, arrows and the pad stick are built in
  ui: { loading: { title: 'Pier' }, title: { title: 'Pier' } }, saveKey: 'pier' });                                       // start screen: Continue (once a save exists), Start, Settings
engine.use(world(), content(), collision(), characters(), followCamera({ pointerLock: true }), hud(), settings({ freezeWorld: true }));
engine.saves.autosave(0.5);                                                         // every 30 s of play
const picture = createPicture(engine);
engine.collision.addBlocked((x, z) => Math.abs(x) > 3 || Math.abs(z) > 20);         // the walkable shape: here a pier 6 m by 40 m
engine.characters.createPlayer({ ...presets.player.thirdPerson, spawn: [0, 0, 0] });
engine.content.load(data, { places: data.places });

const game = { score: 0 };                                                          // the game's own state: plain values
engine.saves.register('game', { version: 1, save: () => ({ ...game }), load: d => { Object.assign(game, d); } });
engine.hud.counter('score', { label: 'Score', value: game.score });
Object.assign(window, { engine, picture });
await engine.start();
```

## 2. What each line gives
| You get | From | Without writing |
|---|---|---|
| WASD, arrows, stick, run, jump, walking relative to the camera, gravity | `characters()`, `presets.player.thirdPerson` | movement code, key listeners |
| The camera follows, mouse turns it, walls pull it in | `followCamera()` | camera rig, pointer lock |
| The player's position and your state come back after a refresh | `saves.autosave`, `saves.register`, Continue on the start screen | localStorage code, a save format, versioning, a corrupt-save path |
| Esc stops the game and opens a menu: quality presets, volume, keys, language, save files | `settings({ freezeWorld: true })` | a pause flag in every system, a menu |
| A walkable shape and solid things | `collision()`: `addBlocked`, `addBox`, `addCircle`, `addObject(mesh)` | bounds checks in the movement code |
| A score on screen | `hud()`, `engine.hud.counter` | DOM upkeep |

A floor that is not at `y = 0`: `engine.setGround({ height: (x, z) => 0.4 })`. A body for the player: `createPlayer({ model })` (recipe 13); without one it is a gray capsule.

## 3. Where it stops
Each part is one line to swap and none of them holds the rest back:
- Your own movement or feel: recipe 21 §5 replaces one piece of the player and keeps saving and `describe().player`; drop `characters()` and write it all, and the rest still works.
- Your own start screen: `engine.ui.set('title', ...)`; your own menu: recipe 26 §6. Win and lose windows: `makeWindow` with `closable: false` (recipe 26 "The choice cursor"), replay with `engine.session.newGame()`.
- Saving at a moment you choose (a lamp lit, a level done): `await engine.saves.save()` beside the timer. A refresh keeps what the last save wrote, so a save started as the page closes is not one to rely on.
- Pictures past the start screen: `threedog shot --play`.

## 4. Talk, press E, a quest, a counter
Add `THREE, interactions, dialogue, quests` to the import and `interactions({ ...presets.interactions.nearest }), dialogue(), quests()` to `engine.use`; E is already bound in section 1 (any other key works: `interact: ['KeyF']`; with no key at all the game stops in dev with the line to add). Then, before `engine.start()`:
```js
const guide = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1, 4, 8), new THREE.MeshStandardMaterial({ color: 0xc89a5a }));   // any three.js object
guide.position.set(0, 0.9, -8); engine.scene.add(guide);
const shell = new THREE.Mesh(new THREE.SphereGeometry(0.25), new THREE.MeshStandardMaterial({ color: 0xd8c8a8 }));
shell.name = 'shell'; shell.position.set(1, 0.25, -4); engine.scene.add(shell);
engine.dialogue.define('guide', { start: { text: 'Pick up the shell, then walk to the end of the pier.', choices: [{ text: 'On my way', do: s => { s.flags.met = true; } }, { text: 'Later' }] } });
engine.interactions.add(shell, { id: 'shell-1', label: 'Pick up', once: true, counter: 'coins' });   // hides it, counts it, both saved
engine.interactions.add(guide, { label: 'Talk', onUse: () => engine.dialogue.start('guide') });   // E nearby; the same call works on a door, a lever
engine.input.bind(presets.bindings.quests);   // J opens the quest log
engine.quests.define('pier', { title: 'The pier', steps: [
  { text: 'Talk to the guide', target: guide, done: e => !!e.dialogue.state.flags.met },
  { text: 'Walk to the pier end', target: { x: 0, z: 18 }, done: e => (e.actorPosition()?.z ?? 0) > 17 }] });   // a marker arrow follows the target
engine.quests.start('pier');
engine.hud.counter('coins', { label: 'Coins', value: 0 });   // call again with a new value to update it
```
Dialogue flags, quest progress and what `once` and `counter` did are saved by the modules: no `register` for them.

## 5. Not worth it for a small game
For these, plain three.js and `engine.setGround` are the shorter road; the modules pay off only when a game leans on them:
- Water: a `PlaneGeometry` with your own material is enough for a pond or a sea seen from a pier. `water()` earns its place with waves that float things, or swimming.
- Full terrain: a flat or gently rolling island is `engine.setGround({ height: (x, z) => ... })` plus meshes. `terrain()` is for large streamed worlds.
- The sky module for a fixed time of day: a background color or a gradient mesh and your own lights. `sky()` is for a day that changes.
- Rigid vehicles: a mesh that moves by your own rule needs no physics. `rigid()` is for things that must push, roll and collide.

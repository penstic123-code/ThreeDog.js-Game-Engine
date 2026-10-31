# Scene transitions and pause (flow)

Needs the module `flow()` (not in openWorld; add it yourself: `engine.use(openWorld({...}), flow())`).
- **Flow states**: title, playing (built-in `playing`), paused (built-in `paused`: freezes gameplay + locks input), ending, ... Only one is active at a time.
- **Scene transition** `transition(fn)`: lock input -> fade to black -> fade music out -> (with `{ autosave: 'auto' }` save slot 'auto'; off by default) -> run fn -> wait until every module is ready -> fade in -> unlock. Repeated calls queue up automatically.

## 1. Pause / title / ending (in main.js)
```js
import { flow, toast } from 'threedog';
const titleEl = document.getElementById('title'), startBtn = document.getElementById('start');   // elements you wrote in the page html
engine.use(flow({ start: 'title' }));            // start in the title state (entered after world:ready)

engine.flow.define('title', {
  freeze: true, lockInput: true, music: 'title',   // music: the track to play on entry (music module), null = stop
  enter: (e, from) => { titleEl.hidden = false; },
  exit: (e, to) => { titleEl.hidden = true; },
});
engine.flow.define('ending', { freeze: true, lockInput: true, enter: () => toast(engine, '完') });
startBtn.onclick = () => engine.flow.go('playing');

engine.input.define('pause', ['KeyO'], '暂停');   // read by action name; Esc is the back key (see below), P is photo mode, I/J/E are taken too (see the key table in GAMEMAP)
engine.onFrame(() => {
  if (engine.input.pressedRaw('pause')) engine.flow.go(engine.flow.state === 'paused' ? 'playing' : 'paused');   // paused pushes an opaque input context, so use pressedRaw
});
engine.events.on('flow:change', ({ from, to }) => console.log(from, '->', to));
```
**Pausing has a single entry point: flow's `'paused'`** (internally `engine.freeze('flow')`: the picture keeps rendering and the UI keeps working). **Don't use `engine.pause()`** (it stops even rendering and is for tests).
The settings menu also pauses while open: `settings({ freezeWorld: true })`. With flow installed it switches to `'paused'` and returns to the previous state when the menu closes; without flow it calls `engine.freeze('settings')` directly.
Stopped while frozen: the fixed step (movement, physics), module `fixed`, the game clock `clock`, quest checks (they run in the fixed step), timeline `wait` / tweens / camera / paths. Still running: rendering, UI, `onFrame`, the fade-to-black `fadeScreen`.

### Back key (Esc): the UI focus stack
Windows (inventory, quests, settings), dialogue and cutscenes are pushed onto the stack in the order they open (`uiFocus(engine)` in `ui/Focus.js`), and Esc goes **only to the top one**:
cutscene -> skip; window -> close; dialogue -> swallow (do nothing); empty stack -> open the settings menu. So one Esc never both skips a cutscene and opens the menu, and no patch like "ignore keys for 0.15 s after opening" is needed.
A game's own windows made with `makeWindow` are pushed automatically (`onCancel` changes what Esc does); UI you draw yourself must be pushed:
```js
import { uiFocus } from 'threedog';
const h = uiFocus(engine).push('myMap', { cancel: () => closeMap() });   // call h.remove() when closing; h.fresh = opened this very frame
```

## 2. Changing scene / teleporting
```js
// A level-based game: switch to another map
await engine.flow.transition(async () => {
  await engine.level.load('/models/town2.glb');             // or a name from the assets manifest
  engine.player.placeAt(engine.level.spawn);
  engine.cameraRig.follow(engine.player.root);               // the camera jumps straight there instead of flying from far away
}, { fade: 0.6, autosave: 'auto' });                         // also save slot 'auto' before switching

// Teleport within the same map (the city example's teleport pad): no save, music keeps playing
engine.flow.transition(() => engine.player.placeAt([40, 0, -20]), { music: 'keep' });
```
When the level changes, the old level's things are cleared automatically: trigger zones built by `triggers.fromMarkers`, and pickups / trigger zones / props in content whose position uses a level marker.
An NPC like that is not deleted: its data (in `engine.world`, with zone = level name) stays and only the model is removed; it is rebuilt automatically when you return to this map, with its state intact.
Things the game builds itself that belong to this map are registered with `engine.level.track(handle)` (`{ remove() }`) and deleted together when the map changes.
Loading a save across levels: the save records the level name, so `await engine.saves.load('slot1')` first switches back to that map, waits for it to finish loading, and then puts the player and everything else back (the level must be loaded by name, `level({ url })`; a code-built `level({ scene })` can't be recorded).

Saves live in the browser's IndexedDB (no 5 MB limit; when it is unavailable it falls back to localStorage and tells you once; old localStorage saves are moved over on first launch). `save()` / `remove()` return a Promise (awaiting is optional; a failed write shows a notice), while `list()` / `load()` / `export()` are still synchronous (saves are read into memory at startup). Photos are stored separately as Blobs and are not part of the world save.
Backup: `engine.saves.exportFile('slot1')` downloads a .json (including all binary attachments such as photos; `{ files: false }` gives only the world save), and `await engine.saves.importFile(file)` restores it into a save slot (without a file, a file picker opens); the "Saves" page of the settings menu has matching buttons.
For just a fade-to-black, without locking input or saving: `await fadeScreen(engine, 1, 0.5); ...; await fadeScreen(engine, 0, 0.5);` (import from `threedog`).
Fades inside a cutscene use the timeline steps `{ fade: 0.5 }`, `{ fade: 0.5, to: 0 }`.

## 2b. Input contexts (menus, vehicles, build mode)
Actions are grouped into **contexts**, a stack like Unity's Action Maps. `input.push(name)` returns a handle; `h.remove()` pops it. The top context shadows lower actions bound to the same key; an opaque context (the default) blocks everything below it, `{ pass: true }` lets unrelated actions through. Dialogue, windows, full-screen UI parts, cutscenes, paused and transitions each push an opaque one: that is what "locks input" means (`input.enabled` is false while one is on the stack).
```js
engine.input.define('exit', 'KeyF', 'Get out', { context: 'vehicle' });          // 'interact' has E; give the vehicle its own keys
engine.input.define('inspect', 'KeyF', 'Inspect');                               // gameplay action on the same key
const h = engine.input.push('vehicle', { pass: true });                          // now F means exit, inspect is shadowed, WASD still works
h.remove();                                                                       // back on foot
engine.input.define('menuConfirm', 'Space', 'OK', { context: 'menu' });          // readable only while a window / menu is open
```
- A switch applies at the start of the next fixed step (the input snapshot), so the press that boarded cannot also get out in the same step. Actions the switch blocks lose their held state, and a key cleared this way stays dead until released: closing a menu never leaves a key "still held" and keyboard auto-repeat does not bring it back.
- Losing focus (`blur`, tab hidden) releases every held key.
- `describe().ui.inputContexts` lists the stack; the event `input:context { stack }` fires on every change. `characters()` pushes `'vehicle'` while the player drives (its `brake` action lives there).
- Test: `engine.input.push('menu'); engine.step(1 / 60);` then `input.pressed('attack')` is false.

## 3. Verify
- `describe().flow`: `{ state: 'paused', transitioning: false }`; when `describe().time.frozen` is true gameplay is frozen; `ui.inputLocked` shows whether input is locked.
- In tests: after `engine.flow.go('paused'); engine.step(1)` the player position, `engine.clock.now`, quest progress and timelines are unchanged; after `await engine.flow.transition(fn)` returns, `transitioning` is false (if fn throws, the error goes to the caller and the screen still fades back in).
- Related tests: `npm test -- 游戏流程` (city: transition fade and input lock, paused freeze), `npm test -- 接缝` (Esc focus stack, quests/timelines frozen while frozen, screen fades back in when transition fails).

## 4. New game / continue / back to title / retry (engine.session)
Every playthrough starts from a clean slate, so a second new game is exactly like the first:
```js
await engine.session.newGame();          // the state right after start(): world, containers, vars, quests, clock, sky, weather, random
await engine.session.load('slot1');      // continue (title "Continue", settings "Load"); retry: engine.session.load('checkpoint')
await engine.session.quit();             // back to the title (settings "Back to title"); the title's Start calls newGame
engine.session.track(engine.events.once('npc:talk', onTalk));   // anything the game adds during play: removed when the playthrough ends
```
Ending a playthrough skips a running cutscene, removes tracked handles, drops clock timers added after start(), drops background results not yet applied (commits), stops the music, applies the start state and snaps the camera to the player. flow goes back to its start state, then to `'playing'`. Events: `session:end`, `session:start { kind: 'new' | 'load', slot? }` (play an intro per new game there, not on `world:ready`).
- `saves.load(slot)` is a quick load onto the running playthrough (keeps what the game added); `session.load(slot)` ends the playthrough first and refuses an unreadable save without touching the game. Deleting a save is `saves.remove(slot)`.
- Listeners and hooks registered at boot stay (they are the game); register play-time ones with `session.track`.

## 5. Window and device (engine.page)
One place listens to window focus, tab visibility, mouse lock and the WebGL context; modules never add their own listeners.
- Window in the background / tab hidden: gameplay waits (no fixed steps; rendering and UI go on). `createEngine({ pauseOnBlur: false })` or `engine.page.pauseOnBlur = false` keeps playing. Coming back resumes with no catch-up burst; a long frame turns into at most 0.1 s of fixed steps.
- `engine.events.on('page:blur', () => engine.flow?.go('paused'))` also opens the pause menu. Other events: `page:focus`, `page:pointerlock { locked }` (cameras lock again on the next click), `page:contextlost` / `page:contextrestored` (gameplay waits and the player sees a message; three.js restores the context).
- `engine.step()` still advances while away (tests, dev bridge). Held keys are released by Input.
- Tests: `npm test -- "Session:" "Window:"`.

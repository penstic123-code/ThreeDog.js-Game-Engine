# Input: modules declare actions, the game binds keys

Three roles, one rule each:
- **A module declares** an action and the context it is read in, never a key: `ctx.input.action('choice1', { context: 'dialog' })`.
- **The game binds** keys: `createEngine({ bindings })`, `engine.input.bind(...)`, or a ready map from `presets.bindings`.
- **The player rebinds** in the settings menu, which calls `engine.input.rebind` and saves it.

Only the basics have default keys, the one default preset: WASD / arrows move (`moveForward` ...), `confirm` (Space / Enter / pad A),
`cancel` (Esc / pad B) and the UI cursor (`uiUp` ...). Every other key in your game is a line you wrote.

## 1. Bind keys (the game)
```js
import { createEngine, presets } from 'threedog';
const engine = createEngine({ canvas, bindings: {
  attack: ['KeyJ', 'Mouse0', 'PadX'],              // keyboard, mouse buttons (Mouse0 / 1 / 2) and gamepad buttons go in one list
  ...presets.bindings.dialogNumbers,               // 1-9 pick dialogue choices
  ...presets.bindings.debug,                       // F3 debug panel, F4 trigger wireframes
} });
engine.input.bind('dodge', ['ShiftLeft']);           // later, in code; returns a handle, remove() takes the keys away
engine.input.bind(presets.bindings.rtsRotate);       // a whole map at once: rotateLeft Q, rotateRight R
engine.input.action('brake', { context: 'vehicle', label: 'Brake', keys: ['KeyB'] });   // your own action with a context and a label for the menu
engine.onFixed(() => { if (engine.input.pressed('attack')) swing(); });   // gameplay keys are read in the fixed step
```
`presets.bindings`: `walk` (run / jump), `interact`, `inventory`, `quests`, `photo`, `gridRotate` (rotate), `brake`, `dialogNumbers` (choice1..9),
`rtsRotate` (rotateLeft / rotateRight), `cutsceneSkip` (skip: Backspace; cancel always skips), `debug` (debugPanel F3, triggersDebug F4). Spread one
and override a key like any object: `{ ...presets.bindings.rtsRotate, rotateLeft: ['KeyZ'] }`. No module takes a keys option: a module only declares
its actions (gone with the module), the game binds them; `[]` is deliberately no key.

## 2. Contexts: the top one wins
Every action belongs to one context. The stack starts with `walk`; a module or the game pushes others: `vehicle` (pass: unrelated `walk` actions
keep working), `dialog`, `menu`, `cutscene` (opaque: nothing below reads). The top context wins a key both bind.
```js
const car = engine.input.push('vehicle', { pass: true, owner: 'car' });   // brake (context vehicle) reads now; car.remove() pops it
engine.describe().input   // { stack: ['walk', 'vehicle(owner: car)'], unbound: [], rebound: { attack: ['KeyK'] } }
```
Details of switching (next fixed step, no stuck keys, focus loss): recipe 07 §2b.

## 3. In a module: declare, read, leave
```js
const sprint = () => ({ name: 'sprint', type: 'rules', install(e, ctx) {
  ctx.input.action('sprint', { label: 'sprint.action' });                  // no keys: the game binds 'sprint'
  ctx.input.action('sprintHud', { label: 'sprint.hud', optional: true });  // optional: reading it unbound is silent
}, fixed(dt, e) { if (e.input.down('sprint')) boost(e.player); } });
```
Everything a module declares or binds through `ctx.input` leaves with it (rollback, `replaces`, dispose).

## 4. What the engine tells you
- **`input-unbound`** (dev, once per action): a module needs an action nobody bound. The message names the action, its context and the bind line.
  `engine.input.isUnbound('interact')` asks the same thing: true for no key at all, false for any key, an optional action or `[]` (no key on purpose).
- **`interaction-no-key`** (dev warning, once per action): interactions were added to an action with no key. Rule R51 warns in `check`, `describe` calls the thing `no key bound`,
  and `ops` does not offer it, but `interaction.use` still runs when code asks: a click-only or touch-only game is right. `engine.input.bind('interact', [])` says so and ends the warning.
- **`input-bound-twice`** (dev throws; release: the later wins): two owners bind one action, e.g. the game's `createEngine({ bindings })` and a
  module's `ctx.input.bind` for the same action. Keep one. The same owner binding again only replaces its keys.
- **`input-action-context`**: two owners declare one action in different contexts. Rename one, or use the same context to share it.
- `describe().shared['input.keys[attack]']` says who bound the keys now in effect (writer `game`, `settings` for the player's choice, or a module).

## 5. Rebinding (the player)
`engine.input.rebind('attack', ['KeyK'])` is the player's choice, on top of the game's keys; `rebind('attack', null)` gives the game's back.
`engine.input.rebound()` lists them (the settings menu saves exactly that and restores it at start, even before the module declaring an action is
installed). The settings menu's key page, its reset button and its save all go through these two calls.

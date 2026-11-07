# Content vocabulary, key actions in actions.js, saving and loading at startup

**In this recipe**: 1. Condition words / effect words · 1b. Content packs · 2. actions.js: a game's own key actions · 3. Interact keys ·
4. Continue and new game · 4b. Best times and high scores · Save failures and versions · Save format

## 1. Condition words / effect words
The full vocabulary is in the last section of `../api/content.md` (**generated from `modules/content/rules.js`**, so it never goes stale):
`flag has counter setFlag give take bump startQuest toast particles marker ...`, each with how to write its value. A game's own words go in
`content/rules.js` (format in the comment at the top of `rules.js`), or in code with `engine.content.condition(name, def)`. A game's own actions are
ops, used from content as `{ op: ['noun.verb', { args }] }` / `{ can: [...] }` (`23-ops.md`), not new effect words:
`do: [{ take: { parcel: 1 } }, { op: ['delivery.done', { to: 'baker' }] }]`.
- `has / lacks / give / take` need the `inventory()` module; without it they throw an error that says so.
- Conditions are used in: quest step `done`, dialogue choice `if`, line variant `if`. Several entries in one object = all must hold; an array = every
  item must hold.
- Effects are used in: dialogue `do`, quest `reward`, trigger zone `onEnter / onExit`. Several entries in one object, or an array, run in order.
- Every word runs even when one fails. `content.run` answers `{ ok: true }` or a failure with `facts.failed` (`{ word, code, facts }`); an op returning it fails with it. Dialogue `do` and triggers: listen to `content:failed`.
- Content validation (content-check inside `threedog check` / `threedog map`) checks the word names and how the values are written.

### A game's own data kinds (enemies, recipes, loot tables, waves…)
`content/` knows the engine's files (items, npcs, quests…) plus any kind the game registers in `content/rules.js`.
Register once and the loader, `threedog check` and GAMEMAP all know the file:
```js
// content/rules.js
import { craftOp } from '../crafting.js';                 // the game's own code
export default {
  kinds: {
    recipes: {
      desc: 'crafting recipes (id -> { needs: { item: n }, makes: item })',
      // runs inside content.load, after the engine's data (items, NPCs, places)
      load: (e, data) => { for (const [id, r] of Object.entries(data)) e.ops.define('craft.' + id, craftOp(r)); },
      // optional, runs in threedog check; ctx.data = all content, ctx.err / ctx.warn report against content/recipes.js
      check(data, ctx) {
        for (const [id, r] of Object.entries(data)) if (!ctx.data.items?.[r.makes]) ctx.err(`recipe ${id} makes unknown item ${r.makes}`);
      },
      map: data => Object.entries(data).map(([id, r]) => `${id} -> ${r.makes}`),   // optional GAMEMAP lines
      // optional: the keys of each entry (core/base/params.js format, no default); threedog check reports unknown keys, wrong types, out of range
      fields: { needs: 'object', makes: 'string', seconds: { type: 'number', min: 0, optional: true, desc: 'crafting time' } },
    },
  },
};
```
```js
// content/recipes.js
export default { bread: { needs: { flour: 2 }, makes: 'bread' } };
```
Add `recipes` to `content/index.js` like any other file, and `rules` too: the loader knows a kind only from the `rules` it is handed (`threedog check`
says so when one is missing). `load` is optional: a game that imports the file itself leaves it out and still gets the check and the map entry.
A name `content/index.js` lists that is neither an engine file nor a registered kind is an error, and so is `content.load({ enemies })` without the kind:
both say how to register it. A kind may not reuse an engine file name. A file the index does not list is no content, so `threedog check` gives one warning.
A game's own data that the engine never reads, such as translated story text, belongs outside `content/`: a folder of its own that the game
imports itself, or `engine.i18n.add()` when it is text the UI fetches with `engine.t`. To have it checked and on the map, register a kind with no `load`.

**Field tables.** Every content entry has one: the engine's own, a template's `fields` (recipes/30-templates.md) or a kind's `fields` as above. `threedog check` validates every entry
against its table (a misspelled `scael` names `scale`), and `engine.content.fields(name)` returns the same table for tools such as an editor panel.

## 1b. Content packs: several data sets in one load
A pack with a `level` commits when its file is here. If a newer `level.load`, save load or unload comes first, the newest level stands and only the pack's `level` gives way: the rest goes in once that load has ended, on the level that won. A place only the pack's level had fails with `content-place`, as any unknown place does, and the pack goes back whole.

`content.load` answers for its own load. Bad data throws on the line. The Promise it returns resolves once the pack committed, and rejects when it failed, after the old level and registrations are back; saves and loads asked meanwhile wait for that. If the old level could not come back, `err.notRestored` lists why. A load nobody awaits is reported all the same.

```js fragment
try { await engine.content.load(dlc); }
catch (err) { showError(err.notRestored ? 'reload the game' : 'this pack is broken'); }
```

A content pack is the same object `content/index.js` exports (`{ items, templates, props, quests, ... }`, optional `name` for messages), shipped as a
folder or an npm package: data only, assets by name (never a path or a function; `npm run check` and a dev warning report both). Load several together:
```js fragment
import base from './content/index.js';
import forest from 'forest-content';                        // its props name templates from base and models from the forest asset pack
import packs from './assets.js';                            // export default [forestAssets, ...]: the asset packs ({ name, base, models, textures, sounds, fonts })
engine.assets.manifest(packs);                              // the same objects `npm run check` reads the names from
engine.content.load([base, forest], { places: { home } });
```
- Packs load in list order, so a pack may use what an earlier one defines. A pack's own `places` load with it; the `places` option goes on top (a place computed at startup).
- Within one call an id may live in one pack only: `items.apple` in two packs, or the same prop / pickup id, is an error naming both packs. A later,
  separate `load` call still overrides by name on purpose (hot reload, a chapter replacing a quest).
- A pack may carry its sounds: `audio: { sounds, ambience, music, footsteps }` (`recipes/31-audio.md` section 8). Sounds, footsteps and music tracks
  are ids like items (two packs, one name: an error); ambience and music rule lists concatenate.

## 2. actions.js: a game's own key actions
Format of `content/actions.js`: **action name -> { keys: default keys, label: display text }**. Actions that the engine brings along (move...) need
not be written; inventory, quests and photo only declare their action, and run, jump and interact
are not core keys either: they come from the game (`presets.bindings.*`, this file or `createEngine({ bindings })`).
```js
// content/actions.js
export default {
  kick: { keys: ['KeyF'], label: 'Push / kick' },
  save: { keys: ['KeyK'], label: 'Save' },
  load: { keys: ['KeyL'], label: 'Load' },
};
```
Don't forget to add it to the exports in `content/index.js` (`export default { ..., actions }`), otherwise `engine.content.load(data)` will not load
it (it calls `engine.input.action(name, { label, keys })`). What happens on press is written in main.js, read inside a fixed step so it lands on a tick:
`engine.onFixed(() => { if (engine.input.pressed('kick')) engine.ops.run('ball.kick', {}, { source: 'player' }); })` (a gameplay action is an op,
recipes/23-ops.md). A game that does not use content calls `engine.input.action('kick', { label: 'Push / kick', keys: ['KeyF'] })` directly.

**The engine does not perform the `save` / `load` actions for you**: they only register the keys; after the press you call the engine yourself in
main.js. Saving and loading are async (`Promise<boolean>`): await them, and say "saved" only on `true` (on `false` the engine already showed why).
Loading a slot to keep playing from it is `engine.session.load`, which leaves nothing of the current playthrough behind:
```js
import { toast } from 'threedog';
engine.onFixed(() => {   // read keys in the fixed step like every gameplay key; the async work runs after it
  if (engine.input.pressed('save')) engine.saves.save('slot1').then(ok => ok && toast(engine, 'Saved'));
  if (engine.input.pressed('load')) engine.session.load('slot1').then(ok => !ok && toast(engine, 'No save yet'));
});
engine.saves.autosave(3);     // autosave to 'auto' every 3 minutes of play (waits while paused, on the title screen and during newGame / load)
```

## 3. Interact keys: which object, and who acts
`interactions({ pick })` decides what the interact key uses (no default, `[interaction-setup]` names the fix). It takes no key: bind one in `createEngine({ bindings: presets.bindings.interact })`, or with `engine.input.bind`.
`radius` is measured from the object's origin, not its edge. For a large object (a boat, a house) raise it, or add the interaction to a small marker
object at the spot where it is used.

Pick the rule that fits the camera, not the genre default:
```js
engine.use(interactions({ ...presets.interactions.nearest }));                   // E, nearest within 2.5 m (top-down, third person)
engine.use(interactions({ pick: 'facing' }));  // only what the actor faces (within 60°): the door behind you stays dark
engine.use(interactions({ pick: 'aim', radius: 2 })); // closest to the screen-center ray: first person, shooters
engine.use(interactions({ pick: (list, ctx) => list.find(c => c.id.startsWith('npc')) ?? list[0] }));   // own rule; list = enabled ones in range, nearest first
engine.interactions.pickMode = 'aim';                // switch at runtime (entering a first-person mode)
```
One object with two verbs = two interactions with different key actions; each key picks among its own action, and `engine.interactions.options` lists
one `{ action, id, label }` per key for a prompt that shows both:
```js fragment
engine.input.action('take', { label: 'Take', keys: ['KeyF'] });
engine.interactions.add(thing, { label: 'Inspect', onUse: inspect });                                // E
engine.interactions.add(thing, { label: 'Take', action: 'take', enabled: () => ready, onUse: take });   // F
```
**Hold and walk-over.** `hold: seconds` makes the key a hold (pump a well, defuse, pick a lock): the engine counts it on fixed steps, interrupts it
when the key is released, the actor leaves the radius, `enabled()` turns false or input locks (`interaction:hold` / `interaction:interrupt
{ reason }`), and the prompt part gets `progress` 0-1 (the default prompt fills its background). `engine.interactions.holding` is the one in progress.
`approach: true` walks the player there first (`walkTo`, stops 1.2 m away) and uses it on arrival; with `radius: Infinity` it is usable from anywhere
(point-and-click, "talk to the clerk across the shop"). The op `interaction.use` is the completed use in both cases (tests and the dev bridge
skip the hold; an approach returns `{ approaching }`, a promise of onUse's result).
```js fragment
engine.interactions.add(well, { label: 'Pump', hold: 1.5, onUse: fill });
engine.interactions.add(shell, { id: 'shell-1', label: 'Pick up', once: true, counter: 'shells' });   // mesh gone after E, counted: recipe 03 "Pick and count"
engine.interactions.add(clerk, { label: 'Talk', radius: Infinity, approach: true, onUse: talk });
```
**Who acts** is `engine.actor` (a world record id, default `'player'`). Interactions, trigger zones, objective-marker distances, the world simulation
center and the default `ctx.actor` of ops all measure from `engine.actorPosition()`. To let the user drive a boat or switch squad members, set
`engine.actor = 'boat_1'` and back to `'player'`; nothing else changes. Module code reads `engine.actorPosition()`, never `engine.player.position`
(rule R17 warns).
The actor is handed down, never assumed: `label / enabled / onUse` get `(object, { actor })` (the actor of `interaction.use`: the local user, a net
peer, an NPC); trigger callbacks get `(t, who, id)` and the events carry `id` (`who` may list actor ids: `who: () => [e.actor, ...peerIds]`); content
`has / lacks / give / take` use the bag of the running op's actor (else `engine.actor`), and `engine.content.run(effect, { actor })` /
`content.test(cond, { actor })` name one explicitly; trigger `onEnter / onExit` effects act for whoever crossed the zone.
```js fragment
engine.interactions.add(door, { label: (o, { actor }) => keyOf(actor) ? 'Open' : 'Locked', onUse: (o, { actor }) => engine.ops.run('door.open', { id: o.name }, { actor }) });
engine.triggers.add({ position: gate, who: () => [engine.actor, ...guards], onEnter: (t, who, id) => engine.ops.run('gate.alarm', { by: id }) });
```

## 4. Continue and new game (the engine does not load automatically on start)
After a page refresh the game is a new run; to "continue last time", load **after** `await engine.start()` through `engine.session`, the standard form:
```js
await engine.start();                                           // modules and the save index are ready, so saves.list / check are synchronous
if (engine.saves.check('auto') === null) await engine.session.load('auto');   // continue from the autosave if it can be loaded
```
- `engine.session.load(slot)` and `engine.session.newGame()` both return `Promise<boolean>`: always `await`. `session.load` starts from the new-game
  state and puts the save on top, so a part the save lacks (a module added in a later version) starts fresh instead of keeping the current run's
  state. `engine.saves.load(slot)` is a quick load onto the running playthrough; never build Continue from it.
- A running cutscene and an open conversation are not saved: any load ends them without their remaining steps. Save at a point the game can continue from: a save taken inside a
  cutscene whose last step sets the flag a quest waits for comes back without that flag.
- Loading restores the player, the view (the camera rig's yaw and pitch: a first-person game needs no save code for it), world data (world changes and deletions), inventory, quests, clock and random state; initial data in content files
  (`initial`) is the same whether it is loaded before or after the save, so ignore the order.
- A load rebuilds the props and other world records: an Object3D your code kept from before (a door mesh, a lamp) is gone afterwards. Keep the
  record id, not the mesh, and look it up again on `save:loaded`: `engine.world.get(id)` for the record, `engine.world.view(id)` for its model
  now (null while not built or far away).
- For a "main menu: Continue / New game": show "Continue" only when `engine.saves.check(slot) === null`; on click `await engine.session.load(slot)`;
  "New game" is `await engine.session.newGame()`.
- During development, to jump straight into a save: URL `?save=slot1` (`threedog state` also understands `save=`).
- In tests, `engine.saves.save('x'); await engine.saves.flush();` writes before reading back.

## 4b. Best times and high scores: data that outlives saves
Best lap times, a leaderboard or high scores belong to the player, not to one playthrough: in a save part a new game would wipe them. Persist them beside the saves, in `localStorage` under `engine.saves.storageKey(name)`, a key that shares the game's name and stays out of the save slots:
```js
const key = engine.saves.storageKey('records');
const records = () => JSON.parse(localStorage.getItem(key) ?? '{ "laps": [] }');
const addLap = time => { const r = records(); r.laps.push(time); localStorage.setItem(key, JSON.stringify(r)); };
```

## Save failures and versions
- `await engine.saves.save(slot)` is `true` only after the write is on disk; show "saved" only then. On a failed write (storage full, IndexedDB /
  localStorage refused) it is `false`, the player already saw why, and the previous save of that slot is kept (memory follows the disk).
- A corrupt save, a part from a newer build or a missing migrate step is refused before anything changes: `load` returns `false` with a message, the
  running game and the stored save stay as they were. Ask first with `engine.saves.check(slot)` → `null | 'missing' | 'corrupt' | 'tooNew' | 'migrate'`.
- A part whose `save()` throws makes the whole save fail (`false`, the slot keeps its previous save); a part whose `load()` throws rolls the game back
  to how it was before the load (`false`). So does a listener of an event the load emits (`world:load`) or a module's `afterLoad` that throws. Both go
  through the error tiers (`engine.error` in dev, code `save-part-threw` / `save-load-threw`).
- One replacement at a time: `saves.apply`, `saves.load` and `session.newGame` / `load` / `quit` wait their turn in the order asked, so the end state is
  always one whole save, and a load that fails rolls back to the whole state before it. Idle, a save with only synchronous parts applies at once. While
  a replacement runs ops return `'loading'`.
- A `load()` or `afterLoad` may change level or load a pack, before or after an await. It is handed the turn of its replacement; pass it on, and the call goes at once:
  `async load(d, turn) { await fetchRoute(d); await engine.level.load(d.level, { turn }); }`. Without the turn the call counts as an outside request and waits for this load to end, so awaiting
  it would wait for itself (dev says so after 3 s, `save-nested`). A new `saves.apply` / `load` / `save` or `session.*` starts after the running one: ask for it without awaiting it, or from a
  `save:loaded` or `session:start` listener.
- A part registered while a load runs gets its data right after that load, whole, unless a newer load replaced the state first; idle it gets it before `register` returns.
- A save edited by hand or damaged: a `null` part makes it `'corrupt'` (a `save()` returning `null` is simply left out); a world record whose
  position is not three finite numbers is refused and rolled back (`save-bad-record`, no gameplay error); a bad number of the clock, time
  channels, random state or item counts is clamped or dropped with one `save-value` warning per part, and the rest loads.
- Two tabs of one game: a tab overwrites a slot only while it holds the copy it last read, wrote or loaded. A save over a newer one another tab
  wrote returns `false` (toast, `save-stale`); that tab then lists the newer save, and loading it lets it save there again.
- `engine.saves.versions` lists the version of every part this build reads (`{ world: 5, clock: 1, ... }`); raise a part's `version` with a `migrate`
  step when its data changes shape.
- Import is offline and checked: `saves.import(text)` and `saves.importFile(file)` refuse anything that is not a save, and attachments must be `data:` URLs (nothing is fetched).

## Save format
A save is one envelope; `engine.saves.collect()` returns it and `export` / `exportFile` carry it unchanged:
```js fragment
{ format: 1,                       // the envelope's own version: a save with a higher format is refused as tooNew (none = 1)
  savedAt: 1730000000000,           // real time of the save
  versions: { world: 5, quests: 2, clock: 1 },   // each part's version (none = 1)
  parts: { world: {...}, quests: {...}, clock: {...}, vars: {...} } }   // each saves.register part's data, by key
```
- **Parts and versions**: each `engine.saves.register(key, { version, migrate, save, load })` owns one part. `load` takes one argument, the data: `load: data => …`, never `load(engine, data)`, the shape of a module hook (`npm run check` warns, rule R33). When `save()` changes shape, raise
  `version` by 1 and add `migrate[oldVersion] = data => newData`; load runs the steps in order on a copy, so `load` only sees the current shape.
  This is how a game's own saved data migrates across its releases (there is no other system): keep one saved file per released game version, never edit it, and load each in a test with `engine.saves.apply(sample)` (the engine does the same for its own parts in `tests/specs/save-compat.mjs`).
- **Parts nobody owns are kept**: a part in the loaded save whose module is not installed in this run (a feature turned off for a version) is written
  back unchanged on every save, and handed to the module if it registers later. Only a new game drops it.
- **Authored baseline + per-id diff**: everything placed in a level comes from content (props, template instances, pickups, NPCs, grid items in
  `props`, level-model nodes tagged `template` / `id`) with a stable id, and the world part stores only what play changed on top of it, keyed by id:
  `changed` (fields of an authored record that differ), `removed` (authored records removed), `records` (records created during play, such as
  `engine.content.spawn`, drops and built walls, saved whole), `owed` (seconds owed, only for kinds simulated with `far`). The same content gives the same
  world, and a new game's world part is empty: in dev, start warns about records that code created or changed before it, naming them.
- **Orphans are kept**: a saved change whose id the content no longer defines (an entry renamed or deleted) stays in the save and is written back, never dropped, so reverting the content change gets the data back. Dev warns once with the closest id and the `content/renames.js` pair that would move it; `describe().world.orphans` lists them. A rename in `content/renames.js` moves the state to the new id (recipe 30, "Writing the ids, renaming them"). <!-- r18-ignore-line -->
- **Runtime ids**: records made during play are `<kind>#<n>`, so a runtime id never equals an authored one. A migrate step that needs another part gets the whole save as its second argument: `migrate: { 1: (data, save) => … }`. <!-- r18-ignore-line -->
- **Grid layers diff too**: cells authored in `content/grids.js` (`plot: { …, layers: { soil: [[i, j, { tilled: true }]] } }`) are the baseline; the `grids` part stores only changed cells (`set`) and emptied authored ones (`clear`), and keeps a diff for a grid the run does not have. <!-- r18-ignore-line -->
- **Stable ids, never positions**: saved data names things by stable ids. The player's vehicle is saved by `rigid.addWheeled(mesh, { id })`; quest
  progress by step ids (`steps: [{ id: 'talk-mayor', ... }]`, recipe 04). Content edits (a new step, a new prop) then never shift an old save.
- The export file wraps the envelope:
  `{ threedog: 'save', format: 1, game, slot, savedAt, data: <envelope>, files: [{ group, id, at, meta, type, url: 'data:...' }] }`.
- Tests: `threedog test "Save failure"`.

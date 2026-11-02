# Shared quantities, time channels and wrapping module methods

One line each first:

```js
engine.mod('time.enemies', { owner: 'bullet-time', mul: 0.35, for: 2 });          // bullet time on the enemies channel only
engine.mod('time.player', { owner: 'haste', mul: 1.2, for: 5 });                   // haste on the player
const menu = engine.freeze('pause-menu');  /* ... */  menu.remove();   // pause menu: the picture, UI and ambient uTime (wind, water, clouds) keep running; { ambient: true } stops those too
engine.input.gate('jump', { owner: 'stun', for: 1.5 });                            // no jumping while stunned
engine.wrap(engine.inventory, 'add', (next, id, n = 1, o) =>                      // a weight rule on top of the engine's inventory
  carried() + weightOf(id) * n > 30 ? false : next(id, n, o), { owner: 'weight' });
```

Every handle ends with `h.remove()` (`engine.mod`, `input.gate`, `wrap`, `freeze`, `takeCamera`); it drops only your own entry.

Which of these to reach for (and when plain options or plain three.js are enough): `../CONVENTIONS.md` "Customization ladder". This page is the detail.

## Stacks: `engine.mod(name, { owner, set | add | mul | clamp, for?, id?, priority? })`

- One entry per owner; the same owner again updates its entry. Only the owner ends it: `handle.remove()`, or `for` seconds pass.
- Nothing remembers an old value: every read recomputes from the base and the entries still there, so effects end in any order without fighting
  (bullet time + haste + a stopwatch + the pause menu, switched on and off in any order, give the same result).
- Layers by `priority` (`game` default, `effect`, `system`, `debug`); inside a layer `set`, then `add`, then `mul`, then `clamp`.
- Base values are yours: `player.speed = 6` is always fine; modifiers go through `engine.mod('move.speed', { owner, id: 'player', mul })`.
- Your own quantity: `engine.stacks.define('damageTaken', { base: 1, per: true })`, then `engine.stacks.get('damageTaken').value(enemyId)`.

## Time channels

- `engine.onFixed(dt => moveEnemies(dt), { channel: 'enemies' })`: dt is that channel's scaled dt. Without `channel` dt is real (1/60): cooldowns
  and UI timers are not slowed by bullet time by accident.
- `engine.characters.createPlayer` drives the player on channel `'player'`; `new Character(engine, { channel })` picks one for other characters.
- `engine.world.simulate('slime', { near, far, channel: 'enemies' })`: near and far dt follow the channel too (NPCs: their own channel).
- `engine.clock.rate` is the calendar speed (fast-forward a day), separate from the channels.
- Passing time is `engine.skip({ seconds })` (timers fire in order, far NPCs and the calendar catch up). Writing `engine.clock.now` directly is kept but
  warned once: it jumps past timers.
- `character.velocity` / `character.vy` are not stacks: a write is an impulse the mover integrates from (no owner, nothing to hand back). Lasting
  knockback is `character.push(vx, vz, seconds)`; full takeover is `character.mover = 'manual'`.

## Fixed-step order: `onFixed(fn, { phase })`

`'early'` (default) runs before every module (the player has not moved yet this step); `'late'` runs after all modules and before the clock (hit
checks that need this step's player position). The order never depends on which line registered first.

## Wrapping a module method: `engine.wrap(target, method, (next, ...args) => ...)`

- Before: do something, then `return next(...args)`. After: `const r = next(...args); ...; return r`. Around: change the args, or skip `next`.
- Several wrappers compose: the last one wrapped runs first. `handle.remove()` takes one out; the method is restored when the last goes.
- Every caller of that method goes through it (the game, the module's own ops, other modules). It wraps one method: a rule for every way items
  enter the bag wraps `add` and `transfer`.
- Only public methods (the module's `contract.js` `api` list); `_private` names throw. `describe().wraps` lists `{ 'inventory.add': [owners] }`.

## Replacing a module

Each replaceable module has a contract (`modules/gameplay/inventory.contract.js`, `interactions.contract.js`, `dialogue.contract.js`, `quests.contract.js`, `modules/flow/contract.js`,
`modules/characters/contract.js`, `modules/calendar/contract.js`, `modules/camera/contract.js`; object contract `modules/characters/vehicle.contract.js`): the api, fields, ops, events
and save keys other code relies on, and nothing more (the engine's callers use only that surface). `runContract(contract, () => myInventory(), { check })`
from `@threedog/tools/contract` checks a replacement (in a game installed from npm too); `tests/contract/fakeInventory.js` in the engine's
repository (not shipped) is a whole replacement in ~40 lines; `fakeDialogue.js`, `fakeQuests.js`, `fakeCamera.js` and `fakeVehicle.js`
are the same for their contracts, and the engine's NPCs, timeline, content loader, hud and characters run on them (test `tests/specs/ui-nav.mjs`).
A camera module's `prepare` hook: `runContract(contract, () => myCamera(), { check, prepare: e => { e.camera = ... } })` adds what it needs to the
small engine. A vehicle is checked as an object: `runContract(vehicleContract, () => myBoat, { check })`.

## Who holds what

`describe().holds`: pause / freeze / camera / debugView, `input` (pushed contexts with owners), `gates`, `stacks` (every other mod with entries).

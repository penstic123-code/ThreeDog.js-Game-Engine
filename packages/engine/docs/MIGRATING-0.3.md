# Moving a game from 0.2 to 0.3

This is the one place for upgrade steps. [CHANGELOG.md](../CHANGELOG.md) lists every change; this page lists what an existing 0.2 game will
run into, the most common first. Each item is: what you see (the error code in square brackets at the end of the message, or the silent
symptom) → what to write instead.

How to work through it:

1. Run the game in dev (`threedog dev`) and `threedog check -w <game>`. Most removed names fail loudly: an engine error ends with its code,
   e.g. `... [module-params]`, and the message names the new form. A removed method is a plain `TypeError: ... is not a function`.
2. Then search the game's source for the **silent** items below (marked *silent*): they no longer throw, they just stop doing anything.
3. Old saves load: see [Saves](#saves) at the end.

## 1. Unknown or removed options throw in dev `[module-params]`

More option bags now go through one schema (`readParams`): `createEngine()`, `openWorld()`, every module factory, `npcs.add`,
`createPlayer`, `triggers.add`, `rigid.addWheeled`, `audio.addBus` and more. An option the engine does not know (a typo or an option
removed in 0.3) throws in a dev build with a did-you-mean list, and warns once in a release build (the option is then ignored).

```js
// symptom: "createPlayer(): unknown option 'canSwim' ... [module-params]"
// fix: look the option up in this page (most removed options are below) or in docs/api/<module>.md; engine.catalog() lists every option
```

An options object passed as a number, string or array (the old positional style) is refused the same way.

## 2. Time of day, days and seasons moved to `calendar()` `[sky-option]` `[renamed-field]`

`sky()` now only draws a time; the clock of the world (time of day, day count, seasons, clock-time timers, their save) is the new
`calendar()` module, `engine.calendar`. `openWorld()` installs it for you; a game that lists modules itself must add it.

```js
// 0.2
engine.use(sky({ time: '07:00', dayLength: 600, seasons: ['wet', 'dry'] }));
engine.sky.at('18:00', lightLamps);
engine.sky.timeOfDay = 0.5;
// 0.3
engine.use(calendar({ time: '07:00', dayLength: 600, seasons: ['wet', 'dry'] }), sky());
engine.calendar.at('18:00', lightLamps);
engine.calendar.timeOfDay = 0.5;
// openWorld: the shorthands time / dayLength still work; the object form is now calendar: { ... } (was sky: { ... })
```

- `sky({ dayLength | day | daysPerSeason | seasons | hoursPerDay })` throws `[sky-option]` and names `calendar()`.
- Reading or writing a calendar member on the sky (`engine.sky.timeOfDay / day / season / seasons / daysPerSeason / dayOfSeason /
  totalDays / at / daily / ...`) throws `[renamed-field]` in dev naming `engine.calendar.<same>`. `sky.isDay / daylight` stay: the drawn sun.
- `sky({ time })` without a calendar is a fixed drawn time (a game with no day cycle, a single mood). With `calendar()` installed it throws
  `[sky-option]`: give the time to `calendar({ time })`.
- `applyState({ season })` needs `calendar()` `[sky-option]`.
- Types: `SkyAtOptions` / `SkyBetweenOptions` → `CalendarAtOptions` / `CalendarBetweenOptions`. `counts().sky.timers` → `counts().calendar.timers`.
- Old saves: the calendar takes its data from the old `sky` part automatically ([Saves](#saves)).

## 3. Pickups are their own module

Items lying on the ground (coins, ammo, loot drops, keys) moved out of `inventory()` into `pickups()`.

```js
// 0.2
engine.use(inventory({ pickupRadius: 1.5, bobDistance: 30 }));
engine.inventory.spawnPickup('coin', [4, 0, 2], { count: 5 });
engine.events.on('item:pickup', e => score(e));
// 0.3
engine.use(inventory(), pickups({ radius: 1.5, showDistance: 30 }));
engine.pickups.spawn([4, 0, 2], { give: 'coin', count: 5 });
engine.events.on('pickup:take', e => score(e));   // { pickup, item, count, actor, x, z }
```

- `inventory({ pickupRadius, bobDistance })` → `[module-params]`; `inventory.spawnPickup / nearestPickup` → `TypeError`
  (use `pickups.spawn(position, { give })`, `pickups.nearest(item)`).
- `give` is required. *silent:* a pickup handle's `id` is now its world record id (it used to be the item id); `worldId` is gone.
- Content `pickups` without `pickups()` installed throws `[module-needs]`.
- `style.pickup.model` throws `[renamed-field]` in dev (style.pickup holds `color / size / lift` only). The shape is an asset model by name: the item's `model`, else an asset named
  `pickup:<item>`, else one named `pickup` (put them in the game's `assets.js`).
- Events `container:add` / `container:remove` are gone: `item:add` / `item:remove` now fire for every container and carry `container` and
  `actor`. *silent:* a listener that assumed "the player's bag" must filter on `e.container` (or use `inventory.of(actor)`).

## 4. NPC dialogue goes through `interact`

```js
// 0.2
engine.npcs.add({ id: 'smith', talk: 'smith', talkLabel: 'Talk', talkRadius: 2 });
// 0.3
engine.npcs.add({ id: 'smith', interact: { op: 'npc.talk', label: 'Talk', radius: 2 } });   // args: { script } names another script
```

`talk / talkLabel / talkRadius` → `[module-params]` (content files: a `content-check` error). *silent:* `npc.talk` reads `undefined`.
Saved NPCs with the old fields are converted on load. An NPC no longer needs a `schedule`; `start` alone places it.

## 5. Time scale, pause and freeze: one handle each

```js
// 0.2
engine.clock.timeScale = 60;
engine.pause('menu'); /* ... */ engine.resume('menu');
engine.freeze('title'); /* ... */ engine.unfreeze('title');
// 0.3
const fast = engine.mod('clock.rate', { owner: 'fast-forward', set: 60 }); /* ... */ fast.remove();
const p = engine.pause('menu'); /* ... */ p.remove();
const f = engine.freeze('title'); /* ... */ f.remove();
```

- Reading or writing `engine.clock.timeScale` throws `[renamed-field]` in dev, writing `engine.clock.rate` throws `[mod-owner]`; both name `engine.mod('clock.rate', { owner, set })`.
- `engine.resume / unfreeze` → `TypeError`; chaining on the return of `pause` / `freeze` is gone (they return `{ owner, remove() }`).
- Every handle ends with `remove()` (`pause`, `freeze`, the new `engine.mod` and `input.gate`, `audio.addBus`, `defineState`...). `defineState()` returns a handle now,
  so `engine.defineState(a).defineState(b)` is a `TypeError`.
- `engine.runState.by` → `engine.runState.owners` (in dev reading `by` throws `[renamed-field]`).
- `freeze()` keeps `uTime` (wind, water, clouds) moving; `freeze(owner, { ambient: true })` stops it too.

## 6. Lights and sky overrides live in `engine.look` and `engine.lights`

```js
// 0.2
engine.sky.sun.intensity = 2;
engine.sky.modify('storm', { fog: { far: 60 } });
engine.use(sky({ sun: 'manual' }));
// 0.3
engine.lights.sun.intensity = 2;               // a direct write is kept: the engine yields that value to the game
engine.look.fog.set({ far: 60 });              // or a temporary layer: engine.mod on the sky multipliers (recipe 55)
engine.look.lights.manual('sun');              // the game drives the sun itself; also look.fog.manual(), look.lights.manual('hemi')
```

- *silent:* `engine.sky.sun / hemi` read `undefined` → `engine.lights.sun / hemi`.
- `engine.sky.modify` → `TypeError` (use `engine.look.<part>.set / patch` or `engine.mod`). `sky({ sun | hemisphere | fog: 'manual' })` →
  `[sky-option]`.
- `look.tone` has no `mapping`: the engine writes `renderer.toneMapping` once at creation; change it with plain three.js
  (`engine.renderer.toneMapping = THREE.AgXToneMapping`). `look.tone.set({ exposure })` is unchanged.
- `setFogFar` no longer writes `scene.fog`; games set fog distance with `engine.look.fog.set({ far })`.

## 7. Shader code in a style moved to look hooks

| 0.2 style key | throws | 0.3 |
|---|---|---|
| `style.sky.fog.glsl` | `[sky-option]` | `engine.look.fog.patch('fog', glsl)` |
| `style.sky.clouds.glsl / uniforms` | `[sky-option]` | `engine.look.sky.patch('clouds', { glsl, uniforms })` |
| `style.wind.glsl / uniforms` | `[look-param]` | `engine.look.wind.patch('sway', { glsl, uniforms })` |
| `style.water.glsl`, `water({ glsl })` | `[water-option]` / `[module-params]` | `engine.look.water.patch('wave' \| 'surface', glsl)` |

*silent:* style functions (sky `backdrop`, fog `color`, tone `exposure`) now receive a context object `{ time, weather, season, state, sky }`
instead of the sky: `sky => sky.isDay ? a : b` becomes `({ sky }) => sky.isDay ? a : b`.

Shader patches use named slots (`{ slot, pars, glsl }`, recipe 43); the raw-anchor form still works.

## 8. Sounds made in code are assets

```js
// 0.2
engine.audio.register('ding', (a, p, out) => { a.tone({ freq: 880, dur: 0.2, out }); return 0.2; });
engine.audio.addBus('voice', 0.8);
// 0.3 (assets.js or engine.assets.manifest)
export default [{ sounds: { ding: (a, p, out) => { a.tone({ freq: 880, dur: 0.2, out }); return 0.2; } } }];
engine.audio.addBus('voice', { level: 0.8 });   // returns a handle; adding an existing bus throws [engine-misuse]
```

`audio.register` → `TypeError`. An `audio.sounds` rule written as `'synth'` or `{ synth }` → `[audio-synth-gone]`; refer to the sound by its
asset name. A number as the second `addBus` argument → `[module-params]`.

## 9. Asset manifest: model `params` is a schema

```js
// 0.2
models: { crate: { build: makeCrate, params: { h: 3 } } }
// 0.3
models: { crate: { build: makeCrate, params: { h: { type: 'number', default: 3 } } } }   // shown and editable in the dev panel / gallery
```

A plain value throws `[engine-misuse]` ("has type 'undefined'") at `manifest()`. `assets.manifest` also takes an array of packs.
Content-check now reads model names from the game's `assets.js`; without one, content that names a model is an error.

## 10. Characters, vehicles, plants, water

- `canSwim: true / false` → `water: 'swim' | 'block' | 'wade' | fn` (`createPlayer`, `npcs.add`, `Character`) `[module-params]`.
- *silent:* the speed argument of `character.move(x, z, run, dt, speed)` and `moveInput { speed }` are ignored. A temporary speed change is a
  modifier: `engine.mod('move.speed', { owner: 'haste', id: 'player', mul: 1.2, for: 5 })` (also for jump, gravity... recipe 55).
- `jump()` is buffered (a press just before landing jumps on touchdown, `jumpBuffer` option) and returns the character.
- `rigid.addVehicle` → `rigid.addWheeled` (`TypeError`); `seat: v` → `seats: [v, ...]` `[module-params]`; `seatPosition / exitPosition`
  take a seat index. `vehicle:enter / exit` carry a `Rideable` (anything can be ridden: horses, boats, carts).
- `vegetation.add` → `vegetation.define` (`TypeError`); it returns a Promise when `model` / `lodGeometry` is an asset name.

## 11. Smaller renames a 0.2 game may use

| 0.2 | 0.3 | symptom |
|---|---|---|
| `import { entities }`, `engine.entities`, `entity:*` events | content templates with `stages` (`template:stage` event) | import fails at load |
| `engine.spawn(name, at, fields)` | `engine.content.spawn(name, at, fields)` | `TypeError` |
| `quests.state[id]` | `quests.state(id)` (a copy) | *silent* `undefined` |
| `dialogue.say / start({ lock: false })` | `{ channel: 'bubble', at }` | dev: `[renamed-field]` (any other unknown option: `[module-params]`) |
| `triggers({ debug })`, `triggers.add({ debug })`, `triggers.setDebug()` | `engine.debug.view('triggers')` | `[module-params]` / `TypeError` |
| `trade()`, `grid.check / preview / place`, op result `.reason` | `.code` (plus `facts`, `nextActions`) | dev: `[renamed-field]` |
| `describe().ui.inputContexts` | `describe().holds.input` | dev: `[renamed-field]` |

Interaction callbacks (`label`, `enabled`, `onUse`) get a second argument `{ actor }`; trigger callbacks get the triggering `id`. One-argument
callbacks keep working. Content item words (`has`, `give`, `take`) act on the bag of the op's actor, which is the player in a single-player game.

## 12. The 0.2 rename stubs are gone

0.2 kept throwing stubs `[renamed-api]` for 0.1 names. They are removed; the old names are now a `TypeError` or `undefined`:

| 0.1 name | current form |
|---|---|
| `engine.setExposure(v)` | `engine.look.tone.set({ exposure: v })` |
| `engine.setToneMapping(kind)` | `engine.renderer.toneMapping = ...` (plain three.js) |
| `engine.sky.setEnvironment(o)` | `engine.look.env.replace('sky')`, then `engine.look.env.set({ intensity, rotation })` |
| `engine.sky.setShadow(o)` | `engine.look.shadow.set(o)` |
| `engine.weather.define(field, spec)` | `engine.look.weather.replace({ [field]: spec })` |
| `engine.post.add / enable / get(name).set` | `engine.look.post.add(effect, { owner })`, `engine.look.post.set({ 'bloom.enabled': on })` |
| `engine.look.clouds` | `engine.look.cloudShadow` |
| `engine.cameraOverride = {...}` | `const cam = engine.takeCamera('owner', { focus }); cam.remove()` |
| `views.define(name, { pos })` | `{ position: [x, y, z] }` |
| `style.character.*` | a body asset: `createPlayer({ model: 'yourBody' })`; colors from the material roles |
| `result.reason` (ops) | `result.code` |

## 13. Things that look different without any code change

These are new defaults, not errors. Check the game's look after upgrading (`threedog shot`, which now prints the look numbers after every shot)
and set the value back with `engine.look` if the game had tuned around the old behavior.

- The neutral room environment under a sky shares the style's ambient column with the hemisphere light (`look.lights` `env.share` = its
  share, 0..1) instead of adding a fill on top. `env.intensity` stays the absolute `scene.environmentIntensity`, also under a sky (written as
  given: fixed, not following the day): shadows by day and nights on PBR materials are darker; raise the ambient column if a pack relied on
  the extra fill. A direct write to `scene.environment` / `environmentIntensity` is kept.
- Sun shadow bias is a few centimeters in world terms (it was large enough to cut the contact shadow of things standing on the ground).
  A game that saw shadow acne before and raised the bias should re-check; set it with `engine.look.shadow.set({ ... })`.
- The neutral sky keyframes keep night longer around midnight.
- On the low device tier a costly post effect the game added (e.g. AO) can be turned off with `look.post.set({ 'ao.enabled': false })`
  (that call did nothing before).
- Photo mode's bloom follows the game's post chain instead of being forced on.
- Automatic batching only merges content the engine placed. A game mesh placed many times opts in with `userData.batch = true`.
- `uTime` keeps moving while gameplay is frozen (menus, dialogue pauses).
- i18n: `'zh'` / `'zh-Hans'` resolve to `'zh-CN'`, `'en-US'` to `'en'`; an unknown locale warns once. `input.simulate` throws on an unknown action.

## 14. Tools

- `threedog new-style` and `--style` on `new-game` / `init` are removed: a game's look lives in its own `style/` folder.
- `threedog new-game` starts blank (a scene and a camera); `--open-world` gives the old terrain + sky + player start.
- `threedog content set <id> <field> <json>` (positional) → `threedog content set <id> field=value`; `content add` / `content remove` are new.
- New: `threedog stress`, `threedog tune`, `threedog gallery`, `threedog art list / copy`, `--gpu` / `--software` on shot / perf.
- `content-check` validates props, templates, pickups and kinds against their declared `fields`; old NPC `talk` fields and `'synth'` sound rules
  are errors.

## Saves

- A 0.2 save loads in 0.3. The save envelope format did not change; parts that changed shape migrate on load.
- The calendar part reads the old `sky` part on its own (`saves.register` gained `movedFrom: { oldPart: data => newData }` for exactly this; a
  game module split in two can use it the same way).
- Saved NPCs with `talk` fields are converted to `interact`.
- A save with a `null` part is now refused as corrupt (`saves.check(slot) === 'corrupt'`) instead of loading as an empty world.
- A load that throws anywhere (a part, a `world:load` listener, a module's `afterLoad`) rolls the whole game back.
- The `world` part is version 5 now (0.2 wrote 3; the steps run on load). A 0.2 build refuses a 0.3 save (`'tooNew'`) instead of misreading it.

# Ops: one entry point for what players and NPCs do (engine.ops)

**In this recipe**: 1. Define and run · 2. Who calls it, and when · 3. Built-in ops · 4. Read the log · 5. The guard · 6. Testing ·
7. Scenario tests · 8. Inspect and explain · 9. Randomness · 10. Property tests · 11. Structured failures, nextFixed, and who paused ·
12. Failing in run, atomic ops, revision

**What is an op**: one discrete thing an actor decides to do: buy, talk, attack, roll, fire, reload, craft, build, demolish. Write one with
`engine.ops.define`; every caller (key press, UI button, dialogue choice, dev bridge, test, later replay and network peers) runs it with `engine.ops.run`.
**What is not an op**: continuous input (stick, look, aim while moving) and simulation (hunger, crop growth, burning, bullets in flight). Those stay
in a module's `fixed` or `world.simulate`. Low-level functions such as `inventory.transfer` and `world.set` are not wrapped either: an op's `run` calls them.

## 1. Define and run
```js
const PRICE = { bread: 5 };
engine.ops.define('shop.buy', {
  desc: 'Buy from a shop shelf',
  args: { shop: 'string', item: 'string', n: 'int?' },   // types: string number int bool position id any; ? = optional
  can(e, { shop, item, n = 1 }, ctx) {                    // read-only: return true or a reason string
    if (!e.inventory.container(shop).has(item, n)) return 'soldOut';
    if (e.inventory.container(ctx.actor).count('gold') < PRICE[item] * n) return 'noMoney';
    return true;
  },
  run(e, { shop, item, n = 1 }, ctx) {                    // runs only after can passed
    const got = e.inventory.transfer(shop, ctx.actor, item, n);
    e.inventory.container(ctx.actor).remove('gold', PRICE[item] * got);
    return got;                                           // plain data; becomes r.value
  },
  offers: (e, ctx) => [{ shop: 'shop-bakery', item: 'bread' }],   // optional: arg sets possible now (ops list / dev bridge `ops`)
  reasons: { soldOut: 'Shelf is empty', noMoney: 'Not enough gold' },   // optional developer notes
  // optional: undo(e, args, value, ctx) reverses a finished run; engine.ops.undo('shop.buy', args, r.value) calls it ({ ok: false, code: 'noUndo', facts: { op } } without one)
});

const r = engine.ops.run('shop.buy', { shop: 'shop-bakery', item: 'bread' });
// r = { ok: true, value: 1 } or { ok: false, code: 'noMoney', facts, nextActions }
const { ok } = engine.ops.can('shop.buy', { shop: 'shop-bakery', item: 'bread' });   // ask only: grey out a button
```
Rules that keep ops replayable and network-ready:
- **Use `ctx.actor`, never `engine.player`.** `ctx.actor` is the world record id of whoever acts (default `engine.actor`, which is `'player'` — also
  the player's container id — unless the game hands control to a vehicle or squad member). NPCs run the same op with `{ actor: 'npc_3' }`; where an
  actor stands is `engine.actorPosition(ctx.actor)`.
- **Args are plain data and self-contained**: no three.js objects (pass `[x, y, z]`), and anything not in world data (aim direction, a clicked build
  position) goes in the args. Pass a fresh object each call; in dev the args are frozen because the history keeps them.
- **All "may I" checks live in `can`**, so `run` never stops halfway. A failure always has a reason (camelCase English). Show it to the player through
  i18n (`e.t('op.shop.buy.' + r.code)`); the engine shows nothing itself.
- An op may call another op inside `run` (logged with `depth`); `can` must not call `run` or change state.
- Name ops `noun.verb`. A dot means "asking to do"; events (`noun:action`) mean "already happened". `run` emits your own domain events itself.

## 2. Who calls it, and when
| Caller | How | History `phase` / `source` |
|---|---|---|
| A key in a module's `fixed` (attack, roll, fire) | `e.ops.run('combat.roll', { dir }, { source: 'player' })` | `fixed` / `player` |
| A UI button or click | `engine.ops.run('shop.buy', args)` | `between` / `player` |
| Dialogue choices, triggers, quest rewards in content | `do: { op: ['shop.buy', { shop: 'shop-bakery', item: 'bread' }] }`, `if: { can: ['shop.buy', {...}] }` | inherits the caller |
| Dev bridge | `threedog op shop.buy shop=shop-bakery item=bread` / `threedog ops` | `between` / `bridge` |
| Enemy AI in `world.simulate` | `e.ops.run('combat.attack', { kind: 'light' }, { actor: rec.id })` | `fixed` / `game` |

`run` is synchronous and returns at once. Between fixed steps it counts as "after step N", which replays the same. Ops still run while gameplay is
frozen by a menu (`ctx.frozen` is true; return `'paused'` from `can` for things that must wait); after a gameplay error (`engine.error`) every op
returns `'halted'`.

## 3. Built-in ops (installed with their modules)
| Op | Args | Reasons |
|---|---|---|
| `interaction.use` | `{ id?, action? }` (interaction id from `interactions.add(target, { id })`, default the world record id it was built for; omit it to use the one the actor would pick now by `interactions({ pick })`, optionally only among one key action) | `unknown` `nothingNear` `disabled` `tooFar` `inputLocked` |
| `dialogue.advance` | none | `noDialogue` |
| `dialogue.choose` | `{ index }` (0-based among visible choices) | `noDialogue` `noChoice` |
| `inventory.transfer` | `{ from, to, item, n? }` (item = item id or entry key `sword#3`) | `noContainer` `notEnough` `full` |
| `inventory.trade` | `{ take, give, takeN?, giveN?, container? }` (all or nothing in `ctx.actor`'s container; reversible with `engine.ops.undo`, recipe 03) | `noContainer` `notEnough` `full` |
| `inventory.use` | `{ item }` (from `ctx.actor`'s container; runs the item's `use`, see recipe 03) | `notEnough` `notUsable` or the item's `canUse` reason |
| `inventory.drop` | `{ item, n? }` (a pickup at the actor's feet, data kept) | `notEnough` `noWorld` `noPosition` |
| `thing.set` | `{ id, position?, rotation?, scale?, visible? }` (core; a world record via `world.set` / `move`, an `engine.add` object saved as an override when it has an id; undoable, recipe 40) | `noThing` `engineOwned` `recordVisible` |
| `thing.remove` | `{ id }` (core; undoable: an `engine.add` object is detached and kept, a record re-added) | `noThing` `engineOwned` |
| `photo.take` | none (`r.value` is the shot; can = `photo.canTake()`, the key emits `photo:denied { reason }`) | `denied` or yours |

## 4. Read the log
```js
engine.ops.recent('shop.buy');          // [{ seq, tick, phase, name, args, source, actor, ok, code, depth, count }] old -> new
engine.ops.list();                      // defined ops [{ name, desc, args }]
engine.ops.list({ available: true });   // each offer checked with can [{ name, args, ok, code }]
```
Consecutive identical failures (same actor, op and code, e.g. `cooldown` while the trigger is held) merge into one entry with `count`.
The ring keeps `engine.ops.historySize` entries (256). A save load writes a `(load)` entry: what follows happened in the loaded world.
A thrown `run` freezes gameplay in dev / tests and `engine.error` names `ops.run('name')` plus the last 5 ops.

## 5. The guard (dev)
Saved gameplay state (`world.add/set/move/remove`, containers and the inventory, `vars`, quest start / advance) may change only while loading, inside
a fixed step, inside an op, during `saves.load` or `applyState`. Anywhere else (a UI callback, `onFrame`, `setTimeout`, `threedog js`) prints once
per place:
`[engine] gameplay state changed outside a fixed step or an op: world.set, called at ...`. Fix: turn the write into an op and `engine.ops.run` it, or
move simulation into `fixed`. `npm test` prints the first place and lists every one in the game's `.threedog/ops-guard.log`.

A module that owns its own saved state joins the guard (experimental): call `engine.ops.guard('store.set')` (a no-op in production builds) at the top
of each writing method, and wrap writes that are allowed anyway (loading your save part) in `engine.ops.allow(() => ...)`.

## 6. Testing
A test runs the op directly instead of walking, pressing keys and waiting for typing:
```js
engine.ops.run('shop.buy', { shop: 'shop-bakery', item: 'bread', n: 2 }, { source: 'test' });
// check engine.inventory.count('bread'), and engine.ops.recent('shop.buy').at(-1).code on failure
```
Keep one `press` test per key to prove "key -> op" itself works (the history shows `interaction.use` after `press interact`). Set up the scene
(move the player, the time, the weather) with `await engine.applyState({ pos: '40,-20', time: '18:30' })`: setup is not gameplay, so it passes the
ops guard, while a bare `player.placeAt` in a test warns.

## 7. Scenario tests: a test written as data
Put `<workspace>/tests/scenarios/<name>.json` in the engine package or a game; `threedog test` runs each file as the item `scenario: <name>`, and
`threedog scenario <name>` runs one on the page under `npm run dev`.
```json
{ "name": "barter: buy until sold out", "url": "/", "state": { "pos": "@fisher", "cutscene": "skip" },
  "steps": [
    { "op": "barter.buy", "args": { "shop": "fisher-basket", "item": "berry" } },
    { "op": "barter.buy", "args": { "shop": "fisher-basket", "item": "berry" }, "expect": "soldOut" },
    { "step": 0.5 },
    { "press": "interact" },
    { "expect": { "inventory.items.berry": 1, "ui.dialogue": null } },
    { "snapshot": "after-barter", "only": ["inventory"] }
  ] }
```
- `state` is `engine.applyState` params; `"pos": "@id"` stands 1 m beside a world record. The page is paused first, so game time moves only in `step`
  (seconds) and `press`.
- `op` steps run with `source: 'test'` (`actor` optional); `expect` is `"ok"` (default) or the failure code. A failure prints the `engine.explain` sentence.
- `expect` maps `describe()` paths to values (`nearby[0].name` works; numbers within 0.01; `null` = absent). `snapshot` compares with
  `tests/snapshots/<name>.describe.json` (`only` / `ignore` / `tolerance`; write it with `threedog test <name> --update-snapshots`).
- Before any step runs, every op name and step field is checked; a typo fails with "did you mean". The run stops at the first failed step.
- Use `press` only for the one test per key that proves "key -> op". Examples in the engine repository: `packages/engine/tests/scenarios/`.

## 8. Inspect and explain
```js
engine.inspect();            // { actor: 'player', at, near: [...nearby], ops: [{ op, args, ok, code?, why? }] }: what is around and possible now
engine.inspect('npc_3');     // the same as another actor; engine.inspect([x, z]) around a spot
engine.explain({ op: 'shop.buy', args: { shop: 'bakery', item: 'bread' } }).text;
// text: 'shop.buy {...} cannot run now: noMoney (Not enough gold)'; detail: 'last attempt at tick 812 (player, player): noMoney' (+ recent, events)
engine.explain({ quest: 'first-light' }).text;   // 'quest ... waits on step 2/3 "...": its done() returns false'
```
Other keys come from modules: add `explain: { myKey(e, value, query) { return { ok, text }; } }` to the module definition. Dev bridge: `threedog
inspect [id | x,z]`, `threedog explain op shop.buy shop=bakery item=bread`, `threedog explain quest first-light`.

Why did this event fire? In dev set `engine.events.traceSize = 200` (default 0 = off, no cost). Every emitted event then records its cause: `engine.events.trace('item:add').at(-1)`
is `{ id, tick, name, parent: 'op:shop.buy#12', chain: ['op:shop.buy#12'] }`; a parent is `ev:<id>` (a handler of that event emitted it) or `op:<name>#<seq>` (the
op's `run` emitted it, seq is the history seq); `chain` walks up to the root as far as the ring holds.

## 9. Randomness
Gameplay randomness uses `engine.random` (`next / range / int / pick / chance`): it is saved with the game and `createEngine({ seed })` fixes it, so a
scenario replays the same. `Math.random` breaks both.

## 10. Property tests: random op sequences
The engine repository's `Properties` specs (fast-check, a devDependency) runs random sequences of ops / saves / newGame inside the page in one `ev()` and checks the state rules (item totals kept, a refused op changes nothing, save then load is identical, newGame leaves nothing behind, a failed `engine.use` batch changes nothing).
A failure prints the shrunk minimal sequence and the seed. Replay: `FC_SEED=<seed> npm test -- "Properties: random op"`; more cases: `FC_RUNS=300` (default 25). Without fast-check installed the specs skip and say why.
To check a new rule, add a step kind to `stepArb` and a check in `pageRun`; turn every found sequence into a fixed regression spec.

## 11. Structured failures, nextFixed, and who paused
`can` may return a reason string (`'noMoney'`) or a structured failure. Every failed result from `run` / `can` / `undo` has `{ ok: false, code, facts, nextActions }`; a string failure becomes `code = that string`, `facts = {}`, `nextActions = []`, so read `.code` without checking the shape. `engine.inspect()`, `ops.list({ available: true })`, `engine.describe()` actions and `engine.explain({ op })` carry `facts` / `nextActions` too.
```js
engine.ops.define('shop.buy', {
  can: (e, a, ctx) => gold(ctx) >= 5 || { code: 'noMoney', facts: { need: 5, have: gold(ctx) }, nextActions: [{ op: 'job.work', args: {} }] },
  run: (e, a, ctx) => { /* ... */ },
});
const r = engine.ops.run('shop.buy', {});   // r.ok === false, r.code === 'noMoney', r.facts.need === 5, r.nextActions[0].op === 'job.work'
```
`engine.nextFixed(fn)` runs `fn` at the start of the next fixed step and returns a Promise of its value, so a UI click or a promise callback can safely write gameplay state: `await engine.nextFixed(() => engine.ops.run('door.open', { id: 'gate' }))`. It is built on `engine.commits` and waits while frozen or loading.

Tests that pause name themselves (default `'game'`) and end their own pause with the handle: `const p = engine.pause('my-test'); ... p.remove()`. The loop stays paused until every owner has removed theirs, so one helper cannot unpause another's pause

## 12. Failing in run, atomic ops, revision
`run` can fail like `can`: return or throw `{ ok: false, code, facts, nextActions }` (a value that merely has a `code` field is not a failure; `ok: false` is required). `facts` is an object (`{ need: 5 }`) or a list of `{ id, field, actual, expected? }` naming the record and field that were wrong. The engine never invents `nextActions`; only the op definition declares them. Every result carries `revision` (`engine.ops.revision`), a counter bumped once per committed op: "did anything change since I looked" is one compare.
```js
engine.ops.define('craft.bread', {
  atomic: true,   // every part declared atomic (world, inventory, containers, vars, quests, grids, random, scene) is undone if run fails or throws
  run(e, { oven }, ctx) {
    e.inventory.container(ctx.actor).remove('flour', 2);
    if (e.world.get(oven).heat < 3) return { ok: false, code: 'ovenCold', facts: [{ id: oven, field: 'heat', actual: e.world.get(oven).heat, expected: 3 }], nextActions: [{ op: 'oven.light', args: { oven } }] };
    e.inventory.add('bread');
  },
  after: (e) => e.audio.sfx('ding'),   // sound / animation: runs only after the op committed
});
```
What atomic covers, honestly: it copies the save parts that declared `saves.register(key, { atomic: true })` (the built-ins above; a game's own part can opt in) before `run` and loads them back on failure, so it costs one save of those per run (fine for a craft op, wrong for a per-frame op in a huge world). Events already emitted, sound, animation and any other module's state are not undone; keep such effects in `after`. Ops called from an atomic run join it (their `after` hooks wait for the outermost commit, and a rolled-back outer also takes back their revision). `ops.list()` and `engine.explain({ op })` report `atomic`.

Causal trace (`events.traceSize > 0`, recipe 06): failed ops are noted as `op:<name>` with their `code`; `collision.lineClear(a, b, { who })` as `sight` (blocked lines always, clear ones for the focused object only); NPC state changes as `npc:state`. A game's behavior notes its own mode switch with `engine.events.note('npc:mode', { obj: rec.id, data: { from: 'patrol', to: 'investigate' } })`; `events.traceFocus('guard-1')` makes one object verbose.

Atomic details: a rolled-back run still bumps `ops.revision` (it only goes up, never back to an old number) and its committed nested ops show in `ops.recent()` as `ok: false` with code `rolledBack`. `after` hooks run in commit order (nested first, then the outer op) once the outermost atomic op ends. The rollback does not run `afterLoad` and mutes the events its loads would emit, so atomic state must be plain data. Failed results name what went wrong in `code` (there is no `reason` field).

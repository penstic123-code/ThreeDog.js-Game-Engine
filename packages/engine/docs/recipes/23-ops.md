# Ops: one entry point for what players and NPCs do (engine.ops)

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
  // optional: undo(e, args, value, ctx) reverses a finished run; engine.ops.undo('shop.buy', args, r.value) calls it ({ ok: false, reason: 'noUndo' } without one)
});

const r = engine.ops.run('shop.buy', { shop: 'shop-bakery', item: 'bread' });
// r = { ok: true, value: 1 } or { ok: false, reason: 'noMoney' }
const { ok } = engine.ops.can('shop.buy', { shop: 'shop-bakery', item: 'bread' });   // ask only: grey out a button
```
Rules that keep ops replayable and network-ready:
- **Use `ctx.actor`, never `engine.player`.** `ctx.actor` is the world record id of whoever acts (default `engine.actor`, which is `'player'` — also
  the player's container id — unless the game hands control to a vehicle or squad member). NPCs run the same op with `{ actor: 'npc_3' }`; where an
  actor stands is `engine.actorPosition(ctx.actor)`.
- **Args are plain data and self-contained**: no three.js objects (pass `[x, y, z]`), and anything not in world data (aim direction, a clicked build
  position) goes in the args. Pass a fresh object each call; in dev the args are frozen because the history keeps them.
- **All "may I" checks live in `can`**, so `run` never stops halfway. A failure always has a reason (camelCase English). Show it to the player through
  i18n (`e.t('op.shop.buy.' + r.reason)`); the engine shows nothing itself.
- An op may call another op inside `run` (logged with `depth`); `can` must not call `run` or change state.
- Name ops `noun.verb`. A dot means "asking to do"; events (`noun:action`) mean "already happened". `run` keeps emitting your domain events as before.

## 2. Who calls it, and when
| Caller | How | History `phase` / `source` |
|---|---|---|
| A key in a module's `fixed` (attack, roll, fire) | `e.ops.run('combat.roll', { dir }, { source: 'player' })` | `fixed` / `player` |
| A UI button or click | `engine.ops.run('shop.buy', args)` | `between` / `player` |
| Dialogue choices, triggers, quest rewards in content | `do: { op: ['shop.buy', { shop: 'shop-bakery', item: 'bread' }] }`, `if: { can: ['shop.buy', {...}] }` | inherits the caller |
| Dev bridge | `npx threedog op shop.buy shop=shop-bakery item=bread` / `npx threedog ops` | `between` / `bridge` |
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
| `photo.take` | none (`r.value` is the shot; can = `photo.canTake()`, the key emits `photo:denied { reason }`) | `denied` or yours |

## 4. Read the log
```js
engine.ops.recent('shop.buy');          // [{ seq, tick, phase, name, args, source, actor, ok, reason, depth, count }] old -> new
engine.ops.list();                      // defined ops [{ name, desc, args }]
engine.ops.list({ available: true });   // each offer checked with can [{ name, args, ok, reason }]
```
Consecutive identical failures (same actor, op and reason, e.g. `cooldown` while the trigger is held) merge into one entry with `count`.
The ring keeps `engine.ops.historySize` entries (256). A save load writes a `(load)` entry: what follows happened in the loaded world.
A thrown `run` freezes gameplay in dev / tests and `engine.error` names `ops.run('name')` plus the last 5 ops.

## 5. The guard (dev)
Saved gameplay state (`world.add/set/move/remove`, containers and the inventory, `vars`, quest start / advance) may change only while loading, inside
a fixed step, inside an op, during `saves.load` or `applyState`. Anywhere else (a UI callback, `onFrame`, `setTimeout`, `npx threedog js`) prints once
per place:
`[engine] gameplay state changed outside a fixed step or an op: world.set, called at ...`. Fix: turn the write into an op and `engine.ops.run` it, or
move simulation into `fixed`. `npm test` lists every place in `.threedog/ops-guard.log`.

A module that owns its own saved state joins the guard (experimental): call `engine.ops.guard('store.set')` (a no-op in production builds) at the top
of each writing method, and wrap writes that are allowed anyway (loading your save part) in `engine.ops.allow(() => ...)`.

## 6. Testing
A test runs the op directly instead of walking, pressing keys and waiting for typing:
```js
engine.ops.run('shop.buy', { shop: 'shop-bakery', item: 'bread', n: 2 }, { source: 'test' });
// check engine.inventory.count('bread'), and engine.ops.recent('shop.buy').at(-1).reason on failure
```
Keep one `press` test per key to prove "key -> op" itself works (the history shows `interaction.use` after `press interact`).

## 7. Scenario tests: a test written as data
Put `<workspace>/tests/scenarios/<name>.json` in the engine package or a game; `npx threedog test` runs each file as the item `scenario: <name>`, and
`npx threedog scenario <name>` runs one on the page under `npm run dev`.
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
- `op` steps run with `source: 'test'` (`actor` optional); `expect` is `"ok"` (default) or the reason. A failure prints the `engine.explain` sentence.
- `expect` maps `describe()` paths to values (`nearby[0].name` works; numbers within 0.01; `null` = absent). `snapshot` compares with
  `tests/snapshots/<name>.describe.json` (`only` / `ignore` / `tolerance`; write it with `threedog test <name> --update-snapshots`).
- Before any step runs, every op name and step field is checked; a typo fails with "did you mean". The run stops at the first failed step.
- Use `press` only for the one test per key that proves "key -> op". Examples in the engine repository: `packages/engine/tests/scenarios/`.

## 8. Inspect and explain
```js
engine.inspect();            // { actor: 'player', at, near: [...nearby], ops: [{ op, args, ok, reason?, why? }] }: what is around and possible now
engine.inspect('npc_3');     // the same as another actor; engine.inspect([x, z]) around a spot
engine.explain({ op: 'shop.buy', args: { shop: 'bakery', item: 'bread' } }).text;
// text: 'shop.buy {...} cannot run now: noMoney (Not enough gold)'; detail: 'last attempt at tick 812 (player, player): noMoney' (+ recent, events)
engine.explain({ quest: 'first-light' }).text;   // 'quest ... waits on step 2/3 "...": its done() returns false'
```
Other keys come from modules: add `explain: { myKey(e, value, query) { return { ok, text }; } }` to the module definition. Dev bridge: `npx threedog
inspect [id | x,z]`, `npx threedog explain op shop.buy shop=bakery item=bread`, `npx threedog explain quest first-light`.

## 9. Randomness
Gameplay randomness uses `engine.random` (`next / range / int / pick / chance`): it is saved with the game and `createEngine({ seed })` fixes it, so a
scenario replays the same. `Math.random` breaks both.

## 10. Property tests: random op sequences
The engine repository's `Properties` specs (fast-check, a devDependency) runs random sequences of ops / saves / newGame inside the page in one `ev()` and checks the state rules (item totals kept, a refused op changes nothing, save then load is identical, newGame leaves nothing behind, a failed `engine.use` batch changes nothing).
A failure prints the shrunk minimal sequence and the seed. Replay: `FC_SEED=<seed> npm test -- "Properties: random op"`; more cases: `FC_RUNS=300` (default 25). Without fast-check installed the specs skip and say why.
To check a new rule, add a step kind to `stepArb` and a check in `pageRun`; turn every found sequence into a fixed regression spec.

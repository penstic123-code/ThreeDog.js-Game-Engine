# Adding quests (with HUD objective markers)

Modules needed: `quests({ ...presets.keys.quests })` (quest log; the preset opens it with J / gamepad Select, or pass your own `keys`, `keys: []` for
none); objective markers need `hud()` (neither is in openWorld, add them yourself:
`engine.use(openWorld({ camera: 'follow', ...}), quests({ ...presets.keys.quests }), hud())`).
A quest is a list of steps completed in order; each step has one completion condition (or several parallel goals), checked every half second; a quest
may also fail. When the current step has a `target`, hud shows a marker and distance above it automatically, and an edge arrow when it is off-screen.

## 1. Write data (recommended)
`games/<game>/content/quests.js`:
```js
export default {
  'restore-power': {
    title: 'Restore power',
    desc: 'The engineer needs three fuses to restart the relay.',
    startOn: 'engine:ready',                     // the event that starts it automatically (or use { startQuest: 'restore-power' } in a dialogue)
    steps: [
      { id: 'talk', text: 'Talk to the engineer', done: { flag: 'metEngineer' }, target: { npc: 'engineer' } },   // the marker follows the NPC
      { id: 'gather', text: 'Find 3 fuses', done: { has: { fuse: 3 } }, target: 'storage' },           // a place name
      { id: 'return', text: 'Fit them at the relay', done: { flag: 'relayOn' }, target: { place: 'home', x: 0, z: 3 } },
    ],
    reward: [{ take: { fuse: 3 } }, { give: { coin: 5 } }, { toast: 'Power restored!' }],
  },
};
```
`target` forms: a place name, `{ place, x, z }`, `{ x, z }` (world coordinates; any of these may add `floor` / `y` for a storey on multi-layer ground,
as in props), `{ npc: 'id in npcs.js' }`, `{ nearest: 'itemId' }` (the closest not-yet-picked-up pickup of that kind to the player; hidden
automatically once picked up).
In code you can also write a function `target: () => target or null` (evaluated every frame); to change the target of a manual marker use
`engine.hud.marker(...).setTarget(newTarget)`.
Give every step (and every part of a parallel step) a stable `id`: saves store progress by it, so inserting or reordering steps after release never
moves a player's progress (without ids the position is the id). A save that names a step id the quest no longer has restarts that quest from its first
step, with a dev warning (code `quest-step`).
Completion conditions use the condition words (flag has counter...); to count "how many times", call `engine.vars.bump('name')` in code and write the
condition as `{ counter: { name: 3 } }`.

### Parallel goals, optional goals, failing
Not every quest is a straight line. A step can hold several goals done in any order (`all`); a goal marked `optional` never holds the step back;
`fail` ends the quest early:
```js
'defend-camp': {
  title: 'Hold the camp',
  startOn: 'engine:ready',
  steps: [
    { text: 'Reach the camp', done: { flag: 'atCamp' }, target: 'camp' },
    { all: [                                                            // text defaults to the required goals: "Hold the north gate / Hold the south gate"
      { text: 'Hold the north gate', done: { counter: { northWaves: 3 } }, target: 'northGate' },
      { text: 'Hold the south gate', done: { counter: { southWaves: 3 } }, target: 'southGate' },
      { text: 'No ally hurt', done: { notFlag: 'allyHurt' }, optional: true },   // a bonus: never blocks, shown done if met in time
    ] },
  ],
  fail: { flag: 'campBurned' },                    // checked while the quest is active
  onFail: [{ toast: 'The camp has fallen' }, { setFlag: 'mayRetryCamp' }],
  reward: { give: { coin: 20 } },
},
```
- hud marks every unfinished goal of the current parallel step; `quests.list()` gives that step `parts: [{ text, target, optional, done }]`.
- Events: `quest:part` `{ id, step, part }` when one goal is met (give a bonus for an optional goal here), `quest:fail` `{ id }`.
- A failed quest is not active (`isFailed(id)`); `quests.start(id)` (or `{ startQuest }`) takes it again from step 1 — daily orders, retries.

## 2. In code (complex conditions, or when you need functions)
```js
engine.quests.define('slimes3', {
  title: 'Clear the cellar',
  steps: [{ text: 'Defeat 3 slimes', done: e => e.vars.counter('slimes') >= 3, target: () => engine.npcs.get('engineer')?.position }],   // the function returns a position every frame: when the NPC is far away and has no model, root is null, so read position from the data
  reward: e => e.inventory.add('coin', 3),
});
engine.quests.start('slimes3');
engine.vars.bump('slimes');                      // each time one is defeated
engine.events.on('quest:done', ({ id }) => { /* quest completed */ });   // there are also quest:start, quest:step, quest:part and quest:fail
```
To turn off automatic markers: `hud({ questMarkers: false })`. To add a marker by hand: `const m = engine.hud.marker('gate', { label: 'Gate' }); m.remove();`;
content effects can add them too: `{ marker: 'gate' }` / `{ clearMarker: 'gate' }`. A counter in the screen corner:
`engine.hud.counter('slimes', { label: 'Slimes', value: 2, max: 3 })`.

## 3. Verify
- `npm run check`: a wrong item / flag / place name / NPC id in a step is an error; "flag is only checked but never set" is a warning. After
  `npm run map`, GAMEMAP.md has the quest step table.
- `describe().quests`: `active: [{ id, title, step: current step text }]`, `done: number completed`, `failed: number failed` (in describeText it is a
  `quests: {...}` line).
  In more detail: `engine.quests.list()` (each step has `current/done/target`), `engine.quests.isActive(id)`; story flags in `engine.vars.flags`.
- Objective markers: `describe().hud.markers` has `{ label: quest title, distance: meters, onScreen }`; counters are in `describe().hud.counters`.
- After advancing a condition you don't have to wait: `engine.quests.check()` checks immediately. Related test: `npm test -- 目标指示`.

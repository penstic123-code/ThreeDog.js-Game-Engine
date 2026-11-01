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
  'mushroom-soup': {
    title: '蘑菇汤',
    desc: '面包师想要一锅蘑菇汤。',
    startOn: 'engine:ready',                     // the event that starts it automatically (or use { startQuest: 'mushroom-soup' } in a dialogue)
    steps: [
      { id: 'talk', text: '和面包师聊聊', done: { flag: 'metBaker' }, target: { npc: 'baker' } },   // the marker follows the NPC
      { id: 'gather', text: '采 3 个蘑菇', done: { has: { mushroom: 3 } }, target: 'forest' },         // a place name
      { id: 'return', text: '回到小屋门口', done: { flag: 'soupDone' }, target: { place: 'home', x: 0, z: 3 } },
    ],
    reward: [{ take: { mushroom: 3 } }, { give: { coin: 5 } }, { toast: '蘑菇汤做好了！' }],
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
  title: '守住营地',
  startOn: 'engine:ready',
  steps: [
    { text: '赶到营地', done: { flag: 'atCamp' }, target: 'camp' },
    { all: [                                                            // text defaults to the required goals: "守住北门 / 守住南门"
      { text: '守住北门', done: { counter: { northWaves: 3 } }, target: 'northGate' },
      { text: '守住南门', done: { counter: { southWaves: 3 } }, target: 'southGate' },
      { text: '没有村民受伤', done: { notFlag: 'villagerHurt' }, optional: true },   // a bonus: never blocks, shown done if met in time
    ] },
  ],
  fail: { flag: 'campBurned' },                    // checked while the quest is active
  onFail: [{ toast: '营地失守了' }, { setFlag: 'mayRetryCamp' }],
  reward: { give: { coin: 20 } },
},
```
- hud marks every unfinished goal of the current parallel step; `quests.list()` gives that step `parts: [{ text, target, optional, done }]`.
- Events: `quest:part` `{ id, step, part }` when one goal is met (give a bonus for an optional goal here), `quest:fail` `{ id }`.
- A failed quest is not active (`isFailed(id)`); `quests.start(id)` (or `{ startQuest }`) takes it again from step 1 — daily orders, retries.

## 2. In code (complex conditions, or when you need functions)
```js
engine.quests.define('fish3', {
  title: '钓三条鱼',
  steps: [{ text: '钓到 3 条鱼', done: e => e.vars.counter('fish') >= 3, target: () => engine.npcs.get('面包师')?.position }],   // the function returns a position every frame: when the NPC is far away and has no model, root is null, so read position from the data
  reward: e => e.inventory.add('coin', 3),
});
engine.quests.start('fish3');
engine.vars.bump('fish');                        // each time a fish is caught
engine.events.on('quest:done', ({ id }) => { /* quest completed */ });   // there are also quest:start, quest:step, quest:part and quest:fail
```
To turn off automatic markers: `hud({ questMarkers: false })`. To add a marker by hand: `const m = engine.hud.marker('river', { label: '河边' }); m.remove();`;
content effects can add them too: `{ marker: 'river' }` / `{ clearMarker: 'river' }`. A counter in the screen corner:
`engine.hud.counter('fish', { icon: '🐟', label: '鱼', value: 2, max: 3 })`.

## 3. Verify
- `npm run check`: a wrong item / flag / place name / NPC id in a step is an error; "flag is only checked but never set" is a warning. After
  `npm run map`, GAMEMAP.md has the quest step table.
- `describe().quests`: `active: [{ id, title, step: current step text }]`, `done: number completed`, `failed: number failed` (in describeText it is a
  `quests: {...}` line).
  In more detail: `engine.quests.list()` (each step has `current/done/target`), `engine.quests.isActive(id)`; story flags in `engine.vars.flags`.
- Objective markers: `describe().hud.markers` has `{ label: quest title, distance: meters, onScreen }`; counters are in `describe().hud.counters`.
- After advancing a condition you don't have to wait: `engine.quests.check()` checks immediately. Related test: `npm test -- 目标指示`.

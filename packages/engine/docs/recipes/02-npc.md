# Adding an NPC (schedule + dialogue)

Modules needed: `characters()` (NPCs on by default), `interactions({ ...presets.interactions.nearest })`, `dialogue()`; clock-time schedules need `sky()`. The `openWorld()` preset already installs `characters()` and `sky()` but not `interactions({ ...presets.interactions.nearest })` or `dialogue()`, so add them yourself: `engine.use(openWorld({ camera: 'follow', ...}), interactions({ ...presets.interactions.nearest }), dialogue(), content())`.

## 1. Write data (recommended)
`games/<game>/content/npcs.js`:
```js
export default {
  baker: {
    name: '面包师',
    colors: { body: 0xc89a5a, legs: 0x5b4a3a, hair: 0x3a2a1a },   // omit to use the style pack's default colors
    start: { place: 'home', x: 6, z: -3 },                         // starting position; omitted = the first stop of the schedule
    schedule: [                                                    // at is a clock time 'HH:MM'; at that time the NPC walks there (pathfinding is automatic)
      { at: '07:00', place: 'home', x: 6, z: -3 },
      { at: '13:00', place: 'river' },
      { at: '18:30', place: 'home', x: 2, z: 4 },
    ],
    talk: 'baker',                                                 // a dialogue id in dialogues.js; press E when near
  },
  cat: { name: '猫', start: { place: 'home' }, behavior: 'wander', mind: { radius: 6 } },   // no schedule: write behavior + start, omit schedule
};
```
`content/dialogues.js`:
```js
export default {
  baker: {
    speaker: '面包师',
    nodes: {
      start: {
        text: [                                                    // several variants: the first whose condition holds is used
          { if: { flag: 'metBaker' }, text: '又来啦？' },
          { text: '你好，第一次见。' },
        ],
        do: { setFlag: 'metBaker' },
        next: 'ask',
      },
      ask: { text: '要面包吗？', choices: [
        { text: '要一个', next: 'buy', if: { has: { coin: 1 } } },
        { text: '不用了' },                                         // no next = the dialogue ends
      ] },
      buy: { text: '刚出炉的。', do: [{ take: { coin: 1 } }, { give: { bread: 1 } }], next: 'end' },
    },
  },
};
```
The words usable in conditions / effects are in the comment at the top of `modules/content/rules.js` (flag notFlag has lacks counter / setFlag give take bump startQuest toast particles marker clearMarker).
The items used (coin, bread) must be defined in `items.js`, otherwise validation fails. A `place` name comes from `content.load(data, { places })` or from a level marker (such as `npc_baker`). Add a new content file to `content/index.js`.

## 2. Add in code (temporary NPCs, dynamic schedules)
```js
engine.dialogue.define('passerby', { start: { text: '今天天气不错。', speaker: '路人' } });
const npc = engine.npcs.add({ id: 'passerby', name: '路人', position: [10, 0, 5], schedule: [{ at: '08:00', position: [20, 0, 5] }], talk: 'passerby' });   // at: 'HH:MM' or 0-1; without id the name is used
engine.npcs.remove('passerby');                   // remove by id, name or handle
```

## NPC data and model (why npc.root is sometimes null)
The fact of an NPC is one record in the world data `engine.world` (kind `'npc'`, the id is the id above / the key in content): position, schedule, current stop, in-dialogue, animation state and movement state are plain fields and are saved.
The character model is just an appearance built only near the player (world radius, default 60 meters): removed when you walk away and rebuilt when you come near; changing level only removes the model, and it is rebuilt automatically when you return to that level.
- `npcs.add` returns a **handle**: `npc.data` (the record), `npc.position` (the model position when there is a model, otherwise the data position), `npc.character` / `npc.root` (the current model, `null` if none), `npc.placeAt(p)`, `npc.remove()`.
- **Arrival tolerance**: within 1.2 meters of a stop (`arriveDistance`, default 1.2, can be set per NPC) counts as arrived and the NPC stops, without stepping exactly on the stop center; for an exact position put the stop a bit away from obstacles, or `placeAt` yourself.
- Far away with no model, an NPC follows its schedule in a straight line (stops at the stop if reachable, otherwise on the line); when it comes back, the model is built at the computed position; nearby it paths around obstacles as usual.
- Add things to the model (a hat, a name tag) after every model build; don't call `npc.root.add(...)` right after add (the first model is built in the next fixed step; for one immediately use `engine.world.refresh()`).
- When two NPCs share a name, give each an `id` (without an id the name is the id, and in development a duplicate name throws). NPCs in content are the world's **initial data**: the save records only changes such as position and state; schedule and name follow the content.
- Change data with `engine.world.set(npc.id, { mood: 'happy' })` (emits the world:change event); only plain values go in the data, models and functions stay in code.

## Changing behavior / custom behavior
What an NPC "does" is a swappable **behavior**: the `behavior` field in the data picks it, and the schedule (`'schedule'`, the default) is just one of them. Built in there is also `'wander'` (random wandering near home, using `engine.random`, same seed same result).
```js
npc.setBehavior('wander', { radius: 12 });        // home = current position, wander within 12 meters (pause: [2, 6] pause seconds, home: { x, z } sets the center)
npc.setBehavior('schedule');                       // back to the schedule
engine.npcs.add({ id: 'dog', name: '小狗', position: [5, 0, 5], behavior: 'wander', mind: { radius: 8 } });   // wanders from the start
```
The behavior name and `mind` (the behavior's parameters and memory) are in the NPC data and are saved; after changing behavior or loading, the NPC carries on with the new behavior. A wrong behavior name throws and lists the registered ones. NPCs in content can also write `behavior` + `mind` directly (see the cat above); to change behavior at runtime use `npc.setBehavior`.

**An enemy that chases the player**: the `chase` behavior below is the example; in `near`, after your own `character.move`, call `engine.npcs.avoid.push(rec, npc.character, dt)` once so several enemies don't pile into one clump (see "Avoidance" below). Things that are not NPCs (monsters, crops) are written as world data, see recipe 18 section 5.

To write your own: `engine.npcs.behavior(name, { near(rec, dt, npc), far(rec, dt) })`, with the same rules as `world.simulate`: `near` is called once per fixed step while nearby (`npc.character` is the model, `null` if not yet built), `far` simulates from data while far away (`dt` is accumulated seconds and can be large; on the far -> near step `far` is used first to make up the owed time; without `far` the NPC stands still when far). The behavior keeps no variables of its own; what must be remembered goes in `rec.mind` (plain values), otherwise it won't match after the model is removed or after loading.
```js
// Chase the player: chase in a straight line when near, stand still within 2 meters of the player; do not chase when far. Register before npcs.add / setBehavior
engine.npcs.behavior('chase', {
  near(rec, dt, npc) {
    const p = npc.position, t = engine.player.position, dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz) || 1;
    npc.character?.move(d > 2 ? dx / d : 0, d > 2 ? dz / d : 0, false, dt);   // no model: don't move
    engine.world.move(rec.id, npc.position);                                 // write the position back to the data
  },
});
npc.setBehavior('chase');
```
To path around obstacles, use `engine.characters.findPath(from, to)` to get waypoints and walk them one by one (the schedule behavior does exactly this, see `goTo` in `modules/characters/npcSim.js`).

## Avoidance (NPCs don't clump or pass through each other)
NPCs with models nearby avoid each other by default: when closer than the sum of two radii (`engine.movement.radius` x 2, about 0.8 meters) they push each other apart, harder the more they overlap, at most 3 meters per second; the player counts as an obstacle that only NPCs yield to, and the player's position is never pushed. After pushing, `engine.collision` (if installed) constrains them back to walkable ground, so they are not pushed into walls. The built-in `schedule` and `wander` both avoid.
- Deterministic and cheap: done only in the fixed step, no random numbers, neighbors computed from "the positions at the start of this step", so after save and load, or with a different `frameEvery`, positions are identical bit for bit; 400 NPCs with models cost less than 1 ms per step (a tight clump only a few ms).
- Tune or turn off:
```js
engine.npcs.avoid.set({ radius: 0.6, strength: 2 });   // stand sparser (radius in meters), push slower (strength in meters/second)
engine.npcs.avoid.set(false);                           // turn off (ghosts, crowds passing through); set(true) turns it on again
```
- Far away (no model) NPCs are simulated from data without per-NPC avoidance; a few steps after a model is built on approach they get pushed apart.
- Difference from `nav({ crowd: true })`: when crowd is installed the Recast crowd agents take over and this is not applied on top. Crowd routes more cleverly (around obstacles along the navmesh, yields to others) but does not guarantee identical results after loading; the simple push here does not route around anything and only keeps NPCs from overlapping, with results identical after loading. For save replay and determinism use this; for crowds going around big obstacles use crowd.
- Behaviors you write are not avoided automatically: after your own `character.move`, call `engine.npcs.avoid.push(rec, npc.character, dt)` once (inside `near`, before writing back to the data).

## 3. Verify
- `npm run check`: content validation catches "dialogue id does not exist", "bad clock-time format", "node next points to a missing node". After `npm run map` it shows up in the NPC table and dialogue graph of GAMEMAP.md.
- State: `npm run shot -- / --time 13:10 --wait 20 --describe-only`; the "nearby" list has an entry for `面包师` tagged as an NPC with its distance in meters (only listed within 30 meters; add `--pos x,z` to stand by the river).
- Console / tests: `engine.npcs.get('面包师').position`, `.currentStop()`; during a dialogue `engine.describe().ui.dialogue` has speaker, text, choices.
- Advancing a dialogue in a headless test (typing and "keys ignored right after opening" both run on game time): press E when near -> `engine.step(1)` to finish typing -> press a number key or run `engine.ops.run('dialogue.choose', { index: i })` (while typing it completes the sentence first) -> `engine.step(0.3)`. No real-time waiting.
- Related tests: `npm test -- 小城` (the shopkeeper's schedule and dialogue), `npm test -- "S1 NPC"` (far-away simulation, changing level, saving, identical results after loading).

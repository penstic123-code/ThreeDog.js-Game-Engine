# Animation state machine (skeletal animation)

There is a single entry point: `engine.assets.animate(model, config)` -> Animator (advanced every frame by the engine; never call mixer.update yourself).
For characters (player, NPCs), passing `model` builds the Animator automatically and switches clips by character state (idle walk run swim jump fall drive).

## 1. The model
Export a glTF with animations from Blender, put it in `art/models/` -> `npm run assets` -> `public/models/hero.glb`. Register it and fetch a copy (the
skeleton is cloned correctly; clips are in `userData.animations`):
```js
engine.assets.manifest({ models: { hero: '/models/hero.glb', dog: '/models/dog.glb' } });
const hero = await engine.assets.model('hero');
```

## 2. Mapping: game action names -> whatever the asset calls its clips
States are the mapping. The left side is what your game says (`idle`, `attack`, `hurt`), the right side is the clip name in the file, so a new model
only changes the right side:
```js fragment
states: { idle: { clip: 'Idle_Sword' }, attack: { clip: 'Sword_Slash', loop: false }, hurt: { clip: 'HitRecieve', loop: false }, death: { clip: 'Death', loop: false } }
```
**Keep the mapping as data, on the model's manifest entry** (it describes the file, so it travels with it in an asset pack). `assets.animate(model)`
and characters start from it; config passed in code adds states and wins per state. Swapping the model then only edits its manifest entry:
```js
engine.assets.manifest({ name: 'heroes', models: { hero: { url: '/models/hero.glb', animation: {
  fade: 0.2,
  states: { idle: { clip: 'Idle_Sword' }, walk: { clip: 'Walk' }, attack: { clip: 'Sword_Slash', loop: false, timing: 0.62 }, hurt: { clip: 'HitRecieve', loop: false } },
} } } });
engine.characters.createPlayer({ ...presets.player.thirdPerson, model: 'hero' });   // no clips / animation in code
engine.assets.mapping(engine.player.anim.root);                                     // after whenReady: the entry's mapping, or null
```
A character's default names (`Idle`, `Walk`...) never shadow a mapped state, and the entry's `fade` beats the style's.

- A clip name also matches the part after the last `|`: Blender / FBX2glTF exports `CharacterArmature|Idle`, you write `Idle`.
- Dev checks: a state whose clip is not in the model warns at `assets.animate()` with the available clip names and where to fix it
  (`state "attack" maps to a missing clip ... Fix the clip name in manifest "heroes" models.hero.animation.states.attack`); unknown keys
  (`loops: false`) warn ``did you mean `loop`?``; `go('atack')` / `sync('atack')` warn ``did you mean `attack`?`` and return null.
- **Check the actions the game plays**, once after building (a test, the console): `anim.check(['idle', 'walk', 'attack', 'hurt'])` returns `[]`, or
  one line per problem with its fix
  (`action "hurt" has no state. Add it to manifest "heroes" models.hero.animation.states.hurt: { clip: '<name>' } (clips in the model: ...)`). A model
  with no clips says so.
- Several states may share one clip (they share one AnimationAction, so switching between them does not cross-fade).
- Bone names: GLTFLoader drops dots, so `Wrist.R` becomes `WristR` in `model.getObjectByName`.

## 3. A character with a skinned model (most common)
```js
engine.characters.createPlayer({ ...presets.player.thirdPerson, model: hero,
  clips: { idle: 'Idle', walk: 'Walk', run: 'Run', jump: 'Jump' },   // character state -> clip name in the glTF; states you leave out use the capitalised name if the model has that clip
});
engine.player.playAction('Wave');                                   // one-shot clip (skipped if the clip doesn't exist); returns to the previous state when done
engine.player.anim.state;                                           // current state name
```
**The game's own states** (crouch, climb, glide, dash, roll) go on top of the built-in ones through the `states` option, without taking the mover
over: it runs after the mover's state each step and returns a state name or null (keep the built-in `facts.base`); the clip comes from `clips`
like any other state, a speed change stays `engine.mod('move.speed')`.
```js
createPlayer({ ...presets.player.thirdPerson, model: hero, clips: { crouch: 'Crouch', glide: 'Glide' },
  states: (c, f) => f.grounded && engine.input.down('crouch') ? 'crouch' : !f.grounded && f.vy < 0 && gliding ? 'glide' : null });
```
Deep water follows `water`: `'swim'` (default), `'block'` (never enters), `'wade'` (walks the bottom), or `(c, { depth }) => mode` per spot;
`character:water { in, mode, depth }` fires on each change.
For smooth walk/run blending, use `animation` instead of `clips` and write a `move` blend tree (when the model has no walk/run states, move is used
automatically; the `speed` parameter is in m/s):
```js
engine.characters.createPlayer({ ...presets.player.thirdPerson, model: hero, animation: { states: {
  idle: { clip: 'Idle' },
  move: { blend: [{ clip: 'Walk', at: 1.5 }, { clip: 'Run', at: 6 }], param: 'speed', sync: true },   // sync: align footsteps
  jump: { clip: 'Jump', loop: false },
} } });
```
The default transition time comes from the style's `style.character.animation.fade`.

**By asset name.** `model` also takes the name of a registered model asset: a file model, or a procedural builder. The character is built at once
with a gray capsule; when the asset loads, a skeleton-correct copy replaces it under the same root, so position, facing, state, collision and the
world view stay. Then `ready` turns true, `whenReady` settles and `character:model` is emitted. A name no model asset has throws with the registered
names; a failed load keeps the capsule and warns once; a character disposed before loading ends never gets the model.
```js
engine.assets.manifest({ models: { hero: '/models/hero.glb' } });
const p = engine.characters.createPlayer({ ...presets.player.thirdPerson, model: 'hero' });        // capsule now, the hero once loaded
await p.whenReady;                                                  // p.anim is set from here (unless the load failed)
```

## 3b. Procedural bodies are assets too (`model: 'humanoid'`)
Character bodies are assets, never style: every character picks one with `model`, the same path for a GLB and a procedural builder. an asset
pack can supply a code-built humanoid (e.g. box limbs, swung by the engine while walking, running, swimming, jumping); a builder is built at once, so its joints
(`player.armL`, `legR`...) exist right after `createPlayer`. Without `model` (and without `rig`) a character is a gray capsule, warned once.
```js
import { assets } from './assets.js';                               // an asset pack of yours (or a published one) with a 'humanoid' builder
engine.assets.manifest(assets);
engine.characters.createPlayer({ ...presets.player.thirdPerson, model: 'humanoid' });
engine.npcs.add({ id: 'fisher', model: 'humanoid', colors: { body: 0x4f6d8f } });   // per-character part colors
```
- **Colors**: the humanoid's parts use material roles `cloth`, `skin`, `trousers`, `hair`, so any style tints every humanoid
  (`style: [basePack, { materials: { cloth: { color: 0x3a6ea5 } } }]`); `colors: { body, skin, legs, hair }` recolors one character.
- **Your own procedural body**: a builder that returns an Object3D with `root.userData.rig = { body: 'hips', head: 'head', joints: ['armL'],
  limbs: [{ joint: 'legL', offset: 0, amp: 0.9, kind: 'leg' }] }` (object names, so it survives copies and baking) animates like the humanoid; mark
  meshes `userData.part = 'body'` for `colors`. A hand-built one-off passes `{ rig }` instead ([02-npc](02-npc.md)).

## 4. Non-character objects (a dog, a windmill, a door)
```js
const dog = await engine.assets.model('dog'); engine.add(dog);
const anim = engine.assets.animate(dog, {
  fade: 0.25,
  states: {
    idle: { clip: 'Idle' },
    move: { blend: [{ clip: 'Walk', at: 1 }, { clip: 'Run', at: 5 }], param: 'speed' },
    bark: { clip: 'Bark', loop: false, then: 'idle', lock: true },   // one-shot; lock: go() doesn't interrupt it while it plays
  },
  transitions: { '*>idle': 0.4 },                                   // transition seconds for specific switches
});
anim.go('idle');
anim.set('speed', 3); anim.go('move');                              // just set the speed every frame
anim.action('bark');
engine.events.on('anim:end', ({ root, state }) => { if (root === dog) console.log(state, 'finished'); });
anim.dispose();                                                     // no longer needed: stop per-frame updates (call this when deleting the model)
```
**Gameplay timing never reads the animation**: the mixer advances per frame and `anim:end` is emitted per frame, so dropped frames, fast-forward
(step's frameEvery) and a model being torn down when it is far away all make it drift from game time. When an attack lands, cooldowns, recovery and
"finish the swing before moving" are timed in fixed steps:
```js
engine.input.action('attack', { label: 'Attack', keys: ['KeyF', 'Mouse0'] });      // no module binds it for you
let t = -1;                                                         // seconds since the swing started (-1 = not swinging); put it in a world record if it must be saved
engine.onFixed(dt => {
  if (t < 0) { if (!engine.input.pressed('attack')) return; t = 0; }
  const before = t; t += dt;
  if (before < 0.3 && t >= 0.3) hitEnemiesInFront();               // hit check at 0.3 s
  if (t >= 0.6) t = -1;                                             // can swing again after 0.6 s
  engine.player.anim.sync(t < 0 ? null : 'attack', t);               // the animation follows t (the attack state of section 5)
});
```
## 5. Gameplay controls progress: `sync(state, t)`
Who owns the clock: **gameplay**. An action timeline counts `t` in fixed-step seconds (recipe 06) and decides hit windows, i-frames and when the
action ends; the animation only shows `t`.
`anim.sync(state, t)` poses `state` at gameplay time `t`: the clip does not advance or end by itself (no `anim:end`), and `go()` / `action()` leave it
alone, so a character's per-frame locomotion cannot override it. `sync(null)` hands control back; the next `go()` switches as usual. Entering a synced
state cross-fades like `go()` (the `transitions` table applies).
`timing` on the state maps gameplay seconds to clip seconds:
```js
const anim = engine.player.anim;                                    // or engine.assets.animate(model, {...})
Object.assign(anim.states, {
  // gameplay: windup 0-0.16, hit 0.16-0.28, recovery 0.28-0.62. The clip raises the sword until 0.24 s and brings it down by 0.5 s:
  attack: { clip: 'Sword_Slash', loop: false, timing: [[0, 0], [0.16, 0.24], [0.28, 0.5], [0.62, 1]] },   // piecewise linear
  roll: { clip: 'Roll', loop: false, timing: 0.62 },                // a number: stretch the whole clip over 0.62 gameplay seconds
  hurt: { clip: 'HitRecieve', loop: false, timing: 0.45 },
  death: { clip: 'Death', loop: false },                            // no timing: clip seconds = t (clamped at the last frame)
});
engine.onFixed(() => {                                              // one call site: whatever gameplay is doing decides the pose
  if (f.dead) anim.sync('death', f.deadT);
  else if (f.stun > 0) anim.sync('hurt', f.stunMax - f.stun);
  else if (f.act) anim.sync(f.act.id, f.act.t);
  else anim.sync(null);                                             // free: locomotion (idle / walk / run) takes over
});
```
- Calibrate `timing` once by looking: sync the raw clip (no timing) at a few `t` and watch the weapon hand (`describe()` or a bone's world position);
  put the down-swing inside the hit phase.
- Pause, fast-forward, hit-stop (t stays still), loading mid-action and replays all line up, because the pose is a pure function of `t`.
- Looping states wrap `t`, one-shots clamp it to the clip.

Use `anim:end` only for presentation (change an expression, play the next clip). Native objects: `anim.mixer` (AnimationMixer), `anim.actions` (clip
name -> AnimationAction). Things without a skeleton that only move/rotate as a whole use `engine.timeline.tween`, not an Animator.

Bones after the pose: `const h = player.onPose((c, dt) => { sword.position.copy(hand.getWorldPosition(v)); })` runs every frame right after the character's pose is
applied (clips or procedural rig); `h.remove()` stops it. Presentation only.

## 6. Verify
- `anim.describe()` -> `{ state, clip, time, progress, driven, t, weights }` (clip seconds, 0-1 progress, whether sync drives it, the last gameplay t,
  each fading state's share); the player's is in `describe().player.anim`.
- In a test: `engine.pause(); anim.go('move'); engine.step(0.4)`, then look at `anim.state` and `anim.actions.get('Walk').getEffectiveWeight()` (all
  clip weights sum to 1).
- Characters: `describe().player.state` (idle/walk/run...) matches `engine.player.anim.state`.
- `anim.check([...actions])` is `[]`.
- Related tests: `npm test -- "Animation state machine"` (in the engine repository: two-bone figure built in code by `makeRig()`, in
  `packages/engine/tests/vehicle/`), `npm test -- 骨骼动画链路` (a real CC0 glTF character, `packages/engine/tests/anim/`: manifest mapping, cross-fade, sync, alignment of the
  slash with the hit phase, dev warnings) and `npm test -- 骨骼动画最小链路` (a skinned GLB generated in code by `tests/anim/rig.js` through GLTFExporter,
  loaded like a file: manifest mapping, `check`, sync holding the pose against frame time).

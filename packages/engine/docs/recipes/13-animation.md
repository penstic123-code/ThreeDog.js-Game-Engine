# Animation state machine (skeletal animation)

There is a single entry point: `engine.assets.animate(model, config)` -> Animator (advanced every frame by the engine; never call mixer.update yourself).
For characters (player, NPCs), passing `model` builds the Animator automatically and switches clips by character state (idle walk run swim jump fall drive).

## 1. The model
Export a glTF with animations from Blender, put it in `art/models/` -> `npm run assets` -> `public/models/hero.glb`. Register it and fetch a copy (the skeleton is cloned correctly; clips are in `userData.animations`):
```js
engine.assets.manifest({ models: { hero: '/models/hero.glb', dog: '/models/dog.glb' } });
const hero = await engine.assets.model('hero');
```

## 2. Mapping: game action names -> whatever the asset calls its clips
States are the mapping. The left side is what your game says (`idle`, `attack`, `hurt`), the right side is the clip name in the file, so a new model only changes the right side:
```js
states: { idle: { clip: 'Idle_Sword' }, attack: { clip: 'Sword_Slash', loop: false }, hurt: { clip: 'HitRecieve', loop: false }, death: { clip: 'Death', loop: false } }
```
- A clip name also matches the part after the last `|`: Blender / FBX2glTF exports `CharacterArmature|Idle`, you write `Idle`.
- Dev checks: a state whose clip is not in the model warns at `assets.animate()` with the available clip names (`state "attack" maps to a missing clip ... (available: Death, Idle, Roll, ...)`); `go('atack')` / `sync('atack')` warn ``did you mean `attack`?`` and return null.
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
For smooth walk/run blending, use `animation` instead of `clips` and write a `move` blend tree (when the model has no walk/run states, move is used automatically; the `speed` parameter is in m/s):
```js
engine.characters.createPlayer({ ...presets.player.thirdPerson, model: hero, animation: { states: {
  idle: { clip: 'Idle' },
  move: { blend: [{ clip: 'Walk', at: 1.5 }, { clip: 'Run', at: 6 }], param: 'speed', sync: true },   // sync: align footsteps
  jump: { clip: 'Jump', loop: false },
} } });
```
The default transition time comes from the style pack's `style.character.animation.fade`.

**By asset name.** `model` also takes the name of a registered model asset, and a style pack can set `style.character.model: 'hero'` as the default for every character (a per-character `model` wins). The character is built at once with the placeholder body (the style's `create()` or the gray capsule); when the asset loads, a skeleton-correct copy replaces it under the same root, so position, facing, state, collision and the world view stay. Then `ready` turns true, `whenReady` settles and `character:model` is emitted. A name missing from a registered manifest throws with the registered names; a failed load keeps the placeholder and warns once; a character disposed before loading ends never gets the model.
```js
engine.assets.manifest({ models: { hero: '/models/hero.glb' } });
const p = engine.characters.createPlayer({ ...presets.player.thirdPerson, model: 'hero' });        // placeholder now, the hero once loaded
await p.whenReady;                                                  // p.anim is set from here (unless the load failed)
```

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
**Gameplay timing never reads the animation**: the mixer advances per frame and `anim:end` is emitted per frame, so dropped frames, fast-forward (step's frameEvery) and a model being torn down when it is far away all make it drift from game time. When an attack lands, cooldowns, recovery and "finish the swing before moving" are timed in fixed steps:
```js
engine.input.define('attack', ['KeyF', 'Mouse0'], 'Attack');      // no module binds it for you
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
Who owns the clock: **gameplay**. An action timeline counts `t` in fixed-step seconds (recipe 06) and decides hit windows, i-frames and when the action ends; the animation only shows `t`.
`anim.sync(state, t)` poses `state` at gameplay time `t`: the clip does not advance or end by itself (no `anim:end`), and `go()` / `action()` leave it alone, so a character's per-frame locomotion cannot override it. `sync(null)` hands control back; the next `go()` switches as usual. Entering a synced state cross-fades like `go()` (the `transitions` table applies).
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
- Calibrate `timing` once by looking: sync the raw clip (no timing) at a few `t` and watch the weapon hand (`describe()` or a bone's world position); put the down-swing inside the hit phase.
- Pause, fast-forward, hit-stop (t stays still), loading mid-action and replays all line up, because the pose is a pure function of `t`.
- Looping states wrap `t`, one-shots clamp it to the clip.

Use `anim:end` only for presentation (change an expression, play the next clip). Native objects: `anim.mixer` (AnimationMixer), `anim.actions` (clip name -> AnimationAction). Things without a skeleton that only move/rotate as a whole use `engine.timeline.tween`, not an Animator.

## 6. Verify
- `anim.describe()` -> `{ state, clip, time, progress, driven, t, weights }` (clip seconds, 0-1 progress, whether sync drives it, the last gameplay t, each fading state's share); the player's is in `describe().player.anim`.
- In a test: `engine.pause(); anim.go('move'); engine.step(0.4)`, then look at `anim.state` and `anim.actions.get('Walk').getEffectiveWeight()` (all clip weights sum to 1).
- Characters: `describe().player.state` (idle/walk/run...) matches `engine.player.anim.state`.
- Related tests: `npm test -- "Animation state machine"` (in the engine repository: two-bone figure built in code, `packages/engine/tests/vehicle/` `makeRig()`) and `npm test -- 骨骼动画链路` (a real CC0 glTF character, `packages/engine/tests/anim/`: mapping, cross-fade, sync, alignment of the slash with the hit phase, dev warnings).

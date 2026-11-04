# Camera: first / third person, top-down strategy, fixed shots, switched at runtime

**In this recipe**: 1. Press V to switch between first and third person · 2. What the engine does for you when switching · 3. Other common things ·
4. Over the shoulder, lock-on framing, mouse lock · 4b. Looking up, ground and walls, driving the view yourself · 5. Take over the player ·
6. Orthographic view, and taking the camera over yourself · 7. Your own camera module

Four cameras; the kind names are always: `'follow'` third-person follow · `'firstPerson'` first person · `'rts'` top-down strategy · `'fixed'` fixed shots.
Pick one at the start: `openWorld({ camera: 'firstPerson' })`, or by hand `engine.use(followCamera({ distance: 10 }))` /
`firstPersonCamera({ height: 1.7 })` / `rtsCamera()` / `fixedCamera({ shots })`.
**There is exactly one entry point for changing camera in the game: `engine.setCamera(kind, options?)`**, no restart needed.

## 1. Press V to switch between first and third person (copy it)
```js
engine.input.action('toggleView', { label: '切换视角', keys: ['KeyV'] });
engine.onFrame(() => {                                   // UI-type actions read pressed in onFrame
  if (!engine.input.pressed('toggleView')) return;
  engine.setCamera(engine.cameraRig.kind === 'follow' ? 'firstPerson' : 'follow');   // kind is the current kind
});
```
Starting in first person and switching later: `openWorld({ camera: 'firstPerson' })` can still `setCamera('follow')`; you don't need to install two cameras.

## 2. What the engine does for you when switching
- **Target and heading carry over**: the followed character stays the same; the horizontal heading (`yaw`) is carried over, so there is no sudden turn
  after switching. Pitch means different things for each camera and is not carried over.
- **First person hides the body but keeps the shadow**: the character model is moved to a dedicated layer (`hideLayer`, default 30) that the camera
  cannot see but the shadow camera can; a model that loads later is hidden too. When you switch away the body shows again immediately.
- **Mouse lock**: switching to first person (a key press counts as a user gesture) locks the mouse automatically, Esc leaves; switching away releases
  it. No lock on phones.
- **Field of view (fov)**: switching away returns to the value from when the camera was installed; the first-person / strategy cameras each set it
  from their own `fov` option.
- **Settings are kept**: the camera you switched away from is kept, so switching back keeps the zoom distance and pitch. To use a different set of
  parameters pass options (that camera is rebuilt with the new parameters):
```js
engine.setCamera('firstPerson', { height: 1.7, fov: 80 });
engine.setCamera('follow', { distance: 8, pitch: 0.3 });
```
- A wrong kind name throws and lists the valid ones; a wrong option name gets the closest name suggested in development.

## 3. Other common things
- **Cycling through several**:
  `const VIEWS = ['follow', 'firstPerson', 'rts']; engine.setCamera(VIEWS[(VIEWS.indexOf(engine.cameraRig.kind) + 1) % VIEWS.length]);`
- **A fixed camera needs shots first**: `engine.setCamera('fixed', { shots: { hall: { position: [0, 6, 12], lookAt: [0, 0, 0] } }, start: 'hall' })`.
- **Camera-specific methods** exist only after switching: `engine.cameraRig.lookAt(position)` (first person), `cut('name')` (fixed shots),
  `screenToGround(...)` (rts). Check `kind` before calling.
- **Teleport, then lookAt**: `await engine.stream.teleport(p); engine.cameraRig.lookAt(target);` works in that order: `lookAt` aims from the body's
  current position, not from the last drawn frame. Call it after the move (the angles do not follow later moves).
- **Player movement direction follows the camera**: `engine.cameraRig.forward()` / `right()` change automatically after switching.
- **Cutscene takeover**: while anyone holds `engine.takeCamera(owner)` (`engine.cameraOverride` is not null) the camera module leaves the camera alone; see [the engine API](../api/engine.md).
- **Shooting games**: bind first-person firing to a mouse-button action, see `19-shooting-picking.md`.

## 4. Over the shoulder, lock-on framing, mouse lock (follow camera)
```js
engine.use(followCamera({ distance: 3, shoulder: 0.7, pitch: 0.15, pointerLock: true }));   // shooter / action-adventure view
engine.cameraRig.shoulder = -0.7;       // switch shoulders at any time (plain property)
engine.cameraRig.frame(enemy.object);   // lock-on: turn to "behind the player, looking at the enemy"; frame(null) lets go
```
- **`shoulder`**: meters the aim point (and so the camera) moves to the right along `right()`; negative = left, 0 = centered (default).
- **`pointerLock`** (default false): a click on the canvas locks the mouse, so moving it turns the view with no dragging; Esc releases, and `engine.page.releaseLock()` releases from code without opening the pause menu. Not on phones. If the browser refuses the lock the camera falls back to dragging; `describe().camera.pointerLock` is a state machine: `state` is `off` / `unsupported` / `waiting-click` / `requesting` / `locked` / `refused`, plus `covered` (what sits on the canvas centre and eats the click), `cameraOverride` (a takeover blocks locking) and `lastFailure { reason, agoSec }`; the text line shows the same.
  The press that locks is swallowed (no `Mouse0`, no click) so it cannot attack or fire; `swallowLockClick: false` delivers it.
  Leave it off when the mouse buttons are for UI or clicking the ground.
- **`yaw` means which side of the player the camera is on**: `camera = focus + (sin yaw, cos yaw) * distance`, so the camera looks along
  `forward() = -(sin yaw, cos yaw)`. To make it look toward a direction, negate it; better not to compute it at all and use `frame(target)`.
- **`frame(target, { strength = 6 })`**: `target` is an Object3D or `{ x, z }`; call it once when the lock starts, not every frame. While framing,
  mouse / stick yaw is ignored and a `yaw` you write directly is pulled back, because `frame()` owns the heading; `frame(null)` hands it back.
  `forward()` turns with it, so camera-relative movement strafes around the target.
- Only the follow camera has `frame`, `shoulder` and `pointerLock`; check `engine.cameraRig.kind === 'follow'` after a runtime switch.

## 4b. Looking up, ground and walls, driving the view yourself (follow camera)
```js
engine.use(followCamera(presets.camera.thirdPersonAction));   // locked mouse, look up ~60° and down, ground shortens the arm, walls pull in
engine.use(followCamera({ minPitch: -0.9, ground: 'shorten' }));   // or the same idea on your own options
```
- **Pitch sign**: positive = the camera is above the look point looking down; **negative = looking up**. Looking up needs `minPitch < 0`.
- **`ground`** decides what happens when the camera would go below the ground:
  `'shorten'` slides it along the arm toward the player (the view direction is kept, so you really look up);
  `'raise'` lifts it straight up (the view direction changes: from flat ground you cannot look up);
  `'none'` leaves it; a function `facts => position | null` gets `{ position, lookPoint, dir, arm, distance, groundY, clearance, surface, rig }`.
  Default: `'shorten'` when `minPitch < 0`, otherwise `'raise'` (the older behaviour, fine for a camera that never looks up).
- **Walls** (with `collision()` installed) pull the arm in at once and let it out slowly; the shortest arm is `collision({ cameraMin })` (default 1.5 m).
  Every `addCircle` / `addBox` / `addSegment` collider counts as a wall. Give the ones the camera may pass through `occluder: false`
  (`engine.collision.addCircle(tree, { radius: 0.4, occluder: false })`, or `collide: { circle: 0.4, occluder: false }` on a content prop or template): walkers are still stopped, the arm ignores them. A dense forest of
  blocking trunks collapses the camera onto the player; `collision({ canopyHeight })` covers only the terrain's own trees.
- **Close-up**: when the camera ends up nearer than `hideTargetNear` (default 0.9 m) to the look point, the followed object is hidden from the
  camera (shadow stays, layer `hideLayer`); `hideTargetNear: 0` turns it off.
- **Drive the view from game code**: `engine.cameraRig.setView({ yaw, pitch, distance })` (clamped to the pitch / zoom ranges) and
  `getView()` → `{ yaw, pitch, distance, arm, lookPoint, look }` (`look` is the 3D view direction, `arm` the actual length this frame).
  With `mouseLook: false` the built-in mouse / stick look and wheel zoom are off and the game owns yaw and pitch (call `setView` every frame from `onFrame`).

## 5. Take over the player: your own movement, facing and lock-on
The engine has no default here: `createPlayer` needs `control` (a preset such as `presets.player.thirdPerson` gives keys relative to the camera, Shift
run, Space jump, turning toward where it walks and `cameraFollow: true`). Each piece below replaces one part and keeps the rest (world record, saving,
`describe().player`).
```js
import { pickTarget, switchTarget } from 'threedog';

// how the input steers the player: 'camera' (keys relative to the camera) | (player, input, dt) => ({ x, z, run? }) | null (stand still)
let lock = null, hitStun = 0, knockX = 0, knockZ = 0;
const player = engine.characters.createPlayer({ cameraFollow: true, faceMode: 'manual', control: steer });   // moveInput().run reads the bound 'run' action
engine.input.bind({ lockOn: ['KeyQ'], switchTarget: ['KeyR'] });   // no module binds a key by itself
const enemies = () => engine.world.query({ kind: 'enemy', near: player.position, radius: 20 });

function steer(player, input, dt) {                    // called once per fixed step while the input is in charge of the player
  const m = engine.characters.moveInput();             // the 'camera' key direction as a value, relative to the camera (a reused object: copy x / z if you keep it)
  if (engine.input.pressed('lockOn')) {                // pick what is in view; press again to let go
    lock = lock ? null : pickTarget(player, engine.cameraRig.forward(), enemies(), { radius: 15 });
    engine.cameraRig.frame(lock ? engine.world.view(lock.id) : null);
  }
  if (lock && engine.input.pressed('switchTarget')) lock = switchTarget(player, engine.cameraRig.forward(), lock, enemies(), 1) ?? lock;
  player.faceMode = lock ? 'target' : 'move';          // 'move' toward velocity | 'camera' along the camera | 'target' toward faceTarget | 'manual' only face() turns it
  player.faceTarget = lock ? engine.world.view(lock.id) : null;
  if (hitStun > 0) { hitStun -= dt; player.push(knockX, knockZ, dt); return null; }   // knockback / roll: fixed velocity, never turns
  return m;                                            // the engine calls player.move() with it (one move per step)
}
```
- **`control`** is how the input steers the player: `'camera'` or a function. A function keeps jump and vehicles and only replaces direction
  and speed (a side-scroller returns `{ x: input.axis.x, z: 0 }`); to wrap the camera-relative keys use
  `control: (p, input) => busy ? null : engine.characters.moveInput()`. It is given once; for a while-it-lasts takeover (a scripted walk, a
  roll, a tutorial) take the player's control instead: `engine.control.take(player, { owner: 'roll', layer: 'script', step })`, then
  `h.remove()` gives the keys back (recipe 57). Calling `player.move()` yourself while the input holds it is `[control-bypass]`. Leaving
  `control` out throws `[player-control]`.
- **`cameraFollow: true`** points the camera module at the player (again after a vehicle and on a new session); without it the camera stays where the
  game puts it (`engine.cameraRig.follow(obj)`), and dev builds warn once if a camera is installed and the option was left out.
- **`faceMode`** is a plain property of every Character (NPCs too), change it per state. `player.face(angle)` turns at once (0 = +Z, PI / 2 = +X),
  `face(target)` toward a point; with `'manual'` that is the only thing that turns it.
- **`push(vx, vz, seconds)`** moves at a fixed velocity for that long, ignoring the direction given to `move()`; gravity and collision still apply.
  When you push again every fixed step, pass `dt`.
- **`pickTarget` / `switchTarget`** are pure functions: they return the candidate itself (anything with a `position`) or null. The game keeps the
  current target and its own rules, such as "let go beyond 20 m" or "target died, pick the next".
- The engine already calls `player.animate(dt)` every frame; a module with its own loop over characters must skip the player, or the walk cycle runs
  twice as fast.
- Test without a keyboard: `engine.input.simulate('lockOn'); engine.step(1 / 60); engine.input.simulate('lockOn', false)`.

## 6. Orthographic view, and taking the camera over yourself

**Orthographic (isometric / 2.5D) with the built-in rigs.** `projection: 'orthographic'` plus `size` (world units of view height) on the fixed and follow cameras.
The default stays perspective. On resize the view height stays `size` and the width follows the aspect.

```js
// one fixed isometric shot (shorthand for a single shot named 'main')
engine.setCamera('fixed', { position: [14, 14, 14], lookAt: [0, 0, 0], projection: 'orthographic', size: 16 });
// per shot: shots: { hall: { position, lookAt, projection: 'orthographic', size: 12 }, yard: { position, lookAt } }   // yard stays perspective
// follow the player from a fixed angle
engine.setCamera('follow', { pitch: 0.6, yaw: 0.8, distance: 20, projection: 'orthographic', size: 14 });
```

- `engine.camera` stays the one object everything holds (render, post, shadows, sky); it is flipped to an orthographic matrix, so `camera.isOrthographicCamera`
  is true, `camera.left/right/top/bottom` are set, and `camera.zoom` still zooms. `camera.fov` is ignored while it is on.
- Blends between two orthographic shots blend `size`; a perspective/orthographic mix switches to the target's mode at once. Switching rig kinds returns to perspective.
- Limits: on the follow camera the mouse wheel changes `size` (clamped to the `minDistance`/`maxDistance` ratio of the starting `distance`).
  The `fov` slider in the settings menu has no effect. Cascaded shadows, `dof` and `outline` handle orthographic depth; a custom post pass that assumes perspective depth must do the same.

**Placing the camera yourself (cutscene, photo mode, your own rig).** Take it with `engine.takeCamera(owner, { focus })`; the camera module leaves the camera alone until you `remove()` the handle.
Several holders can take it (a cutscene, then a named view on top): the latest is in charge, and removing it hands the camera back to the previous one, not to nobody.

```js
let t = 0;
const cam = engine.takeCamera('my-orbit', { focus: engine.player.position });   // focus (optional): where the world loads around
const frame = engine.onFrame(dt => {
  t += dt; engine.camera.position.set(Math.cos(t) * 12, 8, Math.sin(t) * 12); engine.camera.lookAt(0, 1, 0);
});
// done: frame.remove(); cam.remove();   // the rig resumes from its own state
```

To use your own `THREE.OrthographicCamera` instead of flipping `engine.camera`:

```js
const original = engine.camera, size = 12;
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
function fit() {   // the engine only updates engine.camera.aspect on resize, so keep your own camera's aspect here
  const s = engine.renderer.getSize(new THREE.Vector2()), a = s.x / s.y;
  ortho.left = -size * a / 2; ortho.right = size * a / 2; ortho.top = size / 2; ortho.bottom = -size / 2; ortho.updateProjectionMatrix();
}
const cam = engine.takeCamera('my-ortho');
engine.camera = ortho;   // the plain render path, cascaded shadows and modules read engine.camera live
ortho.position.set(10, 10, 10); ortho.lookAt(0, 0, 0); fit(); addEventListener('resize', fit);
// give it back: removeEventListener('resize', fit); engine.camera = original; cam.remove();
```

Swapping the object only works while no post effect is active: the post chain's scene pass keeps the camera it was built with. With post effects, use
`projection: 'orthographic'` above instead.

## 7. Your own camera module
Everything else in the engine reads only what `modules/camera/contract.js` lists from `engine.cameraRig`: `forward()` / `right()` (control: 'camera',
faceMode 'camera', targeting), `follow(object, opts?)` (createPlayer, getting in and out of a vehicle), `focusPoint()` (photo, where the world loads)
and `screenToGround(ndcX, ndcY)` (click-to-move, placing things; every built-in kind has it). A module named `cameraRig` with those five methods
replaces the built-in cameras: `tests/contract/fakeCamera.js` in the engine repository is one in ~35 lines and the player walks with it.

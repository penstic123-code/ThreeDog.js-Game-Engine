# Camera: first / third person, top-down strategy, fixed shots, switched at runtime

Four cameras; the kind names are always: `'follow'` third-person follow (default) · `'firstPerson'` first person · `'rts'` top-down strategy · `'fixed'` fixed shots.
Pick one at the start: `openWorld({ camera: 'firstPerson' })`, or by hand `engine.use(followCamera({ distance: 10 }))` / `firstPersonCamera({ height: 1.7 })` / `rtsCamera()` / `fixedCamera({ shots })`.
**There is exactly one entry point for changing camera in the game: `engine.setCamera(kind, options?)`**, no restart needed.

## 1. Press V to switch between first and third person (copy it)
```js
engine.input.define('toggleView', ['KeyV'], '切换视角');
engine.onFrame(() => {                                   // UI-type actions read pressed in onFrame
  if (!engine.input.pressed('toggleView')) return;
  engine.setCamera?.(engine.cameraRig?.kind === 'follow' ? 'firstPerson' : 'follow');   // kind is the current kind
});
```
Starting in first person and switching later: `openWorld({ camera: 'firstPerson' })` can still `setCamera('follow')`; you don't need to install two cameras.

## 2. What the engine does for you when switching
- **Target and heading carry over**: the followed character stays the same; the horizontal heading (`yaw`) is carried over, so there is no sudden turn after switching. Pitch means different things for each camera and is not carried over.
- **First person hides the body but keeps the shadow**: the character model is moved to a dedicated layer (`hideLayer`, default 30) that the camera cannot see but the shadow camera can; a model that loads later is hidden too. When you switch away the body shows again immediately.
- **Mouse lock**: switching to first person (a key press counts as a user gesture) locks the mouse automatically, Esc leaves; switching away releases it. No lock on phones.
- **Field of view (fov)**: switching away returns to the value from when the camera was installed; the first-person / strategy cameras each set it from their own `fov` option.
- **Settings are kept**: the camera you switched away from is kept, so switching back keeps the zoom distance and pitch. To use a different set of parameters pass options (that camera is rebuilt with the new parameters):
```js
engine.setCamera?.('firstPerson', { height: 1.7, fov: 80 });
engine.setCamera?.('follow', { distance: 8, pitch: 0.3 });
```
- A wrong kind name throws and lists the valid ones; a wrong option name gets the closest name suggested in development.

## 3. Other common things
- **Cycling through several**: `const VIEWS = ['follow', 'firstPerson', 'rts']; engine.setCamera(VIEWS[(VIEWS.indexOf(engine.cameraRig.kind) + 1) % VIEWS.length]);`
- **A fixed camera needs shots first**: `engine.setCamera('fixed', { shots: { hall: { position: [0, 6, 12], lookAt: [0, 0, 0] } }, start: 'hall' })`.
- **Camera-specific methods** exist only after switching: `engine.cameraRig.lookAt(position)` (first person), `cut('name')` (fixed shots), `screenToGround(...)` (rts). Check `kind` before calling.
- **Teleport, then lookAt**: `await engine.stream.teleport(p); engine.cameraRig.lookAt(target);` works in that order: `lookAt` aims from the body's current position, not from the last drawn frame. Call it after the move (the angles do not follow later moves).
- **Player movement direction follows the camera**: `engine.cameraRig.forward()` / `right()` change automatically after switching.
- **Cutscene takeover**: while `engine.cameraOverride` is not null the camera module leaves the camera alone; see `../api/cameraRig.md`.
- **Shooting games**: bind first-person firing to a mouse-button action, see `19-shooting-picking.md`.

## 4. Over the shoulder, lock-on framing, mouse lock (follow camera)
```js
engine.use(followCamera({ distance: 3, shoulder: 0.7, pitch: 0.15, pointerLock: true }));   // shooter / action-adventure view
engine.cameraRig.shoulder = -0.7;       // switch shoulders at any time (plain property)
engine.cameraRig.frame(enemy.object);   // lock-on: turn to "behind the player, looking at the enemy"; frame(null) lets go
```
- **`shoulder`**: meters the aim point (and so the camera) moves to the right along `right()`; negative = left, 0 = centered (default).
- **`pointerLock`** (default false): a click on the canvas locks the mouse, so moving it turns the view with no dragging; Esc releases. Not on phones. Leave it off when the mouse buttons are for UI or clicking the ground.
- **`yaw` means which side of the player the camera is on**: `camera = focus + (sin yaw, cos yaw) * distance`, so the camera looks along `forward() = -(sin yaw, cos yaw)`. To make it look toward a direction, negate it; better not to compute it at all and use `frame(target)`.
- **`frame(target, { strength = 6 })`**: `target` is an Object3D or `{ x, z }`; call it once when the lock starts, not every frame. While framing, mouse / stick yaw is ignored and a `yaw` you write directly is pulled back, because `frame()` owns the heading; `frame(null)` hands it back. `forward()` turns with it, so camera-relative movement strafes around the target.
- Only the follow camera has `frame`, `shoulder` and `pointerLock`; check `engine.cameraRig.kind === 'follow'` after a runtime switch.

## 5. Take over the player: your own movement, facing and lock-on
The engine has no default here: `createPlayer` needs `control` (a preset such as `presets.player.thirdPerson` gives keys relative to the camera, Shift run, Space jump, turning toward where it walks and `cameraFollow: true`). Each piece below replaces one part and keeps the rest (world record, saving, `describe().player`).
```js
import { presets, pickTarget, switchTarget } from 'threedog';

// who moves the player: 'camera' (keys relative to the camera) | 'none' (you call move) | (player, input, dt) => ({ x, z, run?, speed? }) | null
const player = engine.characters.createPlayer({ ...presets.player.none, cameraFollow: true, runKeys: ['ShiftLeft'] });   // runKeys: moveInput().run reads it
let lock = null, hitStun = 0, knockX = 0, knockZ = 0;
const enemies = () => engine.world.query({ kind: 'enemy', near: player.position, radius: 20 });

engine.onFixed(dt => {
  const m = engine.characters.moveInput();             // the 'camera' key direction as a value, relative to the camera (a reused object: copy x / z if you keep it)
  if (engine.input.pressed('lockOn')) {                // pick what is in view; press again to let go
    lock = lock ? null : pickTarget(player, engine.cameraRig.forward(), enemies(), { radius: 15 });
    engine.cameraRig.frame(lock ? engine.world.view(lock.id) : null);
  }
  if (lock && engine.input.pressed('switchTarget')) lock = switchTarget(player, engine.cameraRig.forward(), lock, enemies(), 1) ?? lock;
  player.faceMode = lock ? 'target' : 'move';          // 'move' toward velocity | 'camera' along the camera | 'target' toward faceTarget | 'manual' only face() turns it
  player.faceTarget = lock ? engine.world.view(lock.id) : null;
  if (hitStun > 0) { hitStun -= dt; player.push(knockX, knockZ, dt); player.move(0, 0, false, dt); }   // knockback / roll: fixed velocity, never turns
  else player.move(m.x, m.z, m.run, dt);               // with control 'none' you must call move() once per fixed step
});
```
- **`control: 'none'`**: the engine never calls `move()` or reads the movement keys for the player. A `function` keeps jump and vehicles and only replaces direction and speed (a side-scroller returns `{ x: input.axis.x, z: 0 }`); to wrap the camera-relative keys use `control: (p, input) => busy ? null : engine.characters.moveInput()`. `player.control` can be changed at any time. Leaving `control` out throws `[player-control]`.
- **`cameraFollow: true`** points the camera module at the player (again after a vehicle and on a new session); without it the camera stays where the game puts it (`engine.cameraRig.follow(obj)`), and dev builds warn once if a camera is installed and the option was left out.
- **`faceMode`** is a plain property of every Character (NPCs too), change it per state. `player.face(angle)` turns at once (0 = +Z, PI / 2 = +X), `face(target)` toward a point; with `'manual'` that is the only thing that turns it.
- **`push(vx, vz, seconds)`** moves at a fixed velocity for that long, ignoring the direction given to `move()`; gravity and collision still apply. When you push again every fixed step, pass `dt`.
- **`pickTarget` / `switchTarget`** are pure functions: they return the candidate itself (anything with a `position`) or null. The game keeps the current target and its own rules, such as "let go beyond 20 m" or "target died, pick the next".
- The engine already calls `player.animate(dt)` every frame; a module with its own loop over characters must skip the player, or the walk cycle runs twice as fast.
- Test without a keyboard: `engine.input.simulate('lockOn'); engine.step(1 / 60); engine.input.simulate('lockOn', false)`.

# Action game wiring: hp, attacks, enemy AI, drops and death without engine combat rules

The engine has no health, damage, hit detection or death. An action game writes those as its own rules on top of systems that already exist. The
working example is `examples/action/` (page `/action.html`, about 150 lines of rules in `main.js`, the room in `content/`); its test is
`tests/specs/action.mjs`.

## 1. What goes where
| Piece | Built on | In the example |
|---|---|---|
| The room, the enemy and its stats (hp, damage, drop) | content `templates` + `props` with ids (recipe 30) | `content/templates.js` `slime: { model, static: false, state: { hp, maxHp, damage, cooldown, drop } }` |
| Player hp, attack cooldown, game over | plain object + `engine.describe.add` + `engine.saves.register` | `const game = fresh()` |
| Attack, damage, enemy hit, death | ops with `can` / `run` (recipe 23), so keys, the dev bridge, MCP, tests and the AI run one rule | `player.attack`, `enemy.damage`, `enemy.attack`, `player.die` |
| Enemy AI (chase, face, strike) | `engine.world.simulate(kind, { near, channel? })` (channel: bullet time reaches it, section 4), a fixed step per near record; it strikes with `ops.run(..., { actor: rec.id })` | `world.simulate('slime', ...)` |
| Gameplay keys | content `actions` (`attack: { keys: ['Mouse0', 'KeyF'] }`), read with `input.pressed` in `onFixed` | `onFixed` runs `player.attack` |
| Drop | `engine.pickups.spawn(at, { give: item, id })` inside the death op; E picks it up through `interactions`, into the bag of whoever presses | `${id}-drop` |
| HUD, death screen, retry, save keys | `onFrame`: `hud.bar`, `toast`, `engine.session.newGame()` | the frame hook |

## 2. Rules that keep it replayable
- Damage, cooldowns and AI run in fixed steps or ops only (`onFixed`, `world.simulate`, `ops.run`), never in `onFrame`, so the result is the same at
  any frame rate and a save loads bit-identical.
- An enemy that dies is `world.remove(id)`: the save remembers it is gone. A per-step value (the enemy's cooldown) is written straight onto the record
  inside `simulate` or an op; a discrete one (its hp) goes through `world.set`.
- Hit detection is the game's: the example tests distance and the angle against the actor record's `facing`; a game with swords on bones would raycast
  or test shapes instead (recipe 19).
- `player.die` decides what death does. The example offers `respawn` (`player.placeAt(spawn)`, full hp), `restart` and `gameover` (both end in
  `engine.session.newGame()`, which is async flow and so runs from the frame hook, not inside the op).

## 3. Mouse attack and pointer lock
`followCamera({ ...presets.camera.overShoulder })` locks the mouse on a click. While locked, mouse buttons still arrive as `Mouse0`..`Mouse4` keys, so
`attack: { keys: ['Mouse0'] }` works in both states. The click that takes the lock is itself a `Mouse0` press and swings once; a game that does not
want that ignores attacks until the `page:pointerlock` event reports `locked: true`. `presets.player.aim` turns the player toward where the camera
looks, so a swing goes where you aim. The rules do not need the picture: `?picture=none` runs them under the engine's placeholder lights; the whole picture is
`examples/action/picture/`.

## 4. Movement: jumps, speed effects, bullet time, platforms, falling
```js
createPlayer({ ...presets.player.thirdPerson, maxJumps: 2 });                       // double jump: the same jump key twice
engine.player.launch(16, { owner: 'pad' });                                          // a jump pad / spring
engine.mod('move.speed', { owner: 'haste', id: 'player', mul: 1.2, for: 5 });       // haste for 5 s; no id = every character (mud, wind)
engine.time.channel('enemies');                                                     // once, before anything uses it: a channel of your own
engine.mod('time.enemies', { owner: 'bullet-time', mul: 0.35, for: 2 });            // bullet time: enemies on channel 'enemies' at 35%
engine.world.simulate('slime', { near: chase, channel: 'enemies' });                 // world records (the enemy AI above) get the slowed dt
engine.onFixed(dt => moveShots(dt), { channel: 'enemies' });                        // your own enemy logic on the same slowed dt
engine.characters.support(liftMesh);                                                 // a moving platform: move liftMesh any way, riders follow
engine.player.mover = 'manual'; /* a cutscene, your own physics */ engine.player.mover = 'simple';   // take over, give back
```
- **Jumps** (all public, no private fields): `jump()` is buffered for `jumpBuffer` s (default 0.12) and uses coyote time (`coyoteTime`); in the air it is an
  air jump while `maxJumps` allows, at `airJumpSpeed` (default `jumpSpeed`). `jump({ air: false })` = ground only. `addJumps(n)` / `resetJumps()` for
  pickups and wall touches, `launch(speed, { owner })` for jump pads (emits `character:launch`), `jumpState()` reads `{ grounded, coyoteLeft,
  bufferLeft, jumpsUsed, jumpsLeft, vy }`. `character:jump` carries `{ air, index }`. Writing `player.vy` yourself is fine: it is an impulse.
- **Speed, gravity, jump height, can-jump**: the fields (`player.speed = 6`) are the game's base values; effects go through `engine.mod('move.speed' |
  'move.runSpeed' | 'move.gravity' | 'move.jumpSpeed' | 'move.canJump', { owner, id?, set | add | mul | clamp, for? })`, so stamina (run = walk), haste
  x1.2 and mud x0.6 combine and end in any order. `player.stat('speed')` reads the result. A stun: `engine.mod('move.canJump', { owner: 'stun', id:
  'player', set: 0, for: 0.8 })`. `move()` takes no speed argument; the direction's length (0-1) scales the speed.
- **Bullet time / time channels**: a character the engine drives moves and animates on `character.channel` (player `'player'`, NPCs `'world'`), so
  `engine.mod('time.enemies', { owner: 'bullet-time', mul: 0.35 })` slows NPCs added with `npcs.add({ channel: 'enemies' })` (far ones too) and
  `onFixed(fn, { channel: 'enemies' })` code; world records follow only with `world.simulate(kind, { near, channel: 'enemies' })` (without it they
  keep the 'world' pace while everything else slows); `clock.after(1, 'poison:tick', data, { channel: 'enemies' })` slows a timer with them. The player keeps
  full speed unless you mod `'time.player'`. Your own `player.move(x, z, run, dt)` uses the dt you pass. Effects end in any order (recipe 55).
- **Platforms**: `characters.support(object, { id?, safe?, carry?: 'position' | 'position+yaw', inherit? })` returns `{ id, remove() }`. The rider
  compares the platform's matrix with the one it recorded, so it does not matter whether the platform moves in your `onFixed` before or after the
  player, in a timeline or in physics. `player.support` says what it stands on (`kind: 'ground' | 'platform' | 'collider' | 'water' | null`, the
  platform's `velocity`); jumping off keeps the platform's speed until landing. With `mover: 'rapier'` give the platform a collider as well.
- **Falling out**: `createPlayer({ ..., fall: { belowY: -20 } })` fires `character:fall { character, safe, preventDefault() }` once and puts the player
  back on `player.safeGround` (the last spot it stood still on safe, unmoving ground; saved). Take hp in the listener; `preventDefault()` to handle it yourself.
- **Your own controller**: `mover: 'manual'` = you write the position; `move()` then only updates `grounded`, `support` (platforms still carry),
  `safeGround` and the fall check. Switch at any time (`player.mover = 'manual'` / `'simple'`): a cutscene, a grapple, a ladder.
- **Knockback / dashes**: `player.push(vx, vz, seconds)`. Writing `player.velocity` or `player.vy` is an impulse: the mover keeps integrating from
  it next step (horizontal velocity is then steered back toward the input), so it never fights you; for full control use `mover: 'manual'`.

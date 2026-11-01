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
| Enemy AI (chase, face, strike) | `engine.world.simulate(kind, { near })`, a fixed step per near record; it strikes with `ops.run(..., { actor: rec.id })` | `world.simulate('slime', ...)` |
| Gameplay keys | content `actions` (`attack: { keys: ['Mouse0', 'KeyF'] }`), read with `input.pressed` in `onFixed` | `onFixed` runs `player.attack` |
| Drop | `engine.inventory.spawnPickup(item, at, { id })` inside the death op; E picks it up through `interactions` | `${id}-drop` |
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
looks, so a swing goes where you aim. Without a style pack the room and enemy are gray (`?style=none`); colors come from a style part
(`examples/action/look.js`).

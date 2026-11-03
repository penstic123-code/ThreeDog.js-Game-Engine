# Who steers a character: engine.control

Every character (the player, an NPC, a hand-built `Character`) has one control slot. One owner is in charge of it at a time, and only that
owner moves the character. Take it, steer, give it back:

```js
// a quest walks the guard to the gate; its schedule waits and carries on afterwards
const escort = engine.control.take(guard, { owner: 'escort', layer: 'script', step: (dt, ch) => ({ x: 0, z: 1 }) });
escort.remove();

// a roll: the keys pause for 0.4 s, then come back by themselves
const roll = engine.control.take(engine.player, { owner: 'roll', layer: 'script', step: () => ({ x: 0, z: 1, run: true }) });
engine.clock.after(0.4, () => roll.remove());

// no step: move it from your own code; move() does nothing while someone above holds it
const h = engine.control.take(drone, { owner: 'ai', layer: 'script' });
engine.onFixed(dt => h.move(dir.x, dir.z, false, dt));

engine.control.of(engine.player);   // { owner: 'timeline', layer: 'cutscene', waiting: [{ owner: 'walkTo', layer: 'script' }, { owner: 'player-input', layer: 'base' }] }
engine.describe().control;          // the same for every held character, by id
```

What to remember:
- **Layers, lowest first**: `base` (the character's own driver: the player's keys, an NPC's behaviour) < `script` (walkTo, quest scripts, AI
  orders; the default) < `cutscene` (timeline) < `net` (another machine drives it). The highest holder is in charge.
- **A higher holder pauses the lower one, it does not cancel it.** When the cutscene ends, the walk it interrupted goes on; when the walk
  arrives, the keys work again. Nobody has to remember what to restore.
- **One owner per layer.** Two different owners on the same layer is `[control-conflict]` in development, naming both: end the old one first
  (`h.remove()`), or take another layer. The same owner taking again just replaces its own hold.
- **A held character moves only through its holder.** `character.move()` from anywhere else is `[control-bypass]` in development: the bug where
  keys, a walk and a cutscene all pushed one body in the same step and the last one won.
- **`step(dt, ch)`** returns `{ x, z, run }` (world direction, length 0-1 scales the speed), `null` (stand still: gravity and the idle pose go on)
  or `false` (do not move this step: you placed it yourself). `dt` is the character's time channel, so bullet time slows it too.
- **Inside a module** use `ctx.control.take(ch, { ... })`: the owner defaults to the module, and everything it holds is handed back when the
  module goes (unloaded, rolled back, replaced).

## Who takes what

| Driver | Layer | Owner | Notes |
|---|---|---|---|
| `createPlayer({ control })` | base | `'player-input'` | `control` is `'camera'` or `(player, input, dt) => ({ x, z, run })`; jump and driving live here too |
| NPC behaviour (schedule, wander, your own) | base | `'npcs'` | paused near and far while anything above holds the NPC; kept by NPC id, so it survives the model being rebuilt |
| `character.walkTo(target)` | script | `'walkTo'` | paused under a cutscene (no progress, no stuck clock), resumes after |
| `timeline.play(steps, { actors })` | cutscene | `'timeline'` | `actors` defaults to `[engine.player]`; `[]` drives nobody; a `path` step adds its character. While the player is an actor, the `'cutscene'` input context is up |
| `net()` | net | `'net'` | a client holds every character the host drives; the host holds each peer's avatar. Taking one is `[control-net]`: change it with an op the host runs |

Two cutscenes running at once are one owner (`'timeline'`), counted per character, so they never conflict; the slot goes back when the last
one using that character ends.

## Control is not the body

**Control** decides where to go. **The mover** (`character.mover = 'simple' | 'rapier' | 'manual'`) decides how the body gets there: integration,
collision, gravity. They never mix: a cutscene can take a character whose mover is `'rapier'`, and a `'manual'` mover can be steered by the
player's input. `mover: 'manual'` is for a game that writes the position itself; it still needs someone in control to call `move()` each
step (a `control` function returning `null` does).

## Vehicles

Getting into a vehicle does not change who controls the character: the player's input (`'player-input'`) drives the car while seated. A
cutscene that takes the player while driving stops the steering; the rider stays on its seat.

## Saves

Holds are not saved: they are running code (a walk, a cutscene, a quest step), and that code takes control again after a load. A walk is
cancelled by a load (`walkTo` resolves `'cancelled'`).

# Stream sources: what is loaded where (teleport, far camera)

Part of the world data recipe (`18-world.md`): world records never unload, this page is about the models, terrain and colliders built around them.

Three things are kept apart: **what is shown** (terrain chunks, models, stream entries, hlod), **what has colliders** (rigid terrain colliders, chunk
collision), and **world data** (records and their near / far simulation, which follows `world.anchor` and never unloads). Every loader reads the same
list, the sources of `engine.stream`:

| Source | Shows | Colliders |
|---|---|---|
| `engine.stream.player` (built in: `world.anchor`, else the player, else `engine.focus`) | full | yes |
| `engine.stream.camera` (built in: `engine.focus`) | full | no |
| `engine.stream.source(p, { radius, detail, physics, until })` | `detail: 'full'` (default) or `'simple'` (terrain and hlod proxies only) | `physics` (default true for `'full'`) |

```js
// teleport: the player moves only after the destination's terrain, collision and nearby models are ready
await engine.stream.teleport([800, 0, 300]);

// the same by hand (for a door animation or a fade while it loads)
const dest = engine.stream.source([800, 0, 300], { radius: 64 });
await dest.whenReady;
engine.player.placeAt([800, 0, 300]);
dest.remove();

// a photo camera far away: a picture, no colliders; removed when photo mode ends
engine.stream.source(photoCam, { physics: false, until: () => !photoMode.active });

// a far view from a tower: terrain and hlod proxies only
const vista = engine.stream.source(towerTop, { detail: 'simple', radius: 600 });
```
- `radius` caps every loader's own range around that source (terrain view distance, present radius, `stream.radius`); without it each loader uses its own.
- `source.ready` is checked at the end of each frame; a new source counts after one full frame, so every loader has seen it. Fixed steps must run
  (collision takes effect on a tick), so do not wait while `engine.pause()` is on without stepping.
- Leaving a place and coming back is safe: models unload, but records (an opened chest, a dropped item, a removed rock) stay in `engine.world` and the
  models are rebuilt from them.
- Module authors with their own distance-based loader: read `engine.stream.sources({ detail: 'full' })` / `sources({ physics: true })` and
  `s.reach(range)`, and register `engine.stream.readyCheck(name, s => ...)`. Do not read `engine.focus` or the player position for loading.

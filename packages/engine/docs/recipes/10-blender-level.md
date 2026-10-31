# Importing Blender models and levels

## 1. Place things in Blender by naming convention (the level module recognizes names)
| Purpose | How to name it |
|---|---|
| Walkable ground | Object name contains `ground` `floor` `road` `terrain` `stair(s)` `ramp`, or custom property `walkable = true` (if there are none, every mesh counts as walkable); ground type = custom property `groundType`, otherwise the material name |
| Walls / obstacles | `col_xxx`: a hidden collision box that only blocks the player (hidden automatically after loading); or custom property `collider = true` (a visible object that also blocks) |
| Spawn point | Empty object `spawn` (or `spawn_2`...) |
| NPC position | Empty object `npc_店主` |
| Trigger zone | Empty object `trigger_门口`; the custom properties `shape` (cylinder/sphere/box), `radius`, `height` become trigger zone parameters |
| Other markers | Empty object `marker_宝箱`; all custom properties go into `userData` unchanged |
| Things a save must know (a door that opens, a rock that can be removed) | Custom property `template = 'door'` (an instance of a content template; its other custom properties fill the template's state) or `id = true` (the node itself is the model). The node becomes a world record with id `<level file name>/<node name>` (`town/door_front`), saved as a diff (needs `world()` installed, and `content()` for `template`); untagged meshes stay static scenery (recipe 30 §2) |

Export glTF/GLB (tick "Custom Properties") into `art/models/` (create it if missing).

## 2. Compression
`npm run assets` compresses to `public/models/<same name>.glb` (Meshopt geometry + WebP textures; `-- --ktx2` uses KTX2 textures). Object names and hierarchy are kept; faces are not reduced. Only changed files are processed; `-- --force` redoes everything.

## 3. Putting it in the game (main.js)
```js
import { createEngine, presets, level, collision, followCamera, characters, interactions, dialogue, triggers, content, hlod } from 'threedog';
engine.use(level({ url: '/models/town.glb' }), collision(), followCamera(), characters(), interactions({ ...presets.interactions.nearest }), dialogue(), triggers(), content(), hlod());
engine.events.once('level:loaded', () => {   // once: level:loaded fires again on every level change
  engine.characters.createPlayer({ ...presets.player.thirdPerson, spawn: engine.level.spawn });
  engine.content.load(data);                       // a place in content can be a marker name directly: { place: 'npc_店主' }
});
engine.start();
```
- Trigger zone data: write `{ 门口: { fromLevel: true, onEnter: { toast: '欢迎' } } }` in `<game>/content/triggers.js` (tag = the name after `trigger_`).
- Content validation (`npm run check`) cannot read the markers inside the .glb: marker names used in content need a one-line description in `content/places.js` (`npc_店主: 'the shopkeeper position in Blender'`);
  `fromLevel` trigger zones don't need `<game>/content/level.js` (the markers are in the .glb, validation skips them, and GAMEMAP notes "cannot be read statically"); `level.js` is only for code-built levels.
- `level:loaded` fires on every level change; for something done only once (creating the player) use `engine.events.once`. When the level changes, the old level's trigger zones and the like are deleted automatically (`level.track`); NPCs, pickups and props placed by marker only lose their model while their data stays (with a zone), and are rebuilt when you return to this level; things that were picked up / deleted stay gone.
- Get a marker in code: `engine.level.marker('marker_宝箱')?.position`, `engine.level.markersWith('npc_')`.
- Many buildings: install `hlod()`, which merges distant ones into a few meshes. For a navmesh see `12-navmesh.md`.
- A single model (not a level): `engine.assets.manifest({ models: { house: '/models/house.glb' } })`, `const h = await engine.assets.model('house', { static: true })` (static: registers it for rays).
- For models with skeletal animation see `13-animation.md`.

## 4. Grass and trees on a level
Without `terrain()`, `vegetation()` grows on its own chunks over whatever provides the ground: the level, a code-built ground (`engine.setGround`), or the flat default. Rules read `engine.surface / slope / groundType`, so pick the level's surfaces by ground type (a mesh's `groundType` custom property, else its material name) with `rule.biomes`, and limit the scatter with `area`:
```js
engine.use(level({ url: '/models/town.glb' }), vegetation({ area: { min: [-80, -80], max: [80, 80] }, viewChunks: 3 }), collision());
engine.vegetation.add('grass', { geometry: grassGeo, nearOnly: true, rule: { perChunk: 500, biomes: { lawn: 1 } } });
engine.vegetation.add('tree', { model: oak, rule: { perChunk: 6, biomes: { lawn: 0.6, park: 1 }, maxSlope: 0.4, collider: 0.4 } });
```
Chunks stream around `engine.stream` sources and stay one InstancedMesh per species per chunk (LOD, shadows and felling work as on terrain: `instanceAt` / `removeInstance`, saved). Collision and path planning see the trees through `engine.ground.forEachCollider`; a new level or `setGround` re-places them; after changing a ground function behind the same provider call `engine.vegetation.rebuild()`. Heights are unlimited unless the rule sets `minHeight / maxHeight`. Content `vegetation` works the same way. With `terrain()` installed, `vegetation()` takes no options (density and view distance are terrain options). Rapier (`rigid()`) bodies collide with them too (cylinders from `engine.ground.forEachCollider`, gone when felled).

## 5. Verify
- `npm run assets` prints each file's size before and after compression; a browser 404 appears in `.threedog/errors.log` (asset load failure).
- `describe()`: `ready` is true and `loading` is empty; the player's coordinates are at the spawn point; `nearby` contains trigger zones (`kind: 'trigger'`) and NPCs.
  Text version: `npm run shot -- /your-page.html --describe-only`.
- Collision: `engine.collision.walkable({ x, z })` is false inside a col_ box; ground: `engine.surface(x, z)` equals the step / floor height.
- Related tests: `npm test -- 关卡`, `npm test -- "compressed assets"`, `npm test -- HLOD`, `npm test -- "vegetation ground"`.

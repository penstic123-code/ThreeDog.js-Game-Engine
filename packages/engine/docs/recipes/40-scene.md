# Scene: what is in the world, where, and what a save keeps

The engine's three outward concepts are **Scene** (what stands in the world, where it is, how you interact with it), **Assets** (models, textures,
sounds, fonts: `05-props-bake.md` §3b) and **Style** (how it looks: `09-style-pack.md`). Content packs belong to Scene: they are the data form of it.
Patches, ops and world records are the scene's inner machinery; read them when you need them (`23-ops.md`, `18-world.md`).

## 1. Two doors into one scene
A scene object comes in either of two ways, and both end up in the same scene:

- **Plain three.js.** Build a mesh or group, call `engine.add(obj)`. Nothing else is required. This is the right way for anything your code rebuilds
  on every start.
- **A template.** Define it in `content/templates.js`, place it in `content/props.js` with an `id`, or create it during play with
  `engine.spawn(name, at)`. This is the right way for anything that must be saved, be editable without code, or exist in many copies.

The same windmill, both ways:

```js
// A. plain three.js: your code builds it on every start
const mill = buildWindmill();                       // THREE.Group
mill.position.set(20, 0, -10);
engine.snapToGround(mill);
engine.add(mill, { id: 'mill' });
engine.collision?.addCircle(mill, { radius: 1.3 });
engine.onFrame(dt => { mill.userData.blades.rotation.z += dt * 1.5; });
```
```js
// B. template: the definition is data; the model is a name in the asset manifest
// content/templates.js
export default { windmill: { model: 'windmill', collide: 'circle' } };
```
```js
// content/props.js
export default [{ id: 'windmill-hill', template: 'windmill', x: 20, z: -10 }];
```
```js
// main.js: a code-built model registered by name
engine.assets.manifest({ models: { windmill: buildWindmill } });
```
Route B gives the object an id, a source line (`engine.world.origin('windmill-hill')`), a save record and a place a future editor can write back to.
Route A gives you less ceremony and full three.js control.

## 2. What goes in content, what stays three.js
| Put it in content (templates, props, pickups, npcs, containers) | Write it as three.js (`engine.add`, `engine.scene.add`) |
|---|---|
| Must come back after a load, or the player can change it and the change must be saved | Rebuilt by your code on every start: lights, decoration, effects, bullets |
| Should be editable without a code change (position, state, copies) | Procedural or per-frame: particles, trails, shaders, a spinning blade |
| Many copies of one definition | A one-off with custom geometry or material logic |
| Has a state worth reading with `world.get(id)` | Pure presentation |

The rule check (R33) is deliberately narrow. It flags only the calls that would run again after a load and so duplicate saved data: `world.add`,
`engine.spawn`, `inventory.spawnPickup`, `npcs.add` and `entities.spawn` at startup. `engine.add`, `collision.*`, `rigid.*`, `interactions.add` and the
like are fine at startup.

## 3. Which state a save keeps
The registry (`41-thing-registry.md`) sorts every scene object into one of four kinds:

| Kind | What it is | A save keeps | A save loses |
|---|---|---|---|
| `record` | A world record: template instance, props entry, pickup, NPC, level node | The record's fields and position; the model is rebuilt from the template | Direct edits to the model; change the record instead (`world.set`) |
| `code` | Added by your code with a stable id (`engine.add(obj, { id })`) during setup | Moves, visibility and deletion done through `thing.set` / `thing.remove` | Geometry, material changes, children added later, `userData`, state in closures (inside an `onFrame` callback) |
| `session` | Added by your code without an id, or during play | Nothing: it exists for this session only | Everything. After a load it does not come back. To keep it, make it a template and call `engine.spawn` in an op |
| `engine` | Owned by an engine module (water, sky, terrain) | Managed by that module | Do not edit it directly |

Writing `mesh.position.x = 3` in code always works; it just is not saved and cannot be undone.

## 4. The calls
- `engine.add(obj, { id })`: registers `obj` under a stable id (`engine.add(obj)` works too: it gets a session id `obj#n`, never saved; `obj.name` is not an id).
- `engine.thing(idOrObject)`: what is this? Returns `{ id, kind, owner, at, phase, saved, keeps, loses, edit, object }` for any id or object; `engine.pick(x, y).thing` gives the same.
- `thing.set` and `thing.remove`: ops that move, show, hide or delete a registered object, undoable; for `code` objects they are saved as overrides.
- `engine.remove(obj)` forgets the object in the registry too.
Details and what a save keeps: `41-thing-registry.md`.

## 5. Moving from three.js to a template
When an object turns out to need saving, editing or many copies: register its builder as a model (`assets.manifest({ models: { windmill: buildWindmill } })`),
write a template, add a placement with an id. Delete the `engine.add` line. Nothing else in the game changes.

## 6. Verify
`threedog check` flags the startup calls above; `engine.world.origin(id)` and `engine.pick(x, y).thing` say where a record came from (`30-templates.md`
§5); `engine.world.query({ kind: 'windmill' })` lists the records a save would hold.

## 7. Why is this mesh this colour? (material provenance)

`engine.inspect.scene()` / `npx threedog scene` list, for each mesh, one `material:` line and the renderer line (tone mapping, exposure; the same text as `describe().render`). Diagnostics only: nothing about the look changes.

```
renderer: ACES (style) exposure 1.1 (style) shadows soft (engine)
✓ roof [Mesh] (4, 3, 0) r=2 · MeshLambertMaterial/roof
    material: roof from pack-spec [color] · MeshLambertMaterial #3b5168 · map x color #3b5168 (vertexColors off) · map (base colour)
      note: map already carries colour and color #3b5168 is not white: the result is map x color (fine when it is a tint)
```

- `from` is `pack-spec | pack-instance | pack-function | call-params | default`, `keys` the params the call passed; both come from `userData.materialSource`, which `makeMaterial` records (a material made by hand shows `unknown`).
- `--json` carries `material.info[]` per mesh: role, from, keys, type, color, maps (base colour vs detail), vertexColors, side, transparent, opacity, colorPath, notes.
- The tint note is not an error: a map times a non-white colour is how tinting works.

## 8. When to write plain three.js directly, and which integrations you lose

Plain three.js is always allowed (`engine.scene`, `engine.renderer`, `engine.camera` are the real objects; `engine.add(obj, { id })` keeps it saveable). Write it directly for a one-off effect, a special mesh, a shader nothing else shares. What you give up depends on how the material or pass was made:

| You wrote | Not applied to it |
|---|---|
| `new THREE.MeshStandardMaterial(...)` (not `makeMaterial` / a look material) | wind sway, snow and season cover, cloud shadows, the engine fog hook, cascaded shadows, `look.surface` lighting and detail, `look.materials` roles, `debug.view` modes |
| your own `EffectComposer` / render call | `engine.post` effects, `look.post`, adaptive resolution, photo mode, `describe().render.post` |
| `renderer.toneMappingExposure = x`, `scene.fog = ...` | the owner record and the debug layer (`describe().look` tags it `three`); the sky keeps writing fog unless `look.fog.replace('manual')` |

Keep the integrations by going through the engine: `engine.makeMaterial('role', {...})` for the material, `look.materials.patch(name, { glsl }, { roles })` to add GLSL to a role, `look.post.patch(name, { glsl, slot })` or `look.post.replace([...])` for a screen effect.

`patch` vs `replace`: `patch(hook, glsl)` swaps one registered hook (`threedogWind`, `threedogFog`, `threedogLighting`, the water `wave`) and the rest of the engine's shader stays, so the integrations above still work. `replace(impl)` hands over the whole part (the ground material, the water surface, the whole post chain): everything that part did is now yours, including the fog, shadow and season hooks inside it. Prefer `patch`; use `replace` when the hook is too small. `engine.catalog('look.<part>')` lists the hooks and what each `replace` loses.

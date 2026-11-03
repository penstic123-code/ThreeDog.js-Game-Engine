# Moving a game from 0.4 to 0.5

Upgrade steps for what an existing 0.4 game runs into; [CHANGELOG.md](../CHANGELOG.md) lists every change. Each item is:
what you see (the error code in square brackets, or the silent symptom) → what to write instead.

## Plugins: one owner per file, material plugins rebuild what is out

- `[shared-conflict]` at start naming two plugins of one style pack (`style:ink/10-a` and `style:ink/20-b`): both write the same key (two
  Materials for one role). Before, the pack shared one owner and the later file silently won (and switching it off dropped both). Keep one
  file, or say which wins in it: `export const replaces = '10-a';`.
- *silent*: `engine.plugins.off / on` of a material or patch plugin now also changes the materials already made (they are made again and
  swapped in place: `engine.look.materials.rebuild()`). A game that kept a reference to such a material holds the old, disposed one: read
  the mesh's `material` (or `look.materials.object(role)`) after the switch, or pass `{ rebuild: false }`.
- *silent*: `plugins.off` / `on` return a result object instead of `undefined`, and two post effects with equal `order` keep their first
  place after off / on (before, the one switched on again moved to the end of its slot).

## Shadows off no longer touches your lights

- *silent*: with shadows off (`look.shadow.set({ enabled: false })` or the settings menu) a light's `castShadow` now stays what the game set;
  only `renderer.shadowMap.enabled` goes off (both renderers then draw and sample no shadow maps). Code that read `castShadow === false` to
  learn whether shadows are off → read `engine.renderer.shadowMap.enabled` (or `engine.look.shadow.value('enabled')`).
  `describe().owned['shadows.off']` is gone (nothing is held any more); budget `shadowLights` reads 0 while shadows are off.

## Save parts must return copyable data

- `[save-part-threw]` "returned data that cannot be copied" on `saves.load` / `apply` / `session.newGame`: the engine now copies every part's
  `save()` before a load (structuredClone) so a failed load can be undone even when `save()` returns the live object. A `save()` whose result
  holds a function, a DOM node or a three object (written to disk it lost those silently) → return plain data: `save: () => ({ hp: s.hp, items: [...s.items] })`.
- *silent*: a listener that throws after an `await` in an async part `load()` now fails the load (resolves false, rolled back), as one before
  the `await` always did. A test that expected such a load to resolve true had the bug.
## Look values left the module options

One entry per value: a look value is a `look.*` param (style layer: the style file), and a module option is only a structural choice.
A removed option throws in dev at the call, naming the new one (`[water-option]`, `[sky-option]`, `[terrain-option]`):

- `water({ color | opacity | waveHeight | waveScale | waveSpeed | fresnel | depthColor | foam | normalMap | normalScale | normalRepeat |
  normalSpeed | shininess | specular })` → the same key in `style.water`, or `engine.look.water.set({ ... })` after `engine.use(water())`.
  `water({ material })` → `engine.look.water.replace(material)` (or `style.water.material`): the same slot, one entry. `water()` keeps
  `sea`, `level`, `flat`, `size`, `segments`, `uniforms` (they declare the uniforms the `look.water.patch` hooks read, and your replaced
  material gets them in its `{ uniforms }`).
- `sky({ keyframes | sunSize | sunGlow | sunBrightness | moonSize | moonColor | moonBrightness | starDensity | starScale | gradientCurve |
  groundTint | orbitTilt | orbitSway | dim | clouds | backdrop })` → `style.sky.<key>`, or `engine.look.sky.set({ ... })` (`dim: { stars: false }`
  and `clouds: { coverage }` nest as before). `sky({ skybox })` → `engine.look.sky.replace(skybox)`; `sky({ layers })` →
  `engine.look.sky.patch('layer:<name>', layer)` per layer (or `style.sky.layers`). `sky()` keeps `time`, `fog`, `sun`, `hemisphere`, `shadow`,
  `environment`.
- `terrain({ normals })` → `style.terrain.config.normals`, or `engine.look.ground.set({ normals })`.
- *silent*: these values used to sit on the game layer of the look (`describe().look.water.opacity.writer` was `game`); from the style they
  read `style`, from `set` `game` (or your owner).

## Library code pulled into plugins/

- *silent*: `threedog lib pull <code entry>` now copies the entry's files into `plugins/<name>/` and writes `plugins/<name>.js`, the wiring
  file that calls its factory (`export default makeIt();`). A game that pulled with 0.4 and hand-wrote the line keeps working; pulling again
  lands beside it, so delete the old copy first. Set the call when adding (`threedog lib add ... --plug "makeIt({ size: 4 })"`) or when
  pulling (`--plug`).
- `[plugin-shape]` messages changed: each names the file, what it exports, and the fix for that case (a factory function, a module with no
  `type`, a module with no hook, an effect with no name). A test matching the old text ("exports a function") needs the new wording.

## Names taken out of the type declarations

These never did anything a game needed; `npm run types` now reports them. Nothing changes at runtime.

- `engine.look.clouds` (an old name; at runtime it has been `undefined` since 0.3) → `engine.look.cloudShadow`.
- `import type { Light } from 'threedog'` (three.js's class, leaked by the declarations; the runtime never exported it) → `import type { Light } from 'three'`.
- `.engine` on `engine.terrain`, a character (`engine.player`, an NPC), `engine.cameraRig`, `engine.control`, `engine.views` → use the
  `engine` your code already holds (the factory's `install(engine)`, `createEngine`'s result).
- `engine.audio.info`, `engine.ambience.info`, `engine.level.buildMs`: debug readouts the engine's own tests read. They still answer at
  runtime; a game that reads them for its own logic should keep its own state instead (the rules it set, the sounds it played).

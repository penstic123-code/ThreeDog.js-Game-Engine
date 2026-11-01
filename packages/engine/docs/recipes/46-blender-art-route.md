# Hand-painted art route: from Blender to the game

Code-built geometry (`models.js`, recipe 05) is good for blockout, props and variations, but it cannot reach the finish of hand-made art: painted
textures, baked shadows, sculpted edges. That finish comes from Blender. This page is the whole path, in order. The level naming rules live in
`10-blender-level.md`; they are not repeated here.

## 1. In Blender
1. **Model** at real scale (1 unit = 1 meter), origin at the object's base. Apply scale and rotation (Ctrl+A).
2. **UV unwrap** every textured mesh. A mesh with a texture but no UV set shows one flat pixel (`assets check` warns `texture-without-uv`).
3. **Bake** the look into textures: base color (the paint), optional AO, optional baked light. One image per material keeps draw calls low;
   one shared atlas for many small props is cheaper still. Keep textures at 2048 or less (`assets check` warns above that).
4. **Name things**: objects, materials and (for animated models) actions. Names survive export and compression, and the engine reads them
   (`spawn`, `col_xxx`, `trigger_xxx`, `template`, `id`; ground type from the material name, see recipe 10).

## 2. Export glTF / GLB
File > Export > glTF 2.0, into `art/models/` of the game:
| Setting | Value | Why |
|---|---|---|
| Format | glTF Binary (.glb) | one file; `.gltf` plus loose files also works |
| Include > Custom Properties | on | `template`, `id`, `groundType`, `shape`... reach `userData` only this way |
| Transform > +Y Up | on | three.js is Y-up; the exporter converts from Blender's Z-up |
| Mesh > Apply Modifiers | on | the game gets the shape you see |
| Mesh > UVs, Normals, Vertex Colors | on if used | missing data cannot be added later |
| Material > Images | Automatic (embedded in the .glb) | `threedog assets` recompresses them anyway |
| Animation > Actions / NLA tracks | on for animated models | each action becomes one clip; name it as the game will (`Idle`, `Walk`, `Slash`) |
| Limit to > Visible Objects | off for levels | hidden `col_` boxes must be exported |

Do not join meshes or decimate a level: node names are its interface.

## 3. Check, then compress
```
threedog assets check art/models/town.glb   # inspect only: spawns, col_ colliders, trigger_ zones, template / id nodes, material suspicions
threedog assets                             # compress art/models/*.glb into public/models/ (add -w my-game for a game)
```
`assets check` exits 1 on errors (`--strict`: on warnings too; `--json` for tools). It changes no file.
`assets` keeps names, hierarchy and materials and only compresses:
| Step | What it does | When it matters |
|---|---|---|
| Meshopt | compresses geometry; the decoder ships with the engine | always on; smaller download, no visual change |
| WebP | compresses textures for the download | default; GPU memory is unchanged (the GPU holds raw pixels) |
| KTX2 (`threedog assets --ktx2`) | textures stay compressed on the GPU too | many or large textures; needs the `ktx` tool (KTX-Software), else falls back to WebP and says so (`--ktx2 --strict` fails instead) |

It needs `@gltf-transform/cli` (`npm i -D @gltf-transform/cli`). Unchanged files are skipped; `--force` redoes everything.

## 4. Use it
Register the compressed file in the asset pack and refer to it by name everywhere else:
```js
engine.assets.manifest({ name: 'town-art', models: {
  well: '/models/well.glb',
  hero: { url: '/models/hero.glb', critical: true, animation: { states: { attack: { clip: 'Slash', loop: false } } } },
} });
// content/templates.js:  well: { model: 'well', collide: 'circle' }      (recipe 30)
// content/props.js:      { template: 'well', id: 'well-square', place: 'square', x: 4, z: -2 }
// or in code:            engine.add(await engine.assets.model('well', { static: true }));
```
A whole level is `level({ url: '/models/town.glb' })` (recipe 10). Animation clips and their mapping to game actions: `13-animation.md`.

## 5. The GLB's own materials and the style
**The GLB keeps its own materials.** The engine loads them as they are (textures, colors, roughness) and does not swap them for style roles;
that is what lets a hand-painted texture show. `style.materials` (recipe 43) applies only to what code builds through `engine.makeMaterial(role, ...)`
(terrain, vegetation, procedural models, pickups). One scene can mix painted GLB props and styled code-built things.

There is no automatic mapping from a GLB material name to a style role and no flag for it. To make a GLB follow the style anyway, do it in your
game code, per model: name the material in Blender after the role (`wool`, `bark`) and look it up:
```js
const m = await engine.assets.model('hat');
m.traverse(o => { if (o.isMesh) o.material = engine.makeMaterial(o.material.name, { color: o.material.color.getHex() }); });
```
This replaces the painted material, so the texture is gone unless the role's spec sets `map` (recipe 43, "texture names"). A role the style does
not list falls back to `materials.default`.

## 6. Smallest copyable flow
1. Blender: a cube named `well`, UV unwrapped, base color baked to a texture, export `art/models/well.glb` with the settings above.
2. `threedog assets check art/models/well.glb` (no errors), then `threedog assets`.
3. Add `well: '/models/well.glb'` to `engine.assets.manifest({ models })`.
4. `engine.add(await engine.assets.model('well'))`, then `threedog shot /your-page.html --describe-only` or open the page.

## 7. Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| Model too dark, or textures washed out/white | color space: a color map used as data or a data map as color (`assets check` reports `looks like data` / `looks like color`) | color maps (base color, emissive) are sRGB; normal, AO, roughness are Non-Color in Blender; one image per use |
| Texture shows one flat color | no UV set on that mesh (`texture-without-uv`) | unwrap in Blender, export again |
| Emissive never glows | emissive texture with black emissive color (`emissive-hidden`) | set the emissive color to white |
| Node names lost (`spawn`, `col_` not found) | meshes joined before export | keep objects separate; `threedog assets` never flattens or joins; run `assets check` to see what the level finds |
| Custom properties missing (`template`, `id`) | "Custom Properties" off at export | tick it and export again |
| Collision does nothing | `col_` object not exported, or no `collision()` module | export hidden objects; `engine.use(level(...), collision())`; test `engine.collision.walkable({ x, z })` |
| Painted material replaced by the flat style look | game code swapped it (section 5) | remove the swap, or give the role a `map` |
| File too big | large textures or many materials | textures at 2048 or less, share atlases, `threedog assets --ktx2`; sizes are in the `assets` report (`.threedog/assets-report.json`) |
| Clip not found | action name differs from the manifest `animation` mapping | rename the action in Blender or change `clip:` |

See also: `10-blender-level.md` (level names and markers), `43-shader-patches-surface-looks.md` (material roles and texture slots),
`35-style-from-reference.md` (a whole style from a reference image).

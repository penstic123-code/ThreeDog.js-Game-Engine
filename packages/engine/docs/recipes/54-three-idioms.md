# Plain three.js in this engine

```js
engine.scene.add(new THREE.PointLight(0xffaa55, 2, 8));            // anything the engine does not write: just do it
engine.lights.sun.intensity = 3;                                   // the placeholder lights too: nothing else writes them
engine.sky.replace(mySky);                                         // your sky: skybox name, Texture or Object3D; null gives the dome back
engine.onRender(({ renderer, scene, camera }) => { /* render into your own target */ });
```

The engine is three.js underneath: `engine.renderer`, `engine.scene` and `engine.camera` are the real objects, and plain three.js code works on them.
What you need to know is which values the engine **writes on its own** (every frame or on a timer) and how to take those over. A direct write to
one of them hands it to you (the engine stops writing it and warns once with the explicit call); the full list is recipe 52 "Who writes it".
Everything else: just do it.

Rule of thumb: write the three.js first; it works (auto-yield: the engine stops writing a value you wrote, warns once). `renderer.toneMapping =
THREE.ACESFilmicToneMapping` is a complete answer. The engine route is optional on top: `engine.mod(point, ...)` adds owners and layers
where several systems share a value (recipe 55); `engine.view.manual(key)` takes a value without the warning (`manual(key, false)` gives it back);
`engine.describe('picture').picture` says what three.js holds now; `describe().owned` who writes each
engine-driven value now.

| three.js idiom | Where it goes in the engine | Engine overwrites it? | How to take it over |
|---|---|---|---|
| `renderer.toneMapping` | Just set it: `engine.renderer.toneMapping = THREE.ACESFilmicToneMapping` (any three mapping). A curve of your own: a post stage in the `'tone'` slot, `engine.post.add({ name, slot: 'tone', create, node })`, which runs on both renderers (a `ShaderChunk` edit is page-wide and reaches only the default renderer) | Once, at `createEngine` (`style.toneMapping`, else AgX), never again | Nothing to take: your write stays; `describe().render.toneMapping.writer` says `game` |
| `renderer.toneMappingExposure` | Just set it | Never on its own | Your direct write stays. Own the whole renderer: `createEngine({ renderer })` (recipe 50) |
| `renderer.outputColorSpace` | Leave it at `SRGBColorSpace` (three's default) | No | Changing it makes every color wrong; `assets.report` flags it |
| `renderer.shadowMap` | `engine.shadows.enabled`; `type` is yours | `enabled` when the switch changes | Write it: the engine yields; or `createEngine({ renderer })` and run your own |
| `scene.environment` | None by default. The sky as a map: `engine.sky.environment({ into: engine.scene })` | Never written unless you call that; a map you write stays | Write it; recipe 34 |
| `scene.background` | Style `background`, or `engine.sky.replace(name \| Texture \| Object3D)` with a sky | The sky dome draws over it; a backdrop / skybox writes it every frame | Assign it: the dome hides and the sky stops writing it, or `engine.sky.replace(yourTexture)` |
| `scene.fog` | Assign it: `scene.fog = new THREE.Fog(...)` | Never on its own | Your write stays |
| Your own sky (three/addons `Sky`, a ShaderMaterial dome, a skybox) | `engine.sky.replace(mySky)`; feed it from `engine.uniforms` (`uSunDir`, `uDaylight`, `uTimeOfDay`, `uWind`, `uCloud`) | Never: the engine only hides its dome and adds `mySky` to the scene when it has no parent; time, lights, fog and weather keep running | `engine.sky.replace(null)` gives the dome back. Per key instead of whole: write `engine.sky.top` and friends in your frame code |
| Lights (`DirectionalLight`, `PointLight`, ...) | Add them with `engine.scene.add(light)` before `engine.start()` (a light count change mid-play recompiles shaders; `lightPool()` for many) | Never on its own; `engine.lights.sun` / `.hemi` are still placeholders | Write them directly; `createEngine({ lights: false })` leaves the placeholders out |
| Shadow camera (`light.shadow.camera`, `mapSize`, `bias`) | Your own lights: just do it. Engine sun: the same, and `engine.shadows.box(engine.lights.sun, ...)` (sky) | The engine sun's shadow box follows `engine.focus` every frame | `engine.shadows.box(sun, { follow: 'focus' \| 'camera' \| object3D \| fn \| false, extent })`, or place `sun.target` yourself (the box stops following). With cascades built-in lit materials get the `csm` patch; a lit ShaderMaterial of yours joins with `engine.shadows.include(mat)` |
| Materials (`new MeshStandardMaterial(...)`) | Just do it | No | - |
| `onBeforeCompile`, `customProgramCacheKey` | Just assign them, on any material: `m.onBeforeCompile = s => { ... }`. A named, checked patch: `applyEffects(m, { patches: [...] })` | Nothing: on a material the engine patched (wind, clouds, season), your function runs first and the patches after it; your cache key is joined in front of theirs | - |
| Textures, `CanvasTexture`, `DataTexture` | Just do it; set `colorSpace = SRGBColorSpace` on color textures. File textures by name: `engine.assets.manifest({ textures })` then `assets.texture(name)` | No | A texture made in code gets a name too: `assets.manifest({ textures: { brick: () => makeBrick(), sign: mySignTexture } })`, then `map: 'brick'`; it keeps its own repeat / wrap / colorSpace. Baking: see recipe 05 |
| `EffectComposer` passes | `const h = engine.post.add(pass)` (`composer.addPass`; `{ order }` for `insertPass`; `h.remove()` for `removePass`): the pass joins the engine chain after the scene render, before tone mapping (FXAA / SMAA last; a pass that renders the scene replaces the scene render); a settings toggle: `add(pass, { name: 'glow' })`, then `engine.post.get('glow').enabled = false` | The engine renders the main frame through its own composer; a composer of your own rendered to the canvas takes the frame over (the engine stops drawing, warns `[own-frame]`; delete the call to hand it back) | `engine.post.own()` for the whole chain. To read them: `engine.post.object()` (the EffectComposer, null until post first runs) and `engine.post.targets()` (`renderTarget1 / 2`, `readBuffer`, `writeBuffer`; read in `onRender(fn, { when: 'after' })`). Read-only: the engine rebuilds `passes`, resizes and disposes them |
| Render targets (mirror, minimap, portal, picking) | `engine.onRender(({ renderer, scene, camera, dt }) => { renderer.setRenderTarget(rt); renderer.render(scene, cam); })`; runs after the camera and batching, before the frame (`{ when: 'after' }` after it) | No; the render target is reset to the screen after each `before` callback | The main frame render itself stays the engine's |
| Loaders (`GLTFLoader`, `TextureLoader`, `EXRLoader`, `FBXLoader`, `FontLoader`, exporters) | glTF and png / jpg / ktx2 / hdr textures: `engine.assets.manifest(...)` gives them names, the loading screen and `describe` | No | A hand-made `GLTFLoader` / `TextureLoader` works (rule R21 warns: the asset gets no name). Formats the manifest cannot load (EXR, FBX, OBJ, typeface fonts) and exporters: just use the three.js addon |
| Camera (`fov`, `position`, `far`) | Camera modules (`followCamera()`, ...) or `engine.camera` with none installed | An installed camera module writes position / fov every frame; terrain view distance rewrites `camera.far` | `engine.takeCamera('me')` (gives it back on `remove()`), or just write `camera.position` (the rig stops; `engine.view.manual('camera', false)` resumes). `camera.far` / `fov`: `engine.view.manual('far' \| 'fov')`. Not yet: no slot to swap in a different camera object |
| Meshes (`scene.add(mesh)`) | `engine.add(mesh, { id })` (tracked, saveable) or plain `engine.scene.add(mesh)` | No: auto-batching only merges what the engine places (world records, stream builds, level files); your own meshes stay as you made them | Many static copies of your own mesh: `mesh.userData.batch = true` before adding (recipe 05, 2b) |
| `requestAnimationFrame` loop | `engine.onFrame(dt => ...)`, `engine.onFixed(dt => ...)` | The engine runs the only loop | Do not start a second loop |

Also not yet: contact shadows. WebGPU and TSL: recipe 56.

## Procedural modeling: what three.js already has

Models written in code (recipe 05, 2a) mostly need helpers three.js already ships: import them from `three` or `three/addons/...` inside the
model generator, so the result is cached and baked with the model. The engine adds only what three lacks (last row).

```js
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { bakeVertexAO } from 'threedog';

const rng = engine.random.seeded(7), simplex = new SimplexNoise({ random: () => rng.next() });   // seeded noise: the same shape every load
// weld first, or the noise opens cracks; mergeVertices compares every attribute, so drop normal and uv (their seams would stay unwelded)
const rock = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal').deleteAttribute('uv'));
const p = rock.attributes.position, v = new THREE.Vector3();
for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(1 + 0.25 * simplex.noise3d(v.x, v.y, v.z)); p.setXYZ(i, v.x, v.y, v.z); }
rock.computeVertexNormals();
const slab = new THREE.CylinderGeometry(1.2, 1.4, 0.3).translate(0, -0.9, 0).deleteAttribute('uv');
const model = mergeGeometries([rock, slab]);                     // same attributes (position, normal), both indexed
bakeVertexAO(model, { samples: 32, strength: 0.7, occluders: [new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2).translate(0, -1.05, 0)] });
const sampler = new MeshSurfaceSampler(new THREE.Mesh(model)).setRandomGenerator(() => rng.next()).build();
const at = new THREE.Vector3(), up = new THREE.Vector3();
sampler.sample(at, up);                                          // a point and its normal on the surface: where a tuft or stud goes
```

| Need | three.js answer | Engine |
|---|---|---|
| Parts into one geometry / one draw call | `BufferGeometryUtils.mergeGeometries(list, useGroups)` (same attributes on every part, all indexed or none); `BufferGeometryUtils.mergeVertices(g, tolerance)` welds; `BufferGeometryUtils.toCreasedNormals(g, angle)` keeps hard edges with smooth faces; `mergeGroups` | `mergeColored([[g, color], ...])` when each part is one flat color (vertex colors) |
| Revolve a profile (vase, bottle, shade) | `new LatheGeometry(points, segments)` | - |
| Sweep along a path (pipe, rope, rail, vine) | `new TubeGeometry(curve, ...)`; a `Shape` along a path: `new ExtrudeGeometry(shape, { extrudePath: curve, steps })`; sections that change: `new LoftGeometry(sections)` (three/addons geometries); bend a finished mesh along a curve: `Flow` (three/addons CurveModifier) | - |
| A 2D outline into a slab (sign, cutout, wall with holes) | `Shape` with `shape.holes`, `new ExtrudeGeometry(shape, { depth, bevelEnabled })`; flat: `ShapeGeometry` | - |
| Rounded box, parametric surface, 3D text | `RoundedBoxGeometry`, `ParametricGeometry`, `TextGeometry` with `FontLoader` (addons) | - |
| Points spread over a mesh (moss, studs, spikes, ornaments) | `new MeshSurfaceSampler(mesh).setWeightAttribute(name).setRandomGenerator(fn).build()`, then `.sample(position, normal, color, uv)` | Over the ground by height, slope and biome rules: `engine.vegetation.define(name, { rule })` (recipe 10) |
| A decal projected onto a mesh (stain, sticker, scorch) | `new DecalGeometry(mesh, position, orientation, size)`, material with `polygonOffset` | - |
| Convex hull of points (pebble, crystal, collision proxy) | `new ConvexGeometry(points)`; `ConvexHull` for the faces as data | - |
| Fewer triangles (a far copy of one model) | `await new SimplifyModifier().modify(geometry, count)` (async in this three version) | Far copies of whole areas: `hlod` (recipe 15) |
| More triangles (before noise or vertex AO) | `new TessellateModifier(maxEdge, iterations).modify(g)`, or more segments in the primitive | - |
| Hard edges on a smooth mesh | `new EdgeSplitModifier().modify(g, angle)` or `BufferGeometryUtils.toCreasedNormals` | - |
| Noise (lumpy rock, wobbly edge, color variation) | `new SimplexNoise({ random })` (2D, 3D, 4D; seeded as above); `ImprovedNoise` (3D Perlin, one fixed permutation) | Terrain heights: `@threedog/terrain-noise` (recipe 28) |
| A texture drawn in code (labels, stripes, gradients, pixel art) | `new CanvasTexture(canvas)` with `colorSpace = SRGBColorSpace`; `DataTexture` | Give it a name: `assets.manifest({ textures })` (table above) |
| Many copies | `new InstancedMesh(g, m, count)` with `setMatrixAt`; `BatchedMesh` for different geometries | Auto-batching for copies the engine places, `userData.batch` for yours (recipe 05, 2b) |
| Ambient occlusion in a code-built model | Not in three: `aoMap` needs a baked texture | `bakeVertexAO(geometry, { samples, radius, strength, occluders })`: hemisphere rays per vertex (three-mesh-bvh), multiplied into the vertex colors; detail is per vertex, so tessellate big faces first |

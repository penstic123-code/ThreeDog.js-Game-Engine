# WebGPU and your own TSL materials

**In this recipe**: WebGPU or WebGL · Turning it on, fallbacks · A minimal TSL material · The engine's values as nodes · The engine's shader
functions · Patches with a `tsl` field (lighting hooks) · Sky and fog hooks · Post effects as nodes · A consistent style · Mistakes, each with the fix · GLSL to TSL

On the WebGPU route a game draws with three.js node materials (`MeshStandardNodeMaterial` ...) and writes shaders in TSL, three's shading
language in JavaScript. Learn TSL from three itself: the [TSL guide](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language) and
the [WebGPU examples](https://threejs.org/examples/?q=webgpu) are written for exactly this renderer. The engine adds nothing you must use:
its wind, cloud shadows, season tint and the rest are ordinary TSL functions in `threedog/tsl`, called where you want them. A whole small
scene written this way: `threedog examples pull webgpu-tsl`.

Rules (correctness, not taste): `import 'threedog/tsl'` comes first in `main.js`; GLSL does not run here (`ShaderMaterial`, `RawShaderMaterial`,
`onBeforeCompile`, three.js `Pass` objects, GLSL-only patches and hooks), and each one fails by name instead of drawing nothing.

## WebGPU or WebGL
`threedog new-game` and `threedog init` start a game on WebGPU with TSL (`main.js` imports `threedog/tsl` first and calls `createEngine({ renderer: 'webgpu' })`). `--webgl` starts it on GLSL instead. `createEngine` called without `renderer` still builds a WebGL renderer. When the browser has no WebGPU the game keeps running on three's WebGL2 backend, and `engine.describe().renderer` says why. How to decide:
- WebGPU + TSL (the default for a new game): the picture is built from TSL, you write shaders in JavaScript and compose them as functions, or start from a three.js WebGPU example, and effects that exist only as node materials are open to you.
- `--webgl` + GLSL: the game already has GLSL (ShaderMaterials, `onBeforeCompile`, a three.js `Pass`), or must run best on modest hardware where plain WebGL draws a frame fastest, or start-up time matters more than the shading style. Recipe 43 is the GLSL route for the same tasks.
- Check on the hardware you care about: `threedog inspect perf` on both routes, same scene. Measured in 2026-11 on one scene (terrain, 3000 trees, shadows, bloom): on an integrated GPU WebGPU took about 1.5 times as long as WebGL and WebGPURenderer's WebGL2 backend about 1.7 times; the first WebGPU frame came 0.6 to 1.3 s later (shader compilation).

## Turning it on
```js
import 'threedog/tsl';   // first line: brings three/webgpu and the node versions of the engine's sky, post chain and patches
import { createEngine } from 'threedog';

const engine = createEngine({ canvas: document.getElementById('view'), renderer: 'webgpu' });
await engine.start();   // start() initializes the renderer, so createEngine stays synchronous
console.log(engine.describe().renderer);   // { requested: 'webgpu', backend: 'webgpu' | 'webgl2' | 'webgl', reason }
```
Your own `new WebGPURenderer(...)` as `renderer` goes the same way (the engine configures only a renderer it built, recipe 50). When the
browser gives no WebGPU, `fallback` decides, and the console says once which one happened (`[threedog] WebGPU unavailable (...)`):
- `'webgl2'` (default): the same WebGPURenderer on its WebGL2 backend. Your TSL keeps working; frames are slower than plain WebGL.
- `'webgl'`: a `WebGLRenderer` instead. Faster, but node materials cannot draw there (`start()` fails when the scene has one). The engine's
  own materials (terrain, vegetation, water) are plain three.js materials with both a GLSL and a tsl form of each patch, so they
  draw on either renderer with the same picture. What engine modules built before `start()` is rebuilt for WebGLRenderer there: the post chain,
  the sky dome (with the `engine.sky.clouds` / `layer` hooks set so far), fog, cascaded shadows, particles, rain and snow. Your own objects are not:
  build node materials after `start()` when `engine.describe().renderer.backend !== 'webgl'`.
- `'error'`: `start()` rejects; the game shows its own message.

## A minimal TSL material
```js
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, positionWorld, sin } from 'three/tsl';

const mat = new MeshStandardNodeMaterial({ roughness: 0.5 });
mat.colorNode = color(0x4080ff).mul(sin(positionWorld.y.mul(4)).mul(0.25).add(0.75));   // bands by world height
engine.add(new THREE.Mesh(new THREE.TorusKnotGeometry(0.6, 0.2, 128, 16), mat));
```
A node material is lit, shadowed and fogged by three like its plain twin; you replace only the inputs you set (`colorNode`, `positionNode`,
`normalNode`, `emissiveNode`, `roughnessNode`, `opacityNode` ...).

## Node names games use
Everything is imported from `three/tsl`; a name you do not find here is almost always there too (`Object.keys(await import('three/tsl'))` lists them, `node_modules/three/src/nodes/` has the source).
- Values: `float`, `vec2`, `vec3`, `vec4`, `color`, `uniform`, `texture`, `attribute`, `varying`.
- Where am I: `positionLocal`, `positionWorld`, `positionGeometry`, `normalLocal`, `normalWorld`, `normalView`, `uv`, `screenUV`, `cameraPosition`, `instanceIndex`, `vertexColor`, `time`.
- Math: `sin`, `cos`, `abs`, `fract`, `floor`, `pow`, `length`, `dot`, `normalize`, `min`, `max`, `clamp`, `mix`, `step`, `smoothstep`, `oneMinus`, `select`; chain the operators as methods (`.add`, `.mul`, `.sub`, `.div`).
- Noise: `mx_noise_float`, `mx_fractal_noise_float` (MaterialX, also `_vec3`).
- Your own function and branches: `Fn`, `If`, `Loop`.

## The engine's values as nodes: `uniforms(engine)`
`uniforms(engine)` returns `engine.uniforms` as TSL nodes with the same names: `uTime`, `uWind`, `uCloud`, `uSunDir`, `uSunColor`, `uDaylight`
(0 at night, 1 at noon), `uTimeOfDay`, `uFoliageTint`, `uGroundTint` ... (the list: `uniforms` in [the engine API](../api/engine.md)). The node reads the
engine's value each render, so weather, the calendar and the sky move your material with no per-frame code.
```js
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float, sin, smoothstep, uniform } from 'three/tsl';
import { uniforms } from 'threedog/tsl';

const u = uniforms(engine);
const glow = uniform(3);   // a value of your own: change glow.value from game code (an op, a quest step)
const lantern = new MeshStandardNodeMaterial({ color: 0x3a2a18 });
const night = smoothstep(0.3, 0.9, float(1).sub(u.uDaylight));
lantern.emissiveNode = color(0xffa040).mul(night.mul(glow)).mul(sin(u.uTime.mul(7)).mul(0.08).add(0.92));   // lights up at dusk, flickers
engine.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.3), lantern));
```

## The engine's shader functions: `threedog/tsl`
Each is a TSL `Fn` with the same arguments and meaning as its GLSL twin in recipe 43, reading the same `engine.uniforms`; full signatures are
in the package's `types/tsl.d.ts`. Call them on nodes, put the result where it belongs:

| Function | Returns | Typical place |
|---|---|---|
| `wind(positionGeometry, objectOrigin(), amplitude)` | object-space offset (vec3) | `positionNode = positionLocal.add(...)`: grass, leaves, flags, hanging cloth |
| `objectOrigin()` | world origin of the object or instance (vec3) | a per-object phase or random seed |
| `cloudShadow(positionWorld)` | 0-1 light factor under drifting clouds | multiply into the color or the direct light |
| `season(color, 0 \| 1)` | the color moved by the calendar's tint (0 foliage, 1 ground) | `colorNode` |
| `detailNoise(p, kind, octaves)` / `detailBump(...)` | gray noise + height / a bumped normal | breaking up flat color; `normalNode` |
| `wrapDiffuse`, `shadowTint`, `rim` | light to add | inside a lighting hook (next section) |
| `celLighting` | a lighting model | `mat.setupLightingModel = celLighting` on a `MeshToonNodeMaterial` ("A consistent style" below) |
| `waterWave`, `waterSurface(spec)`, `waterFresnel` | wave height / surface color / fresnel blend | a water material of your own |

```js
import * as THREE from 'three';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import { color, float, mix, positionGeometry, positionLocal, positionWorld, uv } from 'three/tsl';
import { wind, objectOrigin, cloudShadow, season } from 'threedog/tsl';

const flag = new MeshLambertNodeMaterial({ side: THREE.DoubleSide });
flag.colorNode = season(mix(color(0x803020), color(0xd06040), uv().x), 0).mul(cloudShadow(positionWorld));
flag.positionNode = positionLocal.add(wind(positionGeometry, objectOrigin(), float(0.4)));   // its shadow sways too
const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8, 12, 8).translate(0.6, 2.2, 0), flag);
mesh.castShadow = true;
engine.add(mesh);
```
three's shadow pass draws with the material's `positionNode`, so whatever moves vertices there moves their shadow: no depth material to keep
in step. With an `InstancedMesh` whose instances are rotated or scaled, the offset must turn with each instance; the patch form below does that.

## Patches with a `tsl` field (optional convenience)
`applyEffects(mat, { wind, season, clouds, patches })` (recipe 43) works on node materials: the engine's own patches carry a TSL version, and a
patch of yours gives `tsl: (ctx) => node` beside or instead of `glsl`. Same slots, same order and conflict rules; `ctx` holds the slot's value
so far (`ctx.color`, `ctx.position`, `ctx.normal` ...), `ctx.tsl` (three/tsl) and `ctx.fx` (the `threedog/tsl` functions). `ctx.position`
is object space before instancing, as in GLSL, so an instanced mesh's offset turns with each instance by itself. Return the new value. A patch that has only `glsl` stops with `patch 'x' has no tsl version`.
```js
import * as THREE from 'three';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import { applyEffects } from 'threedog';

const leaves = new MeshLambertNodeMaterial({ color: 0x88aa55 });
applyEffects(leaves, { wind: 0.3, season: 'foliage', patches: [
  // darker toward the ground: ctx.color is the vec4 surface color with the map and vertex colors applied
  { name: 'heightShade', slot: 'color', tsl: ({ color, tsl }) => tsl.vec4(color.rgb.mul(tsl.positionWorld.y.mul(0.25).add(0.5).clamp(0, 1)), color.a) },
] });
engine.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 3, 0.6, 1, 10, 1).translate(0, 1.5, 0), leaves));
```
The `lighting` slot edits light after three summed it: `tsl: (ctx) => ({ directDiffuse, directSpecular, indirectDiffuse, indirectSpecular })`
(any of the four, as nodes). For what GLSL reads in `lightsPars` (the sun's direction, its shadow alone), give hooks instead: `start(ctx)` runs
before the lights, `light(light, ctx)` may return a new color node for one light before three lights the surface with it (the
engine's cloud shadow dims the sun this way; return nothing to leave a light alone), `direct(light, ctx)` once per light (`light.direction`, `light.color` with the shadow in it, `light.shadow` 1 lit / 0 shadowed
or null, `light.directional`, `light.light`; what it adds to `ctx.directDiffuse` ... joins the summed light at the patch's place in the
list, as on WebGL), `after(ctx)` at the end; `ctx.state` is shared between them. The `if` in `direct` is
plain JavaScript run while the shader is built (which light this is), not a per-pixel branch.
```js
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { applyEffects } from 'threedog';

const coolShade = { name: 'coolShade', slot: 'lighting', tsl: {
  start: c => { c.state.lit = c.tsl.float(1).toVar('coolShadeLit'); },
  direct: (light, c) => { if (light.directional && light.shadow) c.state.lit.assign(light.shadow); },
  after: c => ({ indirectDiffuse: c.indirectDiffuse.mul(c.tsl.mix(c.tsl.vec3(0.8, 0.9, 1.25), c.tsl.vec3(1), c.state.lit)) }),   // bluer fill in shadow
} };
const rock = applyEffects(new MeshStandardNodeMaterial({ color: 0x9a9080 }), { patches: [coolShade] });
engine.add(new THREE.Mesh(new THREE.DodecahedronGeometry(1), rock));
```

## Half-transparent surfaces and fog differ from plain WebGL
WebGL straight to the canvas tone-maps and encodes each material first, then applies fog and blends in display values. WebGPU, and WebGL with any `engine.post` effect on, fog and blend in linear and tone-map once. Those two match pixel for pixel, opaque unfogged surfaces match on all three, and half-transparent or fogged ones shift on the straight WebGL path, more in dim scenes. So on WebGL turning the first post effect on can move those surfaces a little. This is how three.js's renderers work, not a fault to fix in your scene.

## Sky and fog hooks
The engine's sky dome has a node version; nothing changes in how you set it (recipe 08). The GLSL hooks (`engine.sky.clouds`, `engine.sky.layer`
clouds and layers) take `{ glsl, tsl }` on this route: see 52's [tsl forms](52-around-the-picture.md#tsl-forms).
A sky of your own: three's `SkyMesh` (`three/addons/objects/SkyMesh.js`) through `engine.sky.replace`.

## Post effects as nodes
On WebGPURenderer the post chain is one three.js `RenderPipeline` (`engine.post.object()` returns `{ pipeline, scenePass }`). The slots, order
and ownership rules of recipe 52 are unchanged; an effect gives `node: (input, ctx) => color` instead of `create`, and a fused snippet gives
`fuse.tsl: (color, uv, ctx) => color` beside its `fuse.glsl`. `ctx.p` holds a live uniform per number or color param (so `handle.set()` does
not rebuild), `ctx.tsl` is three/tsl, `ctx.scenePass` the scene pass (depth: `ctx.scenePass.getTextureNode('depth')`). The effects of
`@threedog/post-effects` run on both routes as they are. An effect that reads depth, with a GLSL pass and a TSL node in one object
(volumetric fog, god rays): [recipe 59](59-depth-post-effects.md).
```js
engine.post.add({ name: 'warmGrade', slot: 'ldr', params: { amount: 0.3 },
  node: (input, { tsl, p }) => tsl.vec4(tsl.mix(input.rgb, input.rgb.mul(tsl.vec3(1.05, 0.95, 0.8)), p.amount), input.a) });
engine.post.get('warmGrade').set({ amount: 0.5 });   // a uniform write, no rebuild
```
`ldr` runs after tone mapping (display colors 0-1); something that should glow or bleed belongs in `hdr`. An effect with only `create`
(a three.js `Pass`) stops with its name.

## A consistent style
A style reads as one when every surface answers the same few questions the same way. Decide these once, in one place of `picture/`, and let materials share the answers; a
look built material by material drifts. Working example: `examples/techniques/three-looks/` (page `/technique-looks.html`), the same models three ways.

| Question | Where it lives | With |
|---|---|---|
| Where does light turn into shade, how hard, what color is the shade | the lighting model; `colorNode` runs before lighting and sees no light | three's PBR with `wrapDiffuse` / `shadowTint` in a hook; `MeshToonNodeMaterial` + `gradientMap` (`rampTexture`); `celLighting` for colored bands |
| Do shapes have lines | `hdr`, before the tone curve | `outline()`, or three's `toonOutlinePass` |
| What moves | `positionNode`; the shadow follows, `castShadowPositionNode` only when it should differ | `wind()`, any node |
| What fills the air | the scene | `scene.fog`, or `scene.fogNode = fog(color, factor)` |
| What does the tone curve do | the renderer, once | `renderer.toneMapping`; `NoToneMapping` when the colors you wrote are the colors you want |
| What is the finished picture's color | `ldr`: display colors after the tone curve, never tone-mapped again | `lut()`, `paletteLut()`, your own node; `grayscale`, `posterize`, `saturation`, `hue` from three/tsl |

```js
import { MeshToonNodeMaterial } from 'three/webgpu';
import { rampTexture } from 'threedog';
import { celLighting } from 'threedog/tsl';
const ramp = rampTexture([0x7a84c8, 0xd0d4f0, 0xffffff]);   // example colors: the light in each band, dark to light, from the game's palette; one ramp for the whole game
const mat = new MeshToonNodeMaterial({ color: 0xe08050, gradientMap: ramp });
mat.setupLightingModel = celLighting;   // colored bands; a cast shadow reads the dark end of the ramp, so it is the same flat color as the side turned away
```
three's toon alone is enough for gray bands: it reads only the red channel of `gradientMap`, and a cast shadow drops to the ambient light. Choose it when that is the picture you
want; `celLighting` when shade has a color or cast shadows belong to the bands. The ramp's width sets where bands fall, the left half being the side turned away.

**Same tools, different pictures**: a paper cut-out is two bands and no line; ink wash is a gray palette through `paletteLut` with soft fog; a neon night is a dark ramp with `bloom` and
emissive lines; a storybook is soft ramp edges (`rampTexture(ramp, soften)`) with a warm grade; a retro handheld is a four-color `paletteLut` with `posterize` before it.

**How to judge it**, at the game's real camera (`threedog shot /your-page --gpu`):
- Look at the picture in gray. Do the shapes still separate? Color cannot rescue forms that have the same value.
- Cover the object you just changed. If the rest of the frame tells you the same story about light, the style is holding; if one material looks lit by another sun, its answers differ.
- Is every shade in the frame leaning the same way? A cast shadow and a turned-away side that disagree read as two renderers.
- A flat look with soft or stair-stepped shadow edges: the shadow map is showing. Raise its resolution for the area in view, or soften the ramp a little.
- Count what the picture really holds, not what you meant: most common colors, saturation, light-dark spread (`window.techTest.measure` in the example is one way). A palette look with
  many stray colors has something running after the `lut`; grain and vignette belong before it there.
- Put an effect in the stage that matches what it reads. A grade written for finished colors looks wrong before the tone curve, and a glow after it stops glowing.

## Mistakes, each with the fix
Each block shows the mistake as a comment and the working line under it.
```js
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { color, mix, uv } from 'three/tsl';

// wrong: new THREE.ShaderMaterial({ fragmentShader }) or mat.onBeforeCompile = fn; WebGPURenderer never runs either (start() names the mesh)
const sign = new MeshBasicNodeMaterial();
sign.colorNode = mix(color(0x203060), color(0xf0c080), uv().y);
engine.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 1), sign));
```
An sRGB picture as `scene.background` is tone-mapped on both routes and with or without post effects (the engine's frame matches
WebGPURenderer, which tone-maps the whole frame once). Plain three.js's WebGLRenderer leaves an sRGB background out of tone mapping, so a
`renderer.render(scene, camera)` of your own on WebGL shows it brighter than the engine's frame.
```js
import * as THREE from 'three';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import { float, positionGeometry, positionLocal } from 'three/tsl';
import { wind, objectOrigin } from 'threedog/tsl';

const grass = new MeshLambertNodeMaterial({ color: 0x6a8a3a });
// wrong: wind(positionLocal, ...); positionLocal is after the instance transform, so every blade sways by its height in the field
grass.positionNode = positionLocal.add(wind(positionGeometry, objectOrigin(), float(0.3)));
engine.add(new THREE.InstancedMesh(new THREE.PlaneGeometry(0.05, 0.4, 1, 3).translate(0, 0.2, 0), grass, 10));
```
```js
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, select, uv, vec3 } from 'three/tsl';
import { uniforms } from 'threedog/tsl';

const u = uniforms(engine), mat = new MeshStandardNodeMaterial();
// wrong: color(0xff0000).add(uv()); vec3 + vec2 gives no error, a channel is dropped or padded silently. Make the types match:
mat.colorNode = color(0xff0000).mul(0.5).add(vec3(uv(), 0).mul(0.5));
// wrong: u.uDaylight.value < 0.5 ? a : b, or u.uTime * 2; JavaScript runs once while the shader is built (and a node times a number is NaN)
mat.emissiveNode = select(u.uDaylight.lessThan(0.5), color(0xffaa44), color(0x000000)).mul(u.uTime.mul(2).sin().mul(0.5).add(0.5));
engine.add(new THREE.Mesh(new THREE.SphereGeometry(0.5), mat));
```
```js
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, Loop, float, uniform, uv, vec3 } from 'three/tsl';

// wrong: uniform(new THREE.Vector3()).onRenderUpdate(({ value }) => value.copy(p)); the callback is handed the frame, not the value: it RETURNS the new value
const camHeight = uniform(0).onRenderUpdate(() => engine.camera.position.y);
const bands = new MeshBasicNodeMaterial();
// wrong: Loop(...) (or If, or x.addAssign) at the top level, outside an Fn: nothing holds the statement, three drops it with NO error and
// the sum stays 0. The engine warns in dev for a patch's or post effect's code; for your own material nothing tells you
bands.colorNode = Fn(() => {
  const sum = float(0).toVar();
  Loop(4, ({ i }) => { sum.addAssign(uv().x.mul(float(i).add(1)).fract().mul(0.25)); });
  return vec3(sum).mul(camHeight.mul(0.1).clamp(0.5, 1));
})();
engine.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 1), bands));
```
```js
import * as THREE from 'three';
import { RenderTarget } from 'three/webgpu';

// wrong: your own requestAnimationFrame loop calling engine.renderer.render(...); the engine runs the only loop and its post chain
const minimap = new RenderTarget(256, 256), top = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 100);
top.position.set(0, 50, 0); top.lookAt(0, 0, 0);
engine.onFrame(() => engine.renderOnce(minimap, top));   // one extra picture per frame; a fresh node frame each call
```
```js
import { RenderPipeline } from 'three/webgpu';

// wrong: new PostProcessing(renderer) from older three examples (three 0.187 names it RenderPipeline), and a second pipeline beside the engine's
console.log(engine.post.object()?.pipeline instanceof RenderPipeline);   // the engine's own, once its chain is built; add effects with engine.post.add
```
Also: three's `uniform` takes a value, not a `{ value }` object, so passing it `engine.uniforms.uWind` throws; use `uniforms(engine).uWind`.
A type mismatch never errors: look at the result (`engine.debug.view('lighting')`, `threedog shot`).
Many materials, many programs: WebGPURenderer builds one program per distinct set of patch uniform objects. Materials given the same
`detail` / `lighting` options through `applyEffects` share theirs, so a hundred stones build one; a patch you write once and pass
to every material shares too, a fresh patch object per material builds one program each.

## GLSL to TSL
| GLSL | TSL (`three/tsl`) |
|---|---|
| `float x = 1.0;` / `vec3(1.0, 0.5, 0.0)` | `float(1)` / `vec3(1, 0.5, 0)`, `color(0xff8000)` for a hex color |
| `a + b`, `a * b`, `-a`, `1.0 - a` | `a.add(b)`, `a.mul(b)`, `a.negate()`, `a.oneMinus()` |
| `x += y;` | `x.addAssign(y)` (x made with `.toVar()`) |
| `mix(a, b, t)`, `smoothstep(e0, e1, x)`, `clamp(x, 0.0, 1.0)` | `mix(a, b, t)`, `smoothstep(e0, e1, x)`, `x.clamp(0, 1)` |
| `uniform float uAmount;` | `const uAmount = uniform(0.5)`, changed by `uAmount.value = 1` |
| the engine's `uTime`, `uWind`, `uDaylight` | `uniforms(engine).uTime` ... (the clock every engine effect reads, not three's own `time`) |
| `varying vec3 vPos;` | built in: `positionWorld`, `normalView`...; your own: `node.toVarying()` |
| `vec4 c = texture2D(map, vUv);` | `const c = texture(map, uv())` |
| `gl_FragCoord.xy` | `screenCoordinate.xy` (pixels), `screenUV` (0-1) |
| `position`, `normal`, `uv` attributes | `positionGeometry`, `normalGeometry`, `const st = uv()` |
| moving vertices (`transformed`, `gl_Position`) | `material.positionNode` (object space), `vertexNode` (clip space) |
| `gl_FragColor = ...` | `colorNode` (lit surface color), `emissiveNode`, `outputNode` (final color) |
| `if (c) {...} else {...}` | `const v = select(c, a, b)`; inside `Fn`, `If` / `Else` blocks |
| `for (int i = 0; i < 4; i++)` | `Loop` with a count and a callback, inside `Fn` |
| `float f(vec3 p) {...}` | `const f = Fn(([p]) => ...)` |
| `discard;` | `Discard` inside `Fn`, or `alphaTest` with `opacityNode` |
| `#include <threedog_wind>`, `threedogWind(...)` | `import { wind } from 'threedog/tsl'`, `wind(...)` |

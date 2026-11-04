WebGPU and TSL: a small scene where every material is a TSL node material (ground, wind-blown grass, a lantern of your own, a post effect).

# WebGPU and TSL (example)

One field under its own TSL sky: ground mixed from two tones by noise, grass swaying in the engine's wind, a lantern that glows as the day
ends, soft scanlines after tone mapping. Demo: `npm run dev` in the engine package, open `/webgpu-tsl.html` (`?time=0.85` dusk, `&webgl2`
the WebGL2 backend, `&scanlines=0` no post). The engine never imports this folder. Read recipe 56 (`docs/recipes/56-webgpu-tsl.md`) first;
this is the same material written out as a scene.

## Use it
```js
import 'threedog/tsl';                       // first line of main.js on the WebGPU route
import { createEngine, sky } from 'threedog';
import { createPicture } from './techniques/webgpu-tsl/picture/index.js';

const engine = createEngine({ canvas: document.getElementById('view'), renderer: 'webgpu', lights: false });
engine.use(sky());                           // the day's signals; picture/sky.js hides its dome and draws the game's
const picture = createPicture(engine);             // shapes take picture.mat.ground, picture.mat.grass, picture.mat.lantern (main.js here)
await engine.start();
```

## How it works
- **Your node, the engine's function.** `wind()`, `cloudShadow()`, `season()`, `detailNoise()` come from `threedog/tsl` and are ordinary
  TSL functions: they take nodes and return nodes, so they go anywhere a node goes (`colorNode`, `positionNode`, inside your own `Fn`).
- **The engine's values as nodes.** `uniforms(engine)` gives `uTime`, `uWind`, `uDaylight`, `uSunDir`... as nodes over `engine.uniforms`.
  The lantern's glow is a function of `uDaylight`; the sky moves that value, the node follows, and there is no per-frame code.
- **Grass shadows sway by themselves.** three's shadow pass draws with the material's `positionNode`, so moving vertices there moves
  their shadow too. (On WebGL the same needs a depth material; that is the engine patch's job there.)
- **The sky is a node too.** `picture/sky.js` is a gradient sphere with a `MeshBasicNodeMaterial`; the fog takes its horizon color.
- **Post is a node too.** The function given to `engine.post.add` returns the new color. `slot: 'ldr'` puts it after tone mapping, where
  colors are what the screen shows; an effect that should glow or bleed belongs in `hdr` instead. Its strength is a `uniform()` of your own
  (`picture.scanlines.value = 0.2`): a write is live, with no rebuild.

## Knobs (`picture/palette.js`)
Colors, light levels, tone curve, `GRASS.sway` (meters per meter of blade height, times the weather's wind), `SCANLINES`. Field size and blade
count sit at the top of `main.js` (one InstancedMesh, one draw call). The colors are neutral placeholders: take them from the game's DESIGN.md,
not from here.

## Adapting it
- Rotated or scaled grass instances: the offset must turn with each instance. Use the patch form, `applyEffects(mat, { wind: 0.25 })`, which
  does that (recipe 56, section 5), instead of `positionNode` by hand.
- A different look for the ground (stripes, rock by slope, a texture): replace the `colorNode` expression; keep `.mul(cloudShadow(positionWorld))`
  if the game has cloud shadows.
- Cost: TSL compiles when a material is first drawn. Many distinct materials mean a longer first frame on WebGPU (recipe 56 says when
  WebGL is the better choice).

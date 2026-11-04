# 2D radiance cascades (optional example)

Screen-space global illumination for top-down and side-view games: lamps, lit windows and neon signs light the floor around them, walls block
that light and cast soft shadows, coloured lights mix. It is an example you copy, not an engine module: the engine never imports it and
nothing installs it. Run it with `npm run dev` and open `/rc2d.html` (`?quality=low|medium|high`, `cascades=auto|1..8`, `interval=4`, `apply=0`).

## When to use it
- A fixed top-down or side-on camera (orthographic or nearly so) where light should spread over the floor and stop at walls, with many
  or large light shapes (a whole neon bar is one light, at no extra cost per light).
- Not for a free 3D camera: it only knows what is on screen, in the screen plane. A light off screen gives no light, and height is ignored.
  For a few point lights in 3D, three.js lights (`engine.lightPool` for many) are cheaper and correct.

## How to copy it into a game
1. Copy `rc2d.js` and `shaders.js` into your game (`threedog examples pull rc2d`, or by hand). They import only `three` and `three/addons`.
2. Put what light sees on one layer: emitters (any mesh with `material.emissive`, strength `emissiveIntensity`) and occluders (meshes
   without emissive). `mesh.layers.enable(5)` keeps them visible to the normal camera too. The floor stays off the layer: it receives light.
3. `const rc = createRadianceCascades2D(engine, { layer: 5, ambient: 0.15 })`. Each frame it renders in `engine.onRender`. `rc.pass` is a plain
   three.js `ShaderPass` that adds the light to the frame, `color * (1 + light / ambient)`: put it in your post chain before the tone curve, as
   this example's `picture/post.js` does. Set `ambient` to how bright your scene's own light already is, so the light lands on the surface colour
   (albedo = color / ambient).
4. Or leave `rc.pass` out and read `rc.texture` (linear light per screen uv) in your own materials. `rc.target` is its render target.
5. `rc.describe()` (size, cascades, intervals, targets), `rc.resize()` (also checked every frame), `rc.dispose()` (frees every target and the
   pass; take the pass out of the chain first).

Colours and strengths are the game's: change a lamp's `emissiveIntensity` and the light follows the same frame (flicker, day / night).
`threedog examples pull rc2d` copies the two files and this README into the game (`techniques/rc2d/`), or copy them by hand.

The demo's own picture (ambient light, emitter colours, tone curve, the flicker) is plain three.js in `picture/`; only `rc2d.js` and `shaders.js` travel.

## Parameters (all in `RC2D_DEFAULTS` / `RC2D_QUALITY` at the top of `rc2d.js`)
| Option | Default | Meaning |
|---|---|---|
| `quality` | `'medium'` | `low` / `medium` / `high`: resolution 1/4, 1/2, 1x of the canvas (CSS pixels) and 16 / 24 / 32 march steps per ray |
| `cascades` | `'auto'` | how many cascades; auto = enough for the longest ray to cross the screen diagonal |
| `interval` | `4` | cascade 0's ray length in RC pixels; each cascade above is 4x longer. Larger = smoother, softer contact light |
| `layer` | `5` | the three.js layer of emitters and occluders |
| `ambient` | `1` | the scene's own light level, see step 3 |

## Cost (1280x720 canvas, measured 2026-11-02, the demo scene)
- GPU (AMD Radeon 780M integrated, D3D11): frame 3.6 ms without, about 15.8 ms with `medium`, 32.6 ms with `high`; `low` about 14 ms
  (at low the fixed cost of ~20 passes dominates). Use `low` or `medium` on integrated graphics.
- Software rendering (headless SwiftShader): about 16x a plain frame at `medium`; only for tests.
- Memory: about 10 half-float targets the size of the RC resolution (two float targets for the jump flood).

## Limits
- Screen space: nothing off screen contributes, and what moves off screen stops lighting.
- Occluder tops stay as the scene lights them (rays start inside them and see no light); light is 2D, so a lamp on a roof lights the
  floor beside the building as if it stood on the ground.
- Thin occluders under about one RC pixel (2 screen pixels at `medium`) can leak.
- The merge uses the paper's "bilinear fix" (4 rays per merge) against leaks and rings; it is the main cost.

## Sources
Written from the public descriptions, no code copied: Alexander Sannikov, "Radiance Cascades: A Novel Approach to Calculating Global
Illumination" (2023); jason.today, "Building Real-Time Global Illumination" (parts 1 and 2: jump flood, distance field, cascades);
GM Shaders, "Radiance Cascades".

This example is written in GLSL: it is the WebGL route (`threedog new-game --webgl`). A game on the default WebGPU route writes the same ideas in TSL (recipe 56).

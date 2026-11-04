# Bring your own renderer: `createEngine({ renderer })`

Pass a ready three.js renderer when the game must own it (shared canvas, an editor, a custom context):

```js
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const engine = createEngine({ renderer });   // canvas defaults to renderer.domElement
```

- The engine configures only a renderer it created itself. With yours it sets nothing: pixel ratio (unless `pixelRatio` is given), size, tone mapping, exposure and shadow map stay as you left them, so set them yourself on the renderer. MSAA follows your renderer's `antialias` too (unless `createEngine({ antialias })` or `style.antialias` says otherwise; a value that differs from the renderer's runs the post chain's MSAA targets every frame).
- **WebGLRenderer or three's WebGPURenderer.** On WebGPURenderer, materials, patches and post effects take their node / TSL forms (recipe 56). Everything else (scene, modules, input, saves, ops) does not depend on the renderer.
- Changing the renderer, lights or post effects is yours to do at any time; the engine never warns. `engine.describe().render` (CLI: `describe render`) lists the current values and tags each `engine` / `style` / `game`, so an AI can see who set a picture.

# Bring your own renderer: `createEngine({ renderer })`

Pass a ready three.js renderer when the game must own it (shared canvas, an editor, a custom context):

```js
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const engine = createEngine({ renderer, style });   // canvas defaults to renderer.domElement
```

- The engine configures only a renderer it created itself. With yours it sets nothing: pixel ratio (unless `pixelRatio` is given), size, tone mapping, exposure and shadow map stay as you left them, so `style.toneMapping` / `style.exposure` do not apply. Set them yourself on the renderer.
- **WebGL is the fully supported path.** Shader patches (recipe 43) and post effects (the `EffectComposer` chain) are written for `WebGLRenderer`; a WebGPU-style renderer may not run them. Everything else (scene, modules, input, saves, ops) does not depend on the renderer.
- Changing the renderer, lights or post effects is yours to do at any time; the engine never warns. `engine.describe().render` (CLI: `describe render`) lists the current values and tags each `engine` / `style` / `game`, so an AI can see who set a look.

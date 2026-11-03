# @threedog/post-effects

Optional post effects for [threedog](https://www.npmjs.com/package/threedog): `bloom`, `ao` (ambient occlusion), `outline`, `dof` (depth of field) on the HDR side, and `lut` (color grade), `grain`, `vignette`, `chromatic` (chromatic aberration) fused into one fullscreen LDR pass. Import only what you use; the engine itself ships no effects.

```sh
npm install @threedog/post-effects@0.5
```

This describes 0.5.0: `npm install @threedog/post-effects@0.5` (games made in the [repository](https://github.com/penstic123-code/ThreeDog.js-Game-Engine) already have it).

Each effect is one value that runs on WebGL and on WebGPU. It goes in the way every post effect does, `engine.look.post.add`:

```js
import { bloom, vignette } from '@threedog/post-effects';

engine.look.post.add(bloom({ strength: 0.6 }));            // game code
// or a file in the game's plugins/ folder, or in a style's style/plugins/ folder:
// plugins/20-vignette.js
export default vignette();
```

An added effect is on unless it says `enabled: false`; the costly ones (`bloom`, `ao`, `dof`, outline `normal` / `both`) that a style's plugins bring start off on low-tier devices. On / off and tuning: `engine.look.post.set({ bloom: false, 'ao.radius': 0.6 })`.

Docs ship with the engine: `node_modules/threedog/docs/recipes/52-look.md` (post-effect chain, order, depth readers) and `docs/AI.md`.

Peer dependencies: `threedog` and `three` (the same copy the game uses). MIT license.

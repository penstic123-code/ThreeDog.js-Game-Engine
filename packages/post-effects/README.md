# @threedog/post-effects

Optional post effects for [threedog](https://www.npmjs.com/package/threedog): `bloom`, `ao` (ambient occlusion), `outline`, `dof` (depth of field) on the HDR side, and `lut` (color grade), `grain`, `vignette`, `chromatic` (chromatic aberration) fused into one fullscreen LDR pass. Import only what you use; the engine itself ships no effects.

```sh
npm install @threedog/post-effects@0.6
```

This describes 0.6.0: `npm install @threedog/post-effects@0.6` (games made in the [repository](https://github.com/penstic123-code/ThreeDog.js-Game-Engine) already have it).

Each effect is one value that runs on WebGL and on WebGPU. It goes in the way every post effect does, `engine.post.add`:

```js
import { bloom, vignette } from '@threedog/post-effects';

engine.post.add(bloom({ strength: 0.6 }));            // game code
// or a file in the game's plugins/ folder, or in a style's style/plugins/ folder:
// plugins/20-vignette.js
export default vignette();
```

An added effect is on unless it says `enabled: false`. The heavy ones (`bloom`, `ao`, `dof`, outline `normal` / `both`) are the game's call on weak devices: read `engine.tier` before adding them. `engine.post.add` returns a handle; on / off and tuning go through it: `glow.enabled = false`, `engine.post.get('ao').set({ radius: 0.6 })`.

Docs ship with the engine: `node_modules/threedog/docs/recipes/52-around-the-picture.md` (post-effect chain, order, depth readers) and `docs/AI.md`.

Peer dependencies: `threedog` and `three` (the same copy the game uses). MIT license.

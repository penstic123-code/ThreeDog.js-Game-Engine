# @threedog/post-effects

Optional post effects for [threedog](https://www.npmjs.com/package/threedog): `bloom`, `ao` (ambient occlusion), `outline`, `dof` (depth of field) on the HDR side, and `lut` (color grade), `grain`, `vignette`, `chromatic` (chromatic aberration) fused into one fullscreen LDR pass. Import only what you use; the engine itself ships no effects.

```sh
npm install @threedog/post-effects
```

```js
import { createEngine, postAdd } from 'threedog';
import { bloom, vignette } from '@threedog/post-effects';
import base from './style/index.js';

// effects are part of the look: added to the game's style
createEngine({ canvas, style: [base, postAdd(bloom({ strength: 0.6 }), vignette({ enabled: true }))] });
```

A listed effect is on unless it says `enabled: false`; the costly ones (`bloom`, `ao`, `dof`, outline `normal` / `both`) start off on low-tier devices. Tuning at runtime: `engine.look.post.set({ 'ao.enabled': true })`.

Docs ship with the engine: `node_modules/threedog/docs/recipes/52-look.md` (post-effect chain, order, depth readers) and `docs/AI.md`.

Peer dependencies: `threedog` and `three` (the same copy the game uses). MIT license.

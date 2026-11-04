# threedog

A web 3D game engine on three.js 0.187: **core** (rendering, main loop, input, audio, saving, UI) -> **modules** (terrain, sky and weather, physics, characters, dialogue, inventory, quests... installed on demand); all art is the game's own (`picture/` folder, `assets.js`).

## Install
This README describes threedog 0.6.0 (older releases on npm do not match it; upgrade steps are in `docs/MIGRATING-0.6.md`). To work on the engine itself, clone the [repository](https://github.com/penstic123-code/ThreeDog.js-Game-Engine), run `npm install`, then `npm run new-game -- my-game`. A game in its own folder:
```sh
npm install threedog@0.6 three@~0.187.0
npm install @threedog/terrain-noise@0.6      # optional: the noise terrain generator terrainPreset() (without one the ground is flat)
npm install -D vite @threedog/tools@0.6      # optional: the vite preset and the threedog command line
```
Then let it set up the folder: `node node_modules/@threedog/tools/bin/threedog.mjs init` (flags: `--open-world` for generated ground, sky, follow camera and a player, `--example` for a small gameplay sample on top; the default is a blank scene with a camera and a gray starter picture in `picture/`) writes index.html, main.js, vite.config.js, content/, CLAUDE.md and `.mcp.json` (Claude Code then starts the threedog MCP server by itself), never overwriting a file you have.
`three` is a peer dependency: your game and the engine share one copy. Types for three come with the engine (`@types/three`, same version), so `// @ts-check` JS and TypeScript both see real three.js types.

## Minimal usage
```js
import { createEngine, presets, openWorld } from 'threedog';
import { terrainPreset } from '@threedog/terrain-noise';   // optional terrain generator (npm install @threedog/terrain-noise)

const engine = createEngine({ canvas: document.getElementById('view') });   // no picture code yet: gray placeholders
engine.use(openWorld({ camera: 'follow', seed: 7, terrain: terrainPreset() }));
engine.characters.createPlayer({ ...presets.player.thirdPerson });
engine.start();
```
The picture is the game's own: plain three.js in its `picture/` folder (what `threedog new-game` generates), reading signals from `engine.uniforms`.
`vite.config.js` with the preset: `import { gameConfig } from '@threedog/tools/vite'; export default gameConfig(import.meta.dirname);`

## Entry points
- `threedog`: the whole public API (`THREE` is re-exported, so `import { THREE } from 'threedog'` is the same three instance).
- The engine ships no art (visuals only; the noise terrain generator `terrainPreset()` is `@threedog/terrain-noise`); without picture code everything is a neutral gray placeholder.
- `threedog/error-hints`: the developer error hint table (used by `@threedog/tools`).

Nothing else is a public path; files under `core/`, `modules/` etc. may move between versions.

## Changes to three.js
The engine changes three.js in a few places, because three.js has no per-object hook for what it needs. `describe().threePatches` lists every one at run time, `threePatches.off(id)` turns off the ones that can be turned off, and `docs/THREE.md` says what each does to your code. Importing the engine does these page-wide:
- `Object3D.prototype.add` / `remove` are wrapped once, so `scene.add` is adopted like `engine.add`.
- `Mesh.prototype.customDepthMaterial` and `customDistanceMaterial` become accessors: when nothing was assigned, a mesh whose material has engine vertex patches (wind sway) returns a matching depth material, so its shadow moves with it. Assigning a value still wins; assigning `undefined` restores the default.
- `THREE.ShaderChunk` gains `threedog_*` entries (new names, none of three's replaced).

Raycasting is not a global change: a mesh registered as static gets its own bounds tree and its own `raycast`; `Mesh.prototype.raycast` is untouched.

## Docs
Shipped in the package: `docs/AI.md` (how to use the engine, written for AI assistants), `docs/API.md` + `docs/api/` (per module), `docs/recipes/` (task guides), `docs/THREE.md` (using three.js directly).

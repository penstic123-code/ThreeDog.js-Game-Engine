# threedog

A web 3D game engine on three.js 0.187: **core** (rendering, main loop, input, audio, saving, UI) -> **modules** (terrain, sky and weather, physics, characters, dialogue, inventory, quests... installed on demand) -> **style pack** (all art).

## Install
```sh
npm install threedog three@~0.187.0
npm install @threedog/style-lowpoly          # optional: the low-poly style pack (the engine ships no art)
npm install @threedog/terrain-noise          # optional: the noise terrain generator terrainPreset() (without one the ground is flat)
npm install -D vite @threedog/tools   # optional: the vite preset and the threedog command line
```
Or let it set up the folder: `npx threedog init` writes index.html, main.js, vite.config.js, content/, CLAUDE.md and `.mcp.json` (Claude Code then starts the threedog MCP server by itself), never overwriting a file you have.
`three` is a peer dependency: your game and the engine share one copy. Types for three come with the engine (`@types/three`, same version), so `// @ts-check` JS and TypeScript both see real three.js types.

## Minimal usage
```js
import { createEngine, presets, openWorld } from 'threedog';
import lowpoly from '@threedog/style-lowpoly';              // optional style pack (npm install @threedog/style-lowpoly)
import { terrainPreset } from '@threedog/terrain-noise';   // optional terrain generator (npm install @threedog/terrain-noise)

const engine = createEngine({ canvas: document.getElementById('view'), style: lowpoly });
engine.use(openWorld({ camera: 'follow', seed: 7, terrain: terrainPreset() }));
engine.characters.createPlayer({ ...presets.player.thirdPerson });
engine.start();
```
`vite.config.js` with the preset: `import { gameConfig } from '@threedog/tools/vite'; export default gameConfig(import.meta.dirname);`

## Entry points
- `threedog`: the whole public API (`THREE` is re-exported, so `import { THREE } from 'threedog'` is the same three instance).
- Style packs are separate packages: the engine ships no art. `npm install @threedog/style-lowpoly` for the optional low-poly one (visuals only; the noise terrain generator `terrainPreset()` is `@threedog/terrain-noise`); without a style pack everything is a neutral gray placeholder.
- `threedog/error-hints`: the developer error hint table (used by `@threedog/tools`).

Nothing else is a public path; files under `core/`, `modules/` etc. may move between versions.

## Global changes to three.js
Importing the engine changes two defaults on `THREE.Mesh.prototype`, for every mesh in the page:
- `Mesh.prototype.raycast` is replaced by three-mesh-bvh's accelerated raycast (`BufferGeometry.prototype.computeBoundsTree` / `disposeBoundsTree` are added). Results are the same as three's own raycast; meshes without a bounds tree fall back to it.
- `Mesh.prototype.customDepthMaterial` and `customDistanceMaterial` become accessors: when nothing was assigned, a mesh whose material has engine vertex patches (wind sway) returns a matching depth material, so its shadow moves with it. Assigning a value (including in your own code) still wins; assigning `undefined` restores the default. The value is stored under a symbol, so `Object.hasOwn(mesh, 'customDepthMaterial')` is false.

## Docs
Shipped in the package: `docs/AI.md` (how to use the engine, written for AI assistants), `docs/API.md` + `docs/api/` (per module), `docs/recipes/` (task guides), `docs/THREE.md` (using three.js directly).

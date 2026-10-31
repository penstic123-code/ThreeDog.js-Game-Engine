# ThreeDog.js-Game-Engine
<p align="center">
  <img
    src="https://github.com/user-attachments/assets/1f8c2da7-0ffe-433f-b3db-eec7f2eabac6"
    alt="threedog-logo"
    width="160"
  />
</p>

An AI-Native Game Development Engine built on three.js, designed for AI-assisted game development.

Build games with modular systems, data-driven content, and interchangeable style packs. Inspect game state as structured data, reproduce scenarios, and validate changes through automated checks.

Designed for AI-assisted workflows

Inspectable state — Read game state as JSON or concise text to understand what is happening.

Reproducible testing — Set up scenarios, simulate input, and advance fixed-step simulation.

Data-driven gameplay — Define items, NPCs, dialogue, quests, and world content in game-owned data files.

Modular systems — Install the systems your game needs, with explicit dependencies.

Separate art and gameplay — Keep visual and audio choices in style packs.

Direct three.js access — Work with native three.js scenes, cameras, meshes, and materials.

Project status

Under active development. APIs and workflows may change before the first stable release

---

## Getting started

> **Early preview.** APIs and names will still change, and it is not published to npm yet. Expect breaking changes until v0.1.0. Licensed MIT.

A low-poly web 3D game engine on three.js 0.187, in three layers: **core** (rendering, main loop, input, audio, saving, UI) -> **modules** (terrain, sky and weather, physics, characters, dialogue, inventory, quests... installed on demand) -> **style pack** (all art).
The engine provides mechanisms and never hard-codes art. It ships with one low-poly style pack and two examples: an open-world photography game (`/`) and a top-down small city with no terrain and no style pack (`/city.html`).

中文说明见 [README.zh-CN.md](README.zh-CN.md).

The repository is npm workspaces: `packages/engine` (the engine package `threedog`), `packages/tools` (tools `@threedog/tools`, CLI `threedog`), `games/*` (one folder per game).

## Run it
1. Install [Node.js](https://nodejs.org) (LTS).
2. In this folder open a terminal: `npm install`, then `npm run dev`.
3. Open the address shown in the terminal (usually http://localhost:5173); the small-city example is at `/city.html`.
4. To open one game: `npm run dev -w games/<game>` (or `npm run dev -- <part of the name>`).

Keys (open-world example): WASD move · Shift run · drag to turn the view · E interact · I inventory · J quests · P photo mode · Esc settings · F3 performance panel.

## Minimal usage
```js
import { createEngine, openWorld } from 'threedog';
import lowpoly from 'threedog/styles/lowpoly';

const engine = createEngine({ canvas: document.getElementById('view'), style: lowpoly });
engine.use(openWorld({ seed: 7 }));          // terrain seed; the preset installs only world and environment, add gameplay modules (dialogue, inventory, quests, photo...) yourself; or install just what you need: engine.use(sky(), collision(), followCamera(), characters())
engine.characters.createPlayer();
engine.start();
```

Using the published packages in your own project (outside this repository): see [packages/engine/README.md](packages/engine/README.md) (install, entry points).

**Global changes to three.js**: importing the engine replaces `THREE.Mesh.prototype.raycast` (three-mesh-bvh's accelerated raycast) and turns `THREE.Mesh.prototype.customDepthMaterial` into an accessor whose default is a depth material that follows the engine's wind sway. Details in [packages/engine/README.md](packages/engine/README.md#global-changes-to-threejs).

## Documentation
| File | Content |
|---|---|
| `packages/engine/docs/AI.md` | How to use the engine (written for AI assistants): reading order, entry points, conventions |
| `CLAUDE.md`, `.claude/rules/` | Rules for developing the engine itself (Claude Code reads them first) |
| `packages/engine/docs/API.md` + `packages/engine/docs/api/` | API index + one page per module (generated) |
| `packages/engine/docs/recipes/` | Task-based guides: new game, NPC, items, quests, weather, importing Blender models, vehicles, animation, performance... |
| `packages/engine/docs/CODEMAP.md` | Engine files, events, per-frame order (generated) |
| `packages/engine/docs/THREE.md` | How to use three.js directly for what the engine lacks |
| `packages/engine/docs/PERF.md` | How to measure performance and reference numbers |

Common commands: `npm run dev` develop · `npm run check` check · `npm test` test · `npm run map` regenerate docs · `npm run perf` performance comparison · `npm run build` bundle (each workspace into its own `dist/`). For one game only add `-w games/<game>` (e.g. `npm test -w games/my-game`).

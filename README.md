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

Separate art and gameplay — Keep visual choices in style packs, sounds in the game's own config or content packs.

Direct three.js access — Work with native three.js scenes, cameras, meshes, and materials.

Project status

Under active development. APIs and workflows may change before the first stable release

---

## Features

### Built for AI
| Feature | What it does |
|---|---|
| Layered docs | An index (`AI.md`), task recipes, and API pages generated from code comments; an AI reads only what the task needs |
| `llms.txt` | Standard entry file that AI tools look for, with the reading order |
| Game state as text | One call turns the whole game state into a short text summary; expand any part on demand |
| One action API (`engine.ops`) | Player, NPC and AI actions go through the same named operations: check first, run, log, undo, replay |
| Explains "why not" | When an action can't run, the engine says why and how to fix it (e.g. "the door is locked, needs a key") |
| Errors with codes and fixes | Every engine error carries a stable code, a suggested fix and a docs link |
| Drive a running game | CLI and MCP tools let an AI press keys, step time, run actions, inspect and take screenshots (Claude Code, Cursor) |
| Text-based tests | Scenario tests and state snapshots instead of fragile screenshot comparisons |
| Generated maps | Engine and game maps list files, content, templates, grids and events, plus what to read for this game |
| Docs that can't go stale | Checks fail when docs mention names or paths that no longer exist, or grow too large |

### Performance
| Feature | What it does |
|---|---|
| Streaming world | Only the area around the player and camera is loaded; leaving an area unloads visuals but keeps its data |
| Far-away simplification | Distant objects merge into simple proxies and switch back to detail up close |
| Automatic batching | Repeated static models are drawn as one batch per cell (3000 props: 43x fewer draw calls in our test) |
| Worker threads | Terrain generation, pathfinding and far simulation can run off the main thread |
| World keeps running | Crops grow and NPCs follow schedules out of sight, at a lower cost |
| Asset compression | One command compresses models and textures (Meshopt, WebP / KTX2) |
| Pay only for what you use | Systems are installed on demand; unused modules cost nothing |
| Pauses when hidden | The game pauses when the tab loses focus and does not fast-forward on return |

### Visuals
| Feature | What it does |
|---|---|
| Style packs | Colors, shapes, lighting and post effects live in a swappable style pack; the engine itself has no default look |
| Optional low-poly look | `@threedog/style-lowpoly`: a style pack (sky, materials, post, terrain colors) and an asset pack of low-poly models, installed only if you want it; style parts mix: `style: [lowpoly, { sky }]` |
| Optional noise terrain | `@threedog/terrain-noise`: `terrainPreset()` hills / island / canyon / plain, rivers and a biome table (world shape only, colored by whichever style pack you use) |
| Day, night and sky | Sun movement, sky colors over time, moving cloud shadows |
| Weather and seasons | Rain and snow; plant colors change with the season |
| Wind | Grass and trees sway |
| Water | Waves and reflections, or plug in your own water material |
| Post effects | Bloom, outlines, ambient occlusion and your own effects, in ordered slots |
| Skeletal animation | Use animated glTF models exported from Blender and similar tools |
| Art is replaceable | Characters, plants, ground and water can all use your own models and materials |

### Ready-made systems (the game decides the rules)
| System | What it gives you |
|---|---|
| Saves | Save, load, new game, continue; a failed save never overwrites the old one |
| Time | Game clock, timed events, skip time (e.g. sleep until morning) |
| Grid placement | Farming plots, furniture, buildings, with rotation and "can it go here" checks |
| Editable terrain | Dig, raise, flatten and repaint ground; edits are saved |
| Object templates | Define a thing once and place it anywhere |
| Inventory and items | Stackable items or items with their own data |
| Dialogue and quests | Branching dialogue and quest steps, with explanations when a quest is stuck |
| NPCs | Schedules and near / far switching |
| Characters and physics | Movement, collision, rigid bodies, vehicles |
| Pathfinding | Grid pathfinding and navmesh, optionally in a worker |
| Input contexts | Menus block movement keys automatically, layer by layer |
| Multiplayer (experimental) | Basic networked sync |

### Freedom
| Feature | What it does |
|---|---|
| No hard-coded controls | Keys, movement and camera can all be replaced |
| No hard-coded UI | HUD, dialogue box, menus, inventory and loading screen are defaults you can replace or turn off |
| Not tied to one genre | Usable for farming, action, exploration and building games |
| It is three.js | Engine objects are native three.js objects; three.js knowledge and add-ons still apply |

## Getting started

> **Early preview.** APIs and names will still change, and it is not published to npm yet. Expect breaking changes until v0.1.0. Licensed MIT.

A web 3D game engine on three.js 0.187, in three layers (core, modules, style pack) that [packages/engine/README.md](packages/engine/README.md) lays out.
The engine provides mechanisms and ships no art: without a style pack everything is a neutral gray placeholder. An optional low-poly style pack (`@threedog/style-lowpoly`) and two examples come with the repository: an open-world photography game (`/`) whose level lives entirely in content files, and a one-room action game (`/action.html`: player, enemy, drop; the combat rules are the example's own ops).

中文说明见 [README.zh-CN.md](README.zh-CN.md).

The repository is npm workspaces: `packages/engine` (the engine package `threedog`), `packages/tools` (tools `@threedog/tools`, CLI `threedog`), `packages/styles/lowpoly` (the optional style pack `@threedog/style-lowpoly`), `packages/terrain-noise` (the optional terrain generator `@threedog/terrain-noise`), `games/*` (one folder per game).

## Run it
1. Install [Node.js](https://nodejs.org) (LTS).
2. In this folder open a terminal: `npm install`, then `npm run dev`.
3. Open the address shown in the terminal (usually http://localhost:5173).
4. To open one game: `npm run dev -w games/<game>` (or `npm run dev -- <part of the name>`).

Keys (open-world example): WASD move · Shift run · drag to turn the view · E interact · I inventory · J quests · P photo mode · Esc settings · F3 performance panel.

## Minimal usage
```js
import { createEngine, presets, openWorld } from 'threedog';
import lowpoly from '@threedog/style-lowpoly';                    // optional: without it everything is gray placeholders
import { terrainPreset } from '@threedog/terrain-noise';         // optional: without it the ground is flat

const engine = createEngine({ canvas: document.getElementById('view'), style: lowpoly });
engine.use(openWorld({ camera: 'follow', seed: 7, terrain: terrainPreset() }));          // terrain seed and generator (without one the ground is flat); the preset installs only world and environment, add gameplay modules (dialogue, inventory, quests, photo...) yourself; or install just what you need: engine.use(world(), sky(), collision(), followCamera(), characters())
engine.characters.createPlayer({ ...presets.player.thirdPerson });
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

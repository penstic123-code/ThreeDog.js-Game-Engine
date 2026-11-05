<p align="center">
  <img src="docs/brand/threedog-square.png" alt="ThreeDog.js logo: three cartoon dogs" width="200">
</p>

<h1 align="center">ThreeDog.js</h1>

<p align="center">
  An engine for AI agents to build web games on three.js.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

<p align="center">
  English · <a href="README.zh-CN.md">中文</a>
</p>

## What it is

An AI coding agent asked for a three.js game starts from an empty scene. Before it reaches the gameplay it has to write saving, a clock, input, collision and a camera, and in the next game it writes them again, a little differently. Those parts also have to agree with each other: a save has to restore the weather, a cutscene has to stop the player, and a newly loaded stretch of world has to appear in the physics.

ThreeDog writes those shared parts once, so the agent can spend its effort on the rules and the look. It does not hide three.js. Engine objects are ordinary three.js objects, `scene.add`, materials and shaders work as they always do, and a value the game writes directly takes effect. The engine's job is to coordinate systems that would otherwise disagree, and to provide the hard parts most games share: a fixed time step, input, saves, physics, content, streaming of large worlds, an editor, checks and tests.

The look and feel stay with the game, because a style shipped by the engine would turn up in every game made with it. The engine has no default style. A new game starts as neutral gray placeholders, and its own `picture/` folder draws it in plain three.js. The screenshots below show how far apart that lets games go, although nobody has yet compared many runs of one brief for sameness.

## Seven test games and the editor

| | |
|---|---|
| ![First-person view of a shotgun firing at a walker in a walled yard under a pink sky](docs/brand/screens/shooter-yard.jpg) | ![A red car and a blue car side by side on a road through dark pines at dusk](docs/brand/screens/racing-dusk.jpg) |
| **Ochre Yard**, a first-person shooter: three guns, one walled yard | **Dusk Circuit**, a racing game: three laps of a hilly road against one rival |
| ![A fox runs past coins on a flat, paper-cut landscape at sunset](docs/brand/screens/platformer-fox.jpg) | ![Glowing towers beside a stone path on a dark grid, with enemies walking the path](docs/brand/screens/tower-defense-lanterns.jpg) |
| **Kettle Yard**, a 2D side-scroller in a paper-cut style, with a kettle for a boss | **Lantern Road**, tower defense at night with candle, beacon and bell towers |
| ![A timbered town street at night with lit windows and lamps](docs/brand/screens/open-world-town-night.jpg) | ![Huge blue and violet crystals rising from a bright sea under a ringed planet](docs/brand/screens/crystal-sea.jpg) |
| **Ember Road**, an open world with a quest chain and a day and night cycle | **crystal**, a shader-heavy boat flight between crystal islands |
| ![A ghost in a candle-lit ballroom with a checkered floor](docs/brand/screens/haunted-ballroom.jpg) | ![The editor panel beside a gray terrain, with a selected marker and its fields](docs/brand/screens/editor-placing-props.jpg) |
| **The Last Exposure**, photographing ghosts in a haunted house | The in-browser editor on a new game, still in gray placeholders. An added entry is saved to `content/props.js` |

AI agents built these games and scripts drove them. No person has played them yet, so nobody knows whether they are fun, fair or easy to read. The pictures are prototypes made in about 30 to 60 minutes each, not finished art. Some were drawn by real WebGPU and some by the WebGL2 fallback in a headless browser.

## How an AI builds a game

`threedog init` writes a folder the agent can find its way around, along with its instructions and the connection to the tools:

```text
main.js      wires modules and systems together
game/        the rules, one file per system (weapons, enemies, waves)
content/     what stands where, items, NPCs, quests: data that saves can read
picture/     the look, in plain three.js
plugins/     one-file three.js pieces, picked up when dropped in
CLAUDE.md    how to work in this game; .mcp.json connects the tools
```

Game time runs on a fixed step in `engine.onFixed`, which is where damage, cooldowns and enemy AI belong. Animation, the camera and the HUD run per frame. The picture code never asks the engine to draw anything. Each frame the engine offers plain values such as the time of day or how hard it is raining, and the game turns them into ordinary three.js:

```js
engine.onRender(() => {
  sun.intensity = palette.sun * engine.uniforms.uDaylight.value;
});
```

<p align="center"><img src="docs/brand/diagrams/design.png" alt="The loop: the AI writes three.js, the engine plugs it in and coordinates, the AI checks the result" width="760"></p>

The agent works through the `threedog` command line, or the same tools over MCP (Model Context Protocol, which tools such as Claude Code and Cursor use):

| Command | What the agent gets |
|---|---|
| `threedog how "rain at night"` | The one section of the docs that answers the task, so it does not have to read them all |
| `threedog check` | Rules, types, content and misuse of the engine API, ending in one line: passed or failed |
| `threedog play` | The game running in a page the agent can drive; `press`, `step` and `op` work on it |
| `threedog describe` | The running game's state as short text: player, time, weather, camera, open windows |
| `threedog shot --play` | A screenshot and a picture check that reports facts, such as which areas are blown out and which light is the likely cause |
| `threedog verify <scenario>` | A scripted run from `tests/scenarios/`, with PASS or FAIL, what was tested and what was not |

These tools are what make a result checkable. An agent can press keys, advance game time, run a player action and read the outcome as text, without a person at the keyboard. Errors name the rule that was broken and the line to copy, and `verify` lists the actions it never ran next to the ones it did. A script can show that a run reaches its win screen, but not that the run is any fun. The picture check never suggests a target value, because the picture belongs to the game.

## What is in it

<p align="center"><img src="docs/brand/diagrams/arch.png" alt="Layers: your game, modules, core, rendering, three.js and Rapier; agent tools drive and read the game" width="680"></p>

A game installs only the modules it uses, and a module of its own is treated the same as a built-in one.

| Area | Parts |
|---|---|
| Game flow | Fixed-step loop, one time source (slow motion and pause are views of it), saves and autosave that roll back when a load fails, scene flow, cutscenes |
| Input and cameras | Actions grouped by context, rebinding, gamepad; follow, first-person, fixed, strategy and side-view cameras |
| World | Content as data, templates, streaming, terrain, grid placement, vegetation, water, sky, weather, calendar, navmesh and pathfinding |
| Physics | Rapier bodies and joints, ragdolls, vehicles, collision, ray and mouse picking |
| Gameplay | Checked player actions, NPCs, dialogue, quests, inventory, shops, pickups, and `engine.swarm` for hundreds of same-kind moving things |
| Picture helpers | Cascaded shadows, a pool for many lights, a post-effect chain, baked light probes, lightmaps, occlusion culling |
| Interface and sound | HUD, menus, settings, languages, photo mode, audio, music, ambience |
| Tools | Command line, MCP server, in-browser editor that writes back to content files, asset optimizing, stress and performance runs |

A new game starts on WebGPU with TSL, the node shader language of three.js. In a browser without WebGPU the same game runs on the WebGL2 backend of three.js, more slowly. `--webgl` starts a game on GLSL shaders instead. The choice comes first, because picture code is written differently for each route and changing later means rewriting it. A few effects (`voxelGI`, `temporalAA`, `sunShafts`, `lightVolumes`) exist only as TSL.

## What has been tested

**Whole games.** Agents built seven games from short briefs. The four in the first round took 39 to 53 minutes by the agents' own clocks, with other agents sharing the machine, and were playable by script after 15 to 25 minutes. The other three (shooter, racing, 2D) took about 30 to 60 minutes. The [round 1 notes](docs/testing/capability/composite-round-1.md) list what each game proved by script, what it did not, and the engine faults the games turned up.

**Single tasks.** A list of [85 tasks](docs/testing/capability/) covers the engine's modules and command groups, each judged by a script or a stated screenshot. 76 passed, 6 failed and 3 were blocked. At least five of the passes got there only after a workaround, which points to a real defect each time. The runs were not blind, since one agent worked through each batch and carried what it learned from row to row, and much of the work ran on software rendering instead of a real GPU.

**A large scene.** [City acceptance test](docs/testing/field/2026-11-05-city/acceptance.md) (in Chinese): one RTX 5060 laptop, WebGPU, 1280×720. A city 1.9 km across, with 400 blocks, about 6,400 buildings and about 72,000 meshes, ran with 14,000 moving cars and people, 200 NPCs and 8 real lights at a median frame time of about 16 ms (about 60 fps).

- This is a measured limit, not a figure with room to spare. Doubling the cars and people to 28,000 dropped it to 26 to 35 fps.
- The machine was under load the whole time, with CPU use at 95 to 100% because other tests were running. There is no figure for a quiet machine. The medians are steady, while the slowest frames are only a rough guide, and one frame of 903 ms in the long run has no known cause.
- A 10-minute walk showed no leak, and all 12 rounds of saving and loading the 14,000 objects came back correct. Loading a save stalls one frame for about 0.2 to 0.8 seconds.
- The camera moved along a route with no real player or collision, the NPCs were gray capsules, and the page ran in a headless browser on this one machine. The WebGL route was not run.

**Small games.** The engine saves less than you might hope here. In ten timed runs of two small games, half with the engine and half with plain three.js, about two thirds of the code was picture code, so the engine could save perhaps a fifth of the work. Larger games have not been measured that way.

**The engine's own tests.** The suite holds about 6,000 checks in about 830 items. The full suite runs locally before a release. CI on Linux runs the static checks, a smaller group of browser tests and a build.

## Status

ThreeDog is heading to 1.0 and is not there yet.

- npm holds version 0.7.0. The code on `main` is ahead of it, and this page describes `main`. The editor and `engine.swarm` are not in the npm release yet.
- The interface may still change before 1.0, and there is no compatibility layer between versions.
- It is tested on Windows and on Linux CI. Mac and phones are not tested.
- Multiplayer is not a goal for now. A basic `engine.net` exists and is not being developed.
- The engine ships no art, so writing the picture is always the game's job.

## Quick start

You need [Node.js](https://nodejs.org) 20.19+ or 22.12+. These steps install 0.7.0 from npm:

```sh
mkdir my-game && cd my-game
npm init -y
npm install threedog three@~0.187.0
npm install -D @threedog/tools
npx threedog init --open-world   # ground, sky, follow camera and a player; never overwrites a file
npm install                      # installs what the new files need
npm run dev                      # open the address it prints
```

Without `--open-world` the game starts as a blank scene with a camera and a gray `picture/` folder. Open Claude Code in the folder and it finds the engine's docs and MCP server by itself; it asks once to trust the server. Then ask it for a game, or try the tools yourself:

```sh
npx threedog how "day and night cycle"   # which recipe answers a task
npx threedog play                        # start the game for the tools
npx threedog describe                    # read its state
npx threedog shot --play                 # a screenshot and the picture check
npx threedog play --stop                 # stop the dev server
```

To work from `main`, where a new game is linked to the engine source and F2 opens the editor on the dev server:

```sh
git clone https://github.com/penstic123-code/ThreeDog.js-Game-Engine.git
cd ThreeDog.js-Game-Engine
npm install
npm run new-game -- my-game --open-world
npm run dev -- my-game
```

## Packages

| Package | What it is |
|---|---|
| [`threedog`](packages/engine) | The engine |
| [`@threedog/tools`](packages/tools) | The `threedog` command line, the MCP server and the tools that drive a running game |
| [`@threedog/post-effects`](packages/post-effects) | Optional post effects: color grading, film grain, vignette, depth of field and more |
| [`@threedog/terrain-noise`](packages/terrain-noise) | Optional noise-based terrain: hills, islands, canyons, rivers |

## Read more

| File | Content |
|---|---|
| [docs/philosophy.md](docs/philosophy.md) | Why the engine works this way, who does what, how separate code shares a frame |
| [docs/faq.md](docs/faq.md) | Common doubts, including what the engine cannot do |
| [docs/evolution.md](docs/evolution.md) | How the design changed, wrong turns included |
| [packages/engine/docs/AI.md](packages/engine/docs/AI.md) | Where an agent starts: one line per task, pointing to the detail |
| [packages/engine/docs/recipes/](packages/engine/docs/recipes) | Guides by task, from a new game to vehicles and performance |
| [packages/engine/docs/COMMANDS.md](packages/engine/docs/COMMANDS.md) | Every command |
| [packages/engine/docs/API.md](packages/engine/docs/API.md) | API index, generated from code comments |
| [packages/engine/docs/THREE.md](packages/engine/docs/THREE.md) | Using three.js directly next to the engine |
| [packages/engine/CHANGELOG.md](packages/engine/CHANGELOG.md) | What changed in each version |

## License

[MIT](LICENSE). The logo is AI-generated, and the screenshots are rendered by the engine. Asset details are in [ASSETS.md](ASSETS.md).

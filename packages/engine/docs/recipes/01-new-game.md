# Starting a new game (a workspace under games/)

**In this recipe**: 0. One-command setup · 1. Creating the files by hand · 2. Verify · 3. Preset parts · 4. Feel presets · 5. Canvas size

Goal: create `games/my-game/` (pick your own name) with its own page, modules, content data and tests, independent of other games. Start from the
template (`threedog new-game my-game`, section 0); the engine's own example is `examples/world/` in the package.

## 0. One-command setup (preferred)
```
npm run new-game -- my-game                     # blank start: an empty scene and a camera; no gameplay, no genre assumed
npm run new-game -- my-game --open-world        # generated ground, a day/night sky, a follow camera and a player
npm run new-game -- my-game --webgl             # either one on WebGL, shaders in GLSL, instead of WebGPU and TSL
```
(The `--` matters: without it npm swallows the flags. The CLI form takes them directly: `threedog new-game my-game --open-world`.)
A new game runs on WebGPU, shaders in TSL (recipe 56); `--webgl` is for GLSL. Without WebGPU the same game runs on three's WebGL2 backend, slower; `engine.describe().renderer` says which and why.
The name may only contain lowercase letters, digits and dashes; an existing directory under `games/` with the same name is refused. What it does:
1. Copies `packages/tools/templates/game/` to `games/my-game/` (`__NAME__` in the files is replaced by the name); `--open-world` copies `templates/openworld/` over it first.
2. Creates the `node_modules/my-game` link (the path npm gives a workspace named `my-game`). It builds nothing and leaves `package-lock.json` alone; it runs `npm install` only when a dependency of the template is not installed yet, and says so.
3. Runs `map` (generates GAMEMAP.md) and `check`. Any failing step stops and says why. The smoke test (`threedog test -w games/my-game`) builds, so it is left to you.

The default game has no genre: `world()` + `content()`, what nearly every game needs (a start screen with Continue / Start, autosave, Esc = pause + settings menu; delete a line if the game does not want it), the engine's camera placed by hand (a plain `THREE.PerspectiveCamera`) and the gray
starting picture in `picture/` (a sun, an ambient light, the tone curve, written by the game); no ground, sky, player or camera rig, because which of those a game needs depends on its genre (a character walking around a place you built: recipe 63, about twenty lines)
(a card table, a puzzle room, a side-scroller and an open world start differently). Content files are empty arrays / objects (each
has one comment line saying what goes there and which recipe teaches it), and `picture/`: `index.js` (wiring), `palette.js` (colors and key values), `lights.js`, `materials.js`, plain three.js
that is yours to change or replace (recipe 62). `CLAUDE.md` says "This game has no gameplay yet; build what DESIGN.md describes".
`--open-world` swaps `main.js` for `openWorld` (generated terrain from `@threedog/terrain-noise`, vegetation, a day/night sky, weather, water, collision, a
follow camera) and a player at a flat spot, with `sky()` giving the signals and `picture/` writing the lights; it adds `@threedog/terrain-noise` to `package.json`. `spawn` and `places` take any `{ x, z }` (or `{ x, y, z }`); `findSpawn` is only for generated terrain.
In an open-world start, to change the camera: `openWorld({ camera: 'firstPerson' })` (`follow` / `firstPerson` / `rts` / `fixed`, or pass a camera module directly; there is
no default).
- The comments in `main.js` list further gameplay modules you can add; usage is in `../api/<module>.md`.
- To change the starting point of new games, edit the real files in `packages/tools/templates/game/` (`templates/openworld/` for `--open-world`).
- `DESIGN.md` is an empty template: write your gameplay ideas there. `CLAUDE.md` only points the way (read `node_modules/threedog/docs/AI.md` first,
  then GAMEMAP, DESIGN) and does not copy engine rules.
- There is no `tests/`: when `tests/specs/` does not exist, `npm test -w games/my-game` runs a smoke test automatically.

## 1. Creating the files by hand (to learn what each file is, or when the template doesn't fit)
| File | Content |
|---|---|
| `games/my-game/package.json` | Copy `package.json` from the game template (or run `threedog new-game my-game`) and set `name` to `my-game` (the plain game name, in this repository and in a game repo of its own; `@threedog/` is the engine's packages; dependencies `threedog`, `@threedog/tools`, plus `@threedog/terrain-noise` only for an open-world start, and your style (and `@threedog/post-effects` if the pack uses it) only when `main.js` imports it; the game's picture is its own `picture/` folder; scripts dev/build/preview/test/check/map) |
| `games/my-game/vite.config.js` | One line: `export default gameConfig(import.meta.dirname)` (imported from `@threedog/tools/vite`); *.html files in the directory are bundled automatically, no `input` needed. Without `@threedog/tools`, a plain vite config needs `worker: { format: 'es' }` (the engine's Workers are ES modules) or `vite build` fails; `threedog dev / build` on a folder with no vite config uses the preset |
| `games/my-game/index.html` | The page: one `<canvas id="view">` with a CSS size + `/main.js` (for more pages put `xxx.html` in the same directory); see §5 for embedding |
| `games/my-game/main.js` | Install modules, compute places, `content.load`, game-specific logic |
| `games/my-game/content/index.js` | Combines the content files into one object |
| `games/my-game/content/*.js` | Only these names are read: items pickups containers npcs dialogues quests actions places triggers level vegetation props templates audio grids renames rules, plus the game's own kinds (rules.js) |
| `games/my-game/DESIGN.md` | Hand-written design decisions (a few lines of `- **decision**: reason`), copied into GAMEMAP.md |
| `games/my-game/CLAUDE.md` | A few lines: read `node_modules/threedog/docs/AI.md`, then this directory's GAMEMAP.md and DESIGN.md (copy the template's) |
| `games/my-game/public/` | This game's art assets (URL `/models/...`); keep Blender source files in `games/my-game/art/models/`, `npm run assets -- -w my-game` compresses them into `public/optimized/` |

After creating them, run `npm install` once at the repository root (this links the new game into the workspaces so `threedog` can find it).

Outside the engine repository, a game installs `threedog` and `three` (plus your style, `@threedog/post-effects` / `@threedog/terrain-noise` if it imports them,
and `@threedog/tools` as a dev dependency for the CLI and the vite preset). To use an engine folder on disk instead of npm, install it with
`npm install --install-links <folder>`: a plain link skips the engine's own dependencies (Rapier, Recast) and the build cannot resolve them.

In a game's own repository, `threedog check`, `types` and `map` read only the game's sources: `node_modules`, a `vendor/` folder and every `file:` /
`link:` dependency are skipped. To narrow it further, list the sources in the game's `package.json`:
`"threedog": { "src": ["main.js", "src", "content"], "exclude": ["notes"] }` (paths relative to the game folder; `src` defaults to the whole folder).
The template's `tsconfig.json` checks the game files only (`checkJs`), with `lib` ESNext + DOM (dependency typings such as Rapier's use
`Symbol.dispose`) and `skipLibCheck: true`; without a tsconfig, `threedog types` writes the same settings to `.threedog/tsconfig.types.json`.

`games/my-game/index.html` (minimal; the template's `index.html` has the same page with loading styles):
```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>My game</title><style>html,body{height:100%;margin:0;overflow:hidden;background:#141a17}#view{position:fixed;inset:0;width:100%;height:100%;display:block;outline:none}</style>
</head><body><canvas id="view" tabindex="0"></canvas><script type="module" src="/main.js"></script></body></html>
```

`games/my-game/main.js`: the opening lines are written out once, in [recipe 63](63-third-person-start.md) §1 (the blank template's `main.js` has the same opening with `world(), content(), settings()` and the camera placed by hand). What an open-world game with a few gameplay modules changes in it:
```js
// my-game: ... (this first comment line appears in the file table of GAMEMAP.md)
// The opening stays as in recipe 63 §1: createEngine({ canvas, lights: false, ui, saveKey, bindings }), createPicture(engine) after engine.use,
// Object.assign(window, { engine, picture }) (tests, screenshots and the console rely on it), await engine.start().
import { presets, openWorld, interactions, dialogue, inventory, pickups, quests, content } from 'threedog';
import { terrainPreset } from '@threedog/terrain-noise';   // optional terrain generator (nor a world shape)
import data from './content/index.js';

// keys: modules only declare actions, the game binds them (presets.bindings.* are ready-made maps); this goes in createEngine({ bindings })
const bindings = { ...presets.bindings.walk, ...presets.bindings.interact, ...presets.bindings.inventory, ...presets.bindings.quests };
// the preset only covers world and environment; the debug panel is installed in dev builds only (debug: true forces it in release too)
engine.use(openWorld({ camera: 'follow', seed: 42, terrain: terrainPreset(), time: 0.3 }),
  // add gameplay modules as the game needs (a shooter has no inventory); pickups() when items lie on the ground (content pickups)
  interactions({ ...presets.interactions.nearest }), dialogue(), inventory(), pickups(), quests(),
  content());
// the terrain is generated: find flat ground as "home" at the start (give your own height range to avoid beach and peaks)
const home = engine.characters.findSpawn([0, 0, 0], { minH: 3, maxH: 14 });
engine.characters.createPlayer({ ...presets.player.thirdPerson, spawn: home });
engine.content.load(data, { places: { ...data.places, home } });   // content/places.js names + this one; content uses { place: 'home', x, z }, quests target: 'home'
```
Every `openWorld` part takes `false` (leave it out) or its module's own options object, so you never have to drop the preset for one setting:
`openWorld({ seed: 42, camera: 'follow', calendar: { seasons: ['wet', 'dry'], daysPerSeason: 28 }, characters: { npcs: false }, rigid: false, ambience:
false, debug: false })`;
`camera` is required (no default camera) and takes `'follow'` / `'firstPerson'` / `'rts'` / `'fixed'`, a camera module such as
`followCamera({ shoulder: 0.7 })`, or `false`. A game that wants only a few parts (an arena without terrain) turns the rest off the same way:
`openWorld({ camera: 'follow', terrain: false, vegetation: false, weather: false, water: false })`.
With `terrain: false` the game supplies its ground. Until it does, characters, props and pickups stand on an invisible flat plane at y = 0 (no
warning): they look like they float over nothing. Draw the ground yourself, and if it is not flat at y = 0 tell the engine its height:
```js
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8c8c8c }));   // what you see
floor.receiveShadow = true; engine.add(floor);
engine.setGround({ height: (x, z) => 0 });   // what walking, placing and the camera read (a ramp, a raised floor: return its y here)
```
Walls and obstacles are `engine.collision.addBox(obj, { halfWidth, halfDepth })`; a Blender level brings its own ground (`level()`, next paragraph).
`saveKey` must differ per game, otherwise saves overwrite each other. The UI language follows the player's browser (Chinese browser -> Chinese,
otherwise English) unless you set `createEngine({ locale: 'zh-CN' })` (`'zh'` and `'en-US'` match too; a language with no strings warns). A game without terrain (the city test page in the engine repository does this): register
the level generator function under `models` in `engine.assets.manifest({ name, models })`, use `level({ url: name })` and pick your own modules, then
create the player and install content in `level:loaded`.

`games/my-game/content/index.js`:
```js
import items, { startItems } from './items.js';
import places from './places.js';
export default { items, startItems, places };
```
`content/places.js`: `export default { home: 'flat ground found at the start (coordinates computed in main.js)' };`

## 2. Verify
1. `npm run map` -> generates `games/my-game/GAMEMAP.md`; check the "engine modules" and "page /" sections.
2. `npm run check` -> content validation points out wrong file names, ids and clock-time formats; `npm run types` finds misused engine APIs.
3. `npm run shot -- -w my-game / --describe-only` -> the text has a `player` line with its position, the module list, and no "still loading".
4. `npm test -w games/my-game` -> without `tests/specs/` it runs a smoke test (the page opens, the engine is ready, the console has no errors); to
   test gameplay, write `games/my-game/tests/specs/<name>.mjs` in the style of the engine repository's `packages/engine/tests/specs/*.mjs`.
5. To see the picture: `npm run shot -- -w my-game /` (one image in `games/my-game/.threedog/shots/`); while developing run `npm run dev -w games/my-game` (or
   `npm run dev -- my-game`) and open the printed address; read errors in `games/my-game/.threedog/errors.log`.

## 3. Preset parts
Every `openWorld()` part takes `false` or its module's options object, for example
`openWorld({ camera: 'follow', calendar: { seasons: ['wet', 'dry'], daysPerSeason: 28 }, debug: false })`. Gameplay modules (interactions, dialogue,
inventory, quests) are not in the preset: add them with `engine.use`. The debug panel is dev-only by default.

## 4. Feel presets (opt-in)
The engine applies no gameplay feel by itself: `weather()` alone has only a calm `clear`, `sky()` has no seasons, and the calls that need a feel
refuse to guess: `createPlayer()` throws `[player-control]` without `control`, `interactions()` throws `[interaction-setup]` without `pick` and keys,
`openWorld()` throws `[open-world-camera]` without `camera`. The core key table holds only movement and menu confirm / cancel; run, jump and interact
keys come from the game. `presets` holds named option objects a game picks on purpose; each only bundles options you could write yourself, so spread
and override:
```js
import { presets, weather, calendar, sky, followCamera, interactions } from 'threedog';
engine.use(calendar(presets.calendar.fourSeasons), sky(), weather({ ...presets.weather.temperate, autoPool: ['clear', 'rain'] }), followCamera(presets.camera.overShoulder));
engine.use(interactions({ ...presets.interactions.facing }));   // nearest / facing / aim, each with E
const player = engine.characters.createPlayer({ ...presets.player.lockOn, faceTarget: boss });   // none / thirdPerson / lockOn / aim / sideScroller
```
`presets.player.thirdPerson` is `{ control: 'camera', faceMode: 'move', cameraFollow: true }`; the run / jump keys are
`presets.bindings.walk` (`{ run: ['ShiftLeft', 'ShiftRight', 'PadLB'], jump: ['Space', 'PadA'] }`). No module or preset takes keys: every key
comes from `createEngine({ bindings })` or `engine.input.bind(...)`.

## 5. Canvas size: full window, a page section, a split layout or an editor panel
The engine follows the canvas's own CSS box (a `ResizeObserver` on the canvas), not the window: renderer size, camera aspect, `input.pointer` (`x / y`
pixels and `ndcX / ndcY` relative to the canvas), `engine.pick`, `screenToGround`, `worldToScreen` and the HUD all use that box, and the engine's UI
root is laid exactly over it. So the layout decides:
```html
<style>#view{position:fixed;inset:0;width:100%;height:100%;display:block}</style>   <!-- full window (the template) -->
<section style="position:relative;width:640px;height:360px"><canvas id="view" style="width:100%;height:100%;display:block"></canvas></section>   <!-- in a page -->
```
A canvas with no CSS size takes its size from its own pixel buffer, which would grow on every resize; the engine then sizes it to the window and warns
once in dev. The pixel ratio (`createEngine({ pixelRatio })`, adaptive resolution) applies on top of the CSS size.

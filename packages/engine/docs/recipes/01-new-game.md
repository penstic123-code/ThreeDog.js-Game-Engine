# Starting a new game (a workspace under games/)

Goal: create `games/farm/` (pick your own name) with its own page, modules, content data and tests, independent of other games. Start from the template (`npx threedog new-game farm`, section 0); the engine's own example is `examples/world/` in the package.

## 0. One-command setup (preferred)
```
npm run new-game my-farm            # minimal open world
npm run new-game my-farm --blank    # flat ground, a player and a follow camera only
```
(npm treats `--blank` as its own config and the script reads it from the `npm_config_blank` environment variable, so write it exactly like this, without `-- --blank`.)
The name may only contain lowercase letters, digits and dashes; an existing directory under `games/` with the same name is refused. What it does:
1. Copies `packages/tools/templates/game/` to `games/my-farm/` (`__NAME__` in the files is replaced by the name).
2. Creates the `node_modules/@threedog/my-farm` link and updates the workspace entry in `package-lock.json` (if offline, only a warning).
3. Runs `map` (generates GAMEMAP.md), `check` and the game's smoke test in turn. Any failing step stops and says why.

The generated game is a minimal open world: `openWorld` + `interactions / inventory / content / hud`, 3 apples on the ground and one stash (a template in `content/templates.js` placed by `content/props.js`, searched through the op `stash.search`); its `main.js` also shows the game's own state registered with `describe.add` and `saves.register`, an op with `can` / `run`, and the `onFixed` / `onFrame` split; `--blank` copies the same template without `content/` and replaces `main.js` with `templates/blank/main.js` (no inventory, no content). The structure is the same as the manual one below.
To change the camera: `openWorld({ camera: 'firstPerson' })` (`follow` / `firstPerson` / `rts` / `fixed`, or pass a camera module directly; there is no default).
- The comments in `main.js` list further gameplay modules you can add; usage is in `../api/<module>.md`.
- To change the starting point of new games, edit the real files in `packages/tools/templates/game/`.
- `DESIGN.md` is an empty template: write your gameplay ideas there. `CLAUDE.md` only points the way (read `node_modules/threedog/docs/AI.md` first, then GAMEMAP, DESIGN) and does not copy engine rules.
- There is no `tests/`: when `tests/specs.mjs` does not exist, `npm test -w games/my-farm` runs a smoke test automatically.

## 1. Creating the files by hand (to learn what each file is, or when the template doesn't fit)
| File | Content |
|---|---|
| `games/farm/package.json` | Copy `package.json` from the game template (or run `npx threedog new-game farm`) and set `name` to `@threedog/farm` (dependencies `threedog`, `@threedog/tools`, plus `@threedog/style-lowpoly` and `@threedog/terrain-noise` when `main.js` imports them; scripts dev/build/preview/test/check/map) |
| `games/farm/vite.config.js` | One line: `export default gameConfig(import.meta.dirname)` (imported from `@threedog/tools/vite`); *.html files in the directory are bundled automatically, no `input` needed. Without `@threedog/tools`, a plain vite config needs `worker: { format: 'es' }` (the engine's Workers are ES modules) or `vite build` fails; `threedog dev / build` on a folder with no vite config uses the preset |
| `games/farm/index.html` | The page: one `<canvas id="view">` with a CSS size + `/main.js` (for more pages put `xxx.html` in the same directory); see §5 for embedding |
| `games/farm/main.js` | Install modules, compute places, `content.load`, game-specific logic |
| `games/farm/content/index.js` | Combines the content files into one object |
| `games/farm/content/*.js` | Only these names are read: items pickups containers npcs dialogues quests actions places triggers level vegetation props templates audio grids renames rules, plus the game's own kinds (rules.js) |
| `games/farm/DESIGN.md` | Hand-written design decisions (a few lines of `- **decision**: reason`), copied into GAMEMAP.md |
| `games/farm/CLAUDE.md` | A few lines: read `node_modules/threedog/docs/AI.md`, then this directory's GAMEMAP.md and DESIGN.md (copy the template's) |
| `games/farm/public/` | This game's art assets (URL `/models/...`); keep Blender source files in `games/farm/art/models/`, `npm run assets -- -w farm` compresses them over |

After creating them, run `npm install` once at the repository root (this links the new game into the workspaces so `threedog` can find it).

Outside the engine repository, a game installs `threedog` and `three` (plus `@threedog/style-lowpoly` / `@threedog/terrain-noise` if it imports them, and `@threedog/tools` as a dev dependency for the CLI and the vite preset). To use an engine folder on disk instead of npm, install it with `npm install --install-links <folder>`: a plain link skips the engine's own dependencies (Rapier, Recast) and the build cannot resolve them.

In a game's own repository, `threedog check`, `types` and `map` read only the game's sources: `node_modules`, a `vendor/` folder and every `file:` / `link:` dependency are skipped. To narrow it further, list the sources in the game's `package.json`: `"threedog": { "src": ["main.js", "src", "content"], "exclude": ["notes"] }` (paths relative to the game folder; `src` defaults to the whole folder). The template's `tsconfig.json` checks the game files only (`checkJs`), with `lib` ESNext + DOM (dependency typings such as Rapier's use `Symbol.dispose`) and `skipLibCheck: true`; without a tsconfig, `threedog types` writes the same settings to `.threedog/tsconfig.types.json`.

`games/farm/index.html` (minimal; the template's `index.html` has the same page with loading styles):
```html
<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>农场</title><style>html,body{height:100%;margin:0;overflow:hidden;background:#141a17}#view{position:fixed;inset:0;width:100%;height:100%;display:block;outline:none}</style>
</head><body><canvas id="view" tabindex="0"></canvas><script type="module" src="/main.js"></script></body></html>
```

`games/farm/main.js`:
```js
// Farm example: ... (this first comment line appears in the file table of GAMEMAP.md)
import { createEngine, presets, openWorld, interactions, dialogue, inventory, quests, entities, content } from 'threedog';
import lowpoly from '@threedog/style-lowpoly';              // optional style pack (the engine ships no art)
import { terrainPreset } from '@threedog/terrain-noise';   // optional terrain generator (nor a world shape)
import data from './content/index.js';

const engine = createEngine({ canvas: document.getElementById('view'), style: lowpoly, ui: { loading: { title: '农场' } }, saveKey: 'farm' });
engine.use(openWorld({ camera: 'follow', seed: 42, terrain: terrainPreset(), time: 0.3 }),                        // the preset only covers world and environment; the debug panel is installed in dev builds only (debug: true forces it in release too)
  interactions({ ...presets.interactions.nearest }), dialogue(), inventory({ ...presets.keys.inventory }), quests({ ...presets.keys.quests }), entities(),     // add gameplay modules as the game needs (a shooter has no inventory)
  content());
const home = engine.characters.findSpawn([0, 0, 0], { minH: 3, maxH: 14 }); // the terrain is generated: find flat ground as "home" at the start (give your own height range to avoid beach and peaks)
engine.characters.createPlayer({ ...presets.player.thirdPerson, spawn: home });
engine.content.load(data, { places: { home } });                           // content places things relative to it with { place: 'home', x, z }
window.engine = engine;                                                    // tests, screenshots and the console all rely on it (before start, so the dev bridge can wait for it)
await engine.start();
```
Every `openWorld` part takes `false` (leave it out) or its module's own options object, so you never have to drop the preset for one setting: `openWorld({ seed: 42, camera: 'follow', sky: { seasons: ['wet', 'dry'], daysPerSeason: 28 }, characters: { npcs: false }, rigid: false, ambience: false, debug: false })`; `camera` is required (no default camera) and takes `'follow'` / `'firstPerson'` / `'rts'` / `'fixed'`, a camera module such as `followCamera({ shoulder: 0.7 })`, or `false`. A game that wants only a few parts (an arena without terrain) turns the rest off the same way: `openWorld({ camera: 'follow', terrain: false, vegetation: false, weather: false, water: false })`.
`saveKey` must differ per game, otherwise saves overwrite each other. The UI language follows the player's browser (Chinese browser -> Chinese, otherwise English) unless you set `createEngine({ locale })`. A game without terrain (the city test page in the engine repository does this): register the level generator function under `models` in `engine.assets.manifest({ name, models })`, use `level({ url: name })` and pick your own modules, then create the player and install content in `level:loaded`.

`games/farm/content/index.js`:
```js
import items, { startItems } from './items.js';
import places from './places.js';
export default { items, startItems, places };
```
`content/places.js`: `export default { home: 'flat ground found at the start (coordinates computed in main.js)' };`

## 2. Verify
1. `npm run map` -> generates `games/farm/GAMEMAP.md`; check the "engine modules" and "page /" sections.
2. `npm run check` -> content validation points out wrong file names, ids and clock-time formats; `npm run types` finds misused engine APIs.
3. `npm run shot -- -w farm / --describe-only` -> the text has a `player` line with its position, the module list, and no "still loading".
4. `npm test -w games/farm` -> without `tests/specs.mjs` it runs a smoke test (the page opens, the engine is ready, the console has no errors); to test gameplay, write `games/farm/tests/specs.mjs` in the style of the engine repository's `packages/engine/tests/specs.mjs`.
5. To see the picture: `npm run shot -- -w farm /` (one image in `games/farm/.threedog/shots/`); while developing run `npm run dev -w games/farm` (or `npm run dev -- farm`) and open the printed address; read errors in `games/farm/.threedog/errors.log`.

## 3. Preset parts
Every `openWorld()` part takes `false` or its module's options object, for example `openWorld({ camera: 'follow', sky: { seasons: ['wet', 'dry'], daysPerSeason: 28 }, debug: false })`. Gameplay modules (interactions, dialogue, inventory, quests) are not in the preset: add them with `engine.use`. The debug panel is dev-only by default.

## 4. Feel presets (opt-in)
The engine applies no gameplay feel by itself: `weather()` alone has only a calm `clear`, `sky()` has no seasons, and the calls that need a feel refuse to guess: `createPlayer()` throws `[player-control]` without `control`, `interactions()` throws `[interaction-setup]` without `pick` and keys, `openWorld()` throws `[open-world-camera]` without `camera`. The core key table holds only movement and menu confirm / cancel; run, jump and interact keys come from the game. `presets` holds named option objects a game picks on purpose; each only bundles options you could write yourself, so spread and override:
```js
import { presets, weather, sky, followCamera, interactions } from 'threedog';
engine.use(sky(presets.calendar.fourSeasons), weather({ ...presets.weather.temperate, autoPool: ['clear', 'rain'] }), followCamera(presets.camera.overShoulder));
engine.use(interactions({ ...presets.interactions.facing }));   // nearest / facing / aim, each with E
const player = engine.characters.createPlayer({ ...presets.player.lockOn, faceTarget: boss });   // none / thirdPerson / lockOn / aim / sideScroller
```
`presets.player.thirdPerson` is `{ control: 'camera', faceMode: 'move', runKeys: Shift, jumpKeys: Space, cameraFollow: true }`; written out by hand the same player is `createPlayer({ control: 'camera', faceMode: 'move', runKeys: ['ShiftLeft', 'ShiftRight', 'PadLB'], jumpKeys: ['Space', 'PadA'], cameraFollow: true })`. Keys for any action can also come from `createEngine({ bindings: { interact: ['KeyF'] } })`; those win over the keys a module or preset passes.

## 5. Canvas size: full window, a page section, a split layout or an editor panel
The engine follows the canvas's own CSS box (a `ResizeObserver` on the canvas), not the window: renderer size, camera aspect, `input.pointer` (`x / y` pixels and `ndcX / ndcY` relative to the canvas), `engine.pick`, `screenToGround`, `worldToScreen` and the HUD all use that box, and the engine's UI root is laid exactly over it. So the layout decides:
```html
<style>#view{position:fixed;inset:0;width:100%;height:100%;display:block}</style>   <!-- full window (the template) -->
<section style="position:relative;width:640px;height:360px"><canvas id="view" style="width:100%;height:100%;display:block"></canvas></section>   <!-- in a page -->
```
A canvas with no CSS size takes its size from its own pixel buffer, which would grow on every resize; the engine then sizes it to the window and warns once in dev. The pixel ratio (`createEngine({ pixelRatio })`, adaptive resolution) works as before on top of the CSS size.

# Starting a new game (a workspace under games/)

Goal: create `games/farm/` (pick your own name) with its own page, modules, content data and tests, independent of other games. Existing examples: `games/my-game/` (complete), `games/my-game/` (minimal shell).

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

The generated game is a minimal open world: `openWorld` + `interactions / inventory / content`, with 3 apples on the ground; `--blank` uses `templates/blank/`, without inventory and content. The structure is the same as the manual one below.
To change the camera: `openWorld({ camera: 'firstPerson' })` (`follow` default / `firstPerson` / `rts` / `fixed`, or pass a camera module directly).
- The comments in `main.js` list further gameplay modules you can add; usage is in `../api/<module>.md`.
- To change the starting point of new games, edit the real files in `packages/tools/templates/game/`.
- `DESIGN.md` is an empty template: write your gameplay ideas there. `CLAUDE.md` only points the way (read `node_modules/threedog/docs/AI.md` first, then GAMEMAP, DESIGN) and does not copy engine rules.
- There is no `tests/`: when `tests/specs.mjs` does not exist, `npm test -w games/my-farm` runs a smoke test automatically.

## 1. Creating the files by hand (to learn what each file is, or when the template doesn't fit)
| File | Content |
|---|---|
| `games/farm/package.json` | Copy `games/my-game/package.json` and change `name` to `@threedog/farm` (dependencies `"threedog": "*"`, `"@threedog/tools": "*"`; scripts dev/build/test/map) |
| `games/farm/vite.config.js` | One line: `export default gameConfig(import.meta.dirname)` (imported from `@threedog/tools/vite`); *.html files in the directory are bundled automatically, no `input` needed |
| `games/farm/index.html` | The page: one `<canvas id="view">` + `/main.js` (for more pages put `xxx.html` in the same directory) |
| `games/farm/main.js` | Install modules, compute places, `content.load`, game-specific logic |
| `games/farm/content/index.js` | Combines the content files into one object |
| `games/farm/content/*.js` | Only these names are read: items pickups containers npcs dialogues quests actions places triggers level vegetation props rules |
| `games/farm/DESIGN.md` | Hand-written design decisions (a few lines of `- **decision**: reason`), copied into GAMEMAP.md |
| `games/farm/CLAUDE.md` | A few lines: read `node_modules/threedog/docs/AI.md`, then this directory's GAMEMAP.md and DESIGN.md (copy another game's) |
| `games/farm/public/` | This game's art assets (URL `/models/...`); keep Blender source files in `games/farm/art/models/`, `npm run assets -- -w farm` compresses them over |

After creating them, run `npm install` once at the repository root (this links the new game into the workspaces so `threedog` can find it).

`games/farm/index.html` (minimal; you can also copy the styles from `games/my-game/index.html`):
```html
<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>农场</title><style>html,body{height:100%;margin:0;overflow:hidden;background:#141a17}#view{position:fixed;inset:0;width:100%;height:100%;display:block;outline:none}</style>
</head><body><canvas id="view" tabindex="0"></canvas><script type="module" src="/main.js"></script></body></html>
```

`games/farm/main.js`:
```js
// Farm example: ... (this first comment line appears in the file table of GAMEMAP.md)
import { createEngine, openWorld, interactions, dialogue, inventory, quests, entities, content } from 'threedog';
import lowpoly from 'threedog/styles/lowpoly';
import data from './content/index.js';

const engine = createEngine({ canvas: document.getElementById('view'), style: lowpoly, ui: { loading: { title: '农场' } }, saveKey: 'farm' });
engine.use(openWorld({ seed: 42, time: 0.3 }),                        // the preset only covers world and environment; the debug panel is installed in dev builds only (debug: true forces it in release too)
  interactions(), dialogue(), inventory(), quests(), entities(),     // add gameplay modules as the game needs (a shooter has no inventory)
  content());
const home = engine.characters.findSpawn([0, 0, 0], { minH: 3, maxH: 14 }); // the terrain is generated: find flat ground as "home" at the start (give your own height range to avoid beach and peaks)
engine.characters.createPlayer({ spawn: home });
engine.content.load(data, { places: { home } });                           // content places things relative to it with { place: 'home', x, z }
engine.start();
window.engine = engine;                                                    // tests, screenshots and the console all rely on it
```
Every `openWorld` part takes `false` (leave it out) or its module's own options object, so you never have to drop the preset for one setting: `openWorld({ seed: 42, sky: { daysPerSeason: 28 }, characters: { npcs: false }, rigid: false, ambience: false, debug: false })`; `camera` takes `'follow'` / `'firstPerson'` / `'rts'` / `'fixed'`, a camera module such as `followCamera({ shoulder: 0.7 })`, or `false`. A game that wants only a few parts (an arena without terrain) turns the rest off the same way: `openWorld({ terrain: false, vegetation: false, weather: false, water: false })`.
`saveKey` must differ per game, otherwise saves overwrite each other. The UI language follows the player's browser (Chinese browser -> Chinese, otherwise English) unless you set `createEngine({ locale })`. A game without terrain follows the engine's `examples/city/main.js`: register the level generator function in `assets.manifest`, use `level({ url: name })` and pick your own modules, then create the player and install content in `level:loaded`.

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
Every `openWorld()` part takes `false` or its module's options object, for example `openWorld({ sky: { daysPerSeason: 28 }, debug: false })`. Gameplay modules (interactions, dialogue, inventory, quests) are not in the preset: add them with `engine.use`. The debug panel is dev-only by default.

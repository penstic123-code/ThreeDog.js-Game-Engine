# Commands and debugging details

The scripts in `package.json` all forward to the CLI `threedog` (from `@threedog/tools`); `npm run xxx` and `npx threedog xxx` are equivalent. The tools find every path through their `paths.mjs`, in the engine repository and in a game installed from npm alike.

## Running one game only
After `-w` write the directory or the package name (inside a game directory a plain `npm run ...` does the same):
- Dev: `npm run dev -w games/my-game`, or from the root `npm run dev -- my-game` (part of the name is enough); no name means the engine example. To change the port (default 5173; if taken it moves to the next one): `npm run dev -- my-game --port 5000` (the game name must come first, the remaining arguments go to vite untouched; don't add another `--`).
- Test: `npm test -w games/my-game`, or `npm test -- -w my-game`; `npm test` at the root tests every workspace (engine + each game).
- Build: `npm run build -w games/my-game`; `npm run build` at the root builds all (every *.html in a workspace root is bundled, no change to vite.config.js needed).
- Screenshot / bake / compress models: `npm run shot -- -w my-game / --describe-only`, `npm run bake -- -w my-game`, `npm run assets -- -w my-game`.
- A game's tests: if `games/<game>/tests/specs.mjs` exists it runs; otherwise a smoke test runs automatically (page opens, engine ready, no console errors). Minimal example:
```js
// games/my-farm/tests/specs.mjs — export a specs array, one entry per page
export const specs = [{
  name: 'farm: pick up apple',   // npm test -- apple matches by name substring
  url: '/?cutscene=skip',        // page path + URL parameters
  async run({ page, check, ev, frames, wait }) {
    // ev(fn, arg): runs in the page (engine is available). The function is serialized, so it can't use outer variables; pass them as the argument:
    const n = await ev(id => engine.inventory.count(id), 'apple');
    check('no apple at start', n === 0, `actual ${n}`);   // check(label, passed, details on failure)
    await page.keyboard.press('KeyE');                   // page is a Playwright page: keys, clicks
    await frames(3);                                      // wait 3 frames of the real-time loop (software rendering is slow; waiting by frames is more reliable than wait(ms))
    check('has apple after pickup', await ev(id => engine.inventory.count(id), 'apple') > 0);
  },
}];
```
  Tests run against the built bundle (not the dev server): main.js must set `window.engine = engine;` before `await engine.start()`, otherwise the test waits for the engine until timeout (the error explains why).
- New game: `npm run new-game name`, see `recipes/01-new-game.md`.

## Command table
| Command | When to use |
|---|---|
| `npm run dev` | Development. Browser errors are sent automatically to the terminal and to the workspace's `.threedog/errors.log` (e.g. `games/my-game/.threedog/errors.log`): read that file first when something breaks, before taking screenshots. Known error classes carry `Possible cause: …` and `Read: recipes/…` lines (table `core/errorHints.js`) |
| `npm run check` | Run after every change (order: if the docs need regenerating `map` -> `check` -> related tests; otherwise `check` -> related tests): hard rules + rule checks (`packages/tools/rules/`; detection and allowlists are at the top of each file; the save round trip is in npm test) + types + content validation + generated docs up to date. `-- --rule R4` runs one rule, `-- --all` lists every warning |
| `npm run types` | Type check only (does game code misuse the engine API) |
| `npm test` | Full browser tests (slow). Normally `npm test -- name` runs only the related ones (matched by test-name substring, e.g. `-- HLOD`), `-- -w game` tests one game. `-- --update-snapshots` makes tests that use `expectDescribe` write their describe baselines (`tests/snapshots/*.describe.json`) instead of comparing. `npm test -- pack` (the build test): after a real build of each game, open only dist from a static server and check that the engine is ready, no 4xx resources, no console errors |
| `npx threedog snap-describe save|diff name [--only a,b]` | Describe snapshot instead of a screenshot: baseline of the gameplay part of `describe()` (see recipes/16-dev-bridge.md section 7); in tests one line `expectDescribe({ check, ev }, name, { only, tolerance })` from `@threedog/tools/describe-snapshot` |
| `npm run map` | Regenerate CODEMAP, API.md + api/, each game's GAMEMAP and the event-name list (generated from `EventMap` in core.d.ts; add a new event to EventMap first) after changing code, JSDoc or content (run it before `check`) |
| `npm run shot -- / --time 18:30 --weather rain --pos x,z` | Only when you need to see the picture; by default 1 image of 960x540 into the workspace's .threedog/shots/; **read the state as text first with `--describe-only`**. `/<page>.html` switches the page, `-w game` switches the game, `--wait seconds` advances time |
| `npm run bake` | Before release, or to take code-generated models into Blender: exports public/models/baked/*.glb (`-- -w game`) |
| `npm run assets` | Compress glTF from art/models/ into public/models/ (names such as col_ and spawn are kept; `-- -w game`) |
| `npm run perf` | Performance comparison (plain three.js vs engine vs per-module cost in openWorld); compare with `PERF.md` |
| `npx threedog content ids [-w game \| folder] [--write]` | Stateful content entries (pickups, template instances with state / container / interact / body) that rely on their index id: prints the id each has now as `-`/`+` lines (dry run); `--write` writes them into `content/*.js`. Rename later through `content/renames.js` (recipe 30) | <!-- r18-ignore-line -->
| `npm run doctor` | Check the environment, one line per item: ✓ passed · ✗ problem -> fix · – info only; `-- --ci` does not fail the command on problems. Checks Node version, node_modules, workspace links, package-lock consistency, `.threedog` writable, port 5173, the dev server recorded in `.threedog/dev.json`, Playwright chromium, headless WebGL2, `EXT_disjoint_timer_query_webgl2` (software rendering normally lacks it; info only). Run it first when the environment acts strange |
| `npm run build` | Bundle each workspace into its own dist/ |

## Reproducing a scenario and debugging
- Add `?time=18:30&weather=rain&pos=40,-20&save=slot1&cutscene=skip&state=name` to the URL (effective in development).
- In the console / tests: `engine.describeText()` reads the state as English text; `engine.step(seconds)` fast-forwards synchronously (no rendering); `engine.pause()` stops the real-time loop.
- To wait for the page: `page.waitForFunction(() => window.engine?.stateApplied)` (start has finished and all URL parameters are applied); never read `_`-prefixed private fields. When the dev bridge / `npm test` / `npm run shot` cannot reach the engine (no `window.engine` after 40 seconds, or it exists but never becomes ready), the error states the page status, the latest page errors and the fix.
- Advancing dialogue headlessly: `engine.step(1)` lets the typing finish, then press a number key or run `engine.ops.run('dialogue.choose', { index: i })` (while typing it completes the sentence first).
- Debug objects on window: `window.engine = engine` is already declared; for a game's own, write `/** @type {any} */ (window).game = {...}` (`npm run types` reports properties on window as web hints, not errors).
- To operate a running game use the dev bridge, see `recipes/16-dev-bridge.md`.

## Folder guide (inside packages/engine)
- `core/` core: Engine (main loop, ground, step/describe), Events Input Saves Assets Audio I18n Clock Vars Jobs Stream Rays Budget UrlState Animator.
- `modules/` modules, one folder each, installed with `engine.use`; list in `CODEMAP.md`.
- `render/ ui/` material factory, post-processing; UI basics (windows, UI focus stack, toast, fadeScreen, worldToScreen).
- `index.js index.d.ts types/` entry and API declarations (`types/generated/` is generated from source JSDoc, never edited by hand).
- `packages/styles/lowpoly/` (`@threedog/style-lowpoly`, optional; the engine ships no art) the lowpoly package: `index.js` holds the style pack (all look parameters) and exports the asset pack `assets`, `models.js` the procedural models in it, `terrain.js` the terrain preset.
- `examples/world/` is the engine example (open world `/`, content-only placement). The small city (level, no terrain, no style pack, top-down) and the co-op page are test pages in the engine repository (`tests/city/`, `tests/coop/`), opened at `/tests/city/index.html` and `/tests/coop/index.html`.
- `tests/` specs.mjs + specs/ test list, `<name>/index.html` test pages, fixtures/ test assets. `public/` art for the examples.
- Each game `games/<game>/`: package.json, vite.config.js (one line, gameConfig), index.html, main.js, `content/` (items npcs dialogues quests pickups containers props triggers actions places level vegetation rules; only these file names are read), `public/` (art; Blender source files go in `art/models/`), DESIGN.md, GAMEMAP.md (generated), CLAUDE.md.
- Each workspace has its own `.threedog/` (browser error log errors.log, screenshots shots/, generated cache) and `dist/`; neither is committed.

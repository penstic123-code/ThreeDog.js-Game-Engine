# Commands and debugging details

The scripts in `package.json` forward to the CLI `threedog` (from `@threedog/tools`; the root `build` runs each workspace's own `build`);
`npm run xxx` and `npx threedog xxx` are equivalent. The tools find every path through their `paths.mjs`, in the engine repository and in a game
installed from npm alike.

## Running one game only
After `-w` write the directory or the package name (inside a game directory a plain `npm run ...` does the same):
- Dev: `npm run dev -w games/my-game`, or from the root `npm run dev -- my-game` (part of the name is enough); no name means the engine example. To
  change the port (default 5173; if taken it moves to the next one): `npm run dev -- my-game --port 5000` (the game name must come first, the
  remaining arguments go to vite untouched; don't add another `--`).
- Test: `npm test -w games/my-game`, or `npm test -- -w my-game`; `npm test` at the root tests every workspace (engine + each game).
- Build: `npm run build -w games/my-game`; `npm run build` at the root builds all (every *.html in a workspace root is bundled, no change to
  vite.config.js needed).
- Screenshot / bake / compress models: `npm run shot -- -w my-game / --describe-only` (`--keep` timestamped file name, `--look` pixel numbers), `npm run bake -- -w my-game`, `npm run assets -- -w my-game`.
- A game's tests: if `games/<game>/tests/specs.mjs` exists it runs; otherwise a smoke test runs automatically (page opens, engine ready, no console
  errors). Minimal example:
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
  Tests run against the built bundle (not the dev server): main.js must set `window.engine = engine;` before `await engine.start()`, otherwise the
  test waits for the engine until timeout (the error explains why).
- New game: `npm run new-game name`, see `recipes/01-new-game.md`.
- Game in your own folder (outside this repo): after `npm install threedog three@~0.187.0 @threedog/tools`, run `npx threedog init [name]`: it copies the new-game template without overwriting anything, merges package.json and writes `.mcp.json`, so Claude Code opened in that folder starts the threedog MCP server by itself.

> Git Bash (MSYS) rewrites arguments that start with `/` (`/styletest.html` turns into a Windows path). Write `shot styletest`, or set `MSYS_NO_PATHCONV=1`, or use PowerShell.

## Command table
| Command | When to use |
|---|---|
| `npm run dev` | Development. Browser errors are sent automatically to the terminal and to the workspace's `.threedog/errors.log` (e.g. `games/my-game/.threedog/errors.log`): read that file first when something breaks, before taking screenshots. Known error classes carry `Possible cause: …` and `Read: recipes/…` lines (table `core/errorHints.js`) |
| `npm run check` | Run after every change (order: if the docs need regenerating `map` -> `check` -> related tests; otherwise `check` -> related tests): hard rules + rule checks (`packages/tools/rules/`; detection and allowlists are at the top of each file; the save round trip is in npm test) + types + content validation + generated docs up to date. `-- --rule R4` runs one rule, `-- --all` lists every warning, `-- -w game` (or `npx threedog check -w game`) checks one game only: its content validation and GAMEMAP freshness (not the engine rules/types; run plain `check` before committing engine changes) |
| `npm run types` | Type check only (does game code misuse the engine API) |
| `npm test` | Full browser tests (slow). Normally `npm test -- name` runs only the related ones (matched by test-name substring, e.g. `-- HLOD`), `-- -w game` tests one game. `-- --update-snapshots` makes tests that use `expectDescribe` write their describe baselines (`tests/snapshots/*.describe.json`) instead of comparing. `npm test -- pack` (the build test): after a real build of each game, open only dist from a static server and check that the engine is ready, no 4xx resources, no console errors |
| `npx threedog snap-describe save|diff name [--only a,b]` | Describe snapshot instead of a screenshot: baseline of the gameplay part of `describe()` (see recipes/16-dev-bridge.md section 7); in tests one line `expectDescribe({ check, ev }, name, { only, tolerance })` from `@threedog/tools/describe-snapshot` |
| `threedog play` / `play --stop` | Start the game for the AI: starts the dev server if none runs (detached, output in `.threedog/dev.log`), waits for the dev bridge and the engine, prints the page address and whether a headless or a live browser page is connected. `--stop` stops the server play started |
| `threedog status` | One call: engine ready, loading done, page errors, running / paused / frozen. When the bridge cannot answer it names one of four causes with one next step: no server (`threedog play`), server still starting (wait, status again), page script error (`threedog errors latest`), no dev bridge installed (use `gameConfig`) |
| `threedog session [--minutes N]` / `session stop` / `session status` | Optional: keeps one small local process alive (127.0.0.1, token, `.threedog/session.json`) so later bridge commands skip module loading (about 0.1 to 0.15 s less per command); exits by itself after N idle minutes (default 10). Every command works the same without it: no session, a dead one or an unreachable one falls back to a direct call. Restart it after editing the tools |
| `threedog js --file steps.js [--verbose]` | A script that calls `assert(cond, msg)` or `expect(v).toBe/toEqual/toBeCloseTo/toBeGreaterThan(x, msg)` runs as checks in ONE call: globals `engine`, `step(seconds)`, `log(...)`; failed checks are recorded and the script goes on, a throw stops it. Output: `✓ 7 checks passed`, or the failures then `✗ 2 of 7 checks failed`; exit code 1 on failure. `--verbose` adds passes, `log` lines and the return value. A script without those calls is the plain eval |
| `threedog verify scenario` | Run `tests/scenarios/<scenario>.json` on the running page and print PASS / FAIL, **Tested** (ops with outcomes, describe sections compared, time advanced), **Not tested** (ops never run, sections never compared, steps skipped after a failure, key path, picture), a `Layers:` line (steps by layer: direct = op/describe call, simulated-input = bridge press; real-browser-input is always 0 and printed as not verified, visual 0 because scenario snapshots are describe, not pixels), tests that mention an error code seen, and the `threedog test` command to re-run. A page error during the run fails it. JSON adds `layers` / `layerCounts` / `evidence` (per-check layers, notProven, ops / modules coverage; text: Evidence, NOT proven, Coverage: ops ran/total with refused ones marked, modules tested / indirect / untested, lists capped with "+N more"). `threedog scenario` prints its pass line plus the same Coverage block |
| `threedog catalog [id] [--find word] [--json]` | What this game can do: modules, ops (args, failure codes, last attempt), saves, time. `recipes/51-capability-catalog.md` |
| `threedog how "<task>"` | Ranks the AI.md task rows and recipe headings for a task in your own words (also in Chinese). `recipes/51-capability-catalog.md` section 5 |
| `threedog explain op shop.buy shop=bakery` / `explain quest first-light` | Why an op cannot run now, or what a quest waits on (`engine.explain`). `recipes/23-ops.md` |
| `threedog thing <id>` | Everything about one id: definition file:line, model, materials, state, ops, save tier, how to change it (`thing.explain()`). `recipes/41-thing-registry.md` section 6 |
| `threedog content set <id> <field> <json> [--in props] [--dry]` (or `<id> x=12 place=home …`: several fields, one write, one check, all-or-nothing) | Write a permanent change into the content entry. `recipes/41-thing-registry.md` |
| `threedog loading [task]` | Loading progress and what failed, also while `start()` is stuck. `recipes/05-props-bake.md` |
| `threedog mcp [--allow-js]` | The dev bridge as an MCP server over stdio. `recipes/16-dev-bridge.md` section 10 |
| `threedog assets check new.glb --against old.glb` | What the old export had and the new one lacks. `recipes/46-blender-art-route.md` |
| `threedog shot --view name [--compare before.png]` | A named camera view (`engine.views.define`) and a pixel diff against an earlier picture. `recipes/46-blender-art-route.md` |
| `threedog skip to=06:00` / `skip seconds=600` | Jump the clock like sleeping (`engine.skip`: op `time.skip`, sky clock and time-keeping modules catch up; optional `fade=0.6 save=auto`). Needs the sky module for `to` |
| `threedog errors` / `errors latest [N]` / `errors --since E5` | Page errors with id (E1…), time, tick, source and count. Plain `errors` = new since the last read; `latest` = the last N (default 3), same answer every time; `--since` = after an id, never moves the read position. Every result prints a cursor |
| Result of every bridge command | CLI text ends with one line on the game state and the way back (`Game paused, tick 180: threedog resume restores real-time running`; frozen by a menu says which). MCP adds `structuredContent` { ok, code, summary, runtime { ready, mode running|paused|frozen, tick, headless, blockedBy[] }, data } and an `outputSchema` on every tool. `code`: ok, blocked (ran, refused), not-ready, no-server / starting / page-error / no-bridge (cannot reach the game), command-error. **Advance game time**: step, press, hold, skip, scenario, verify. **No game time**: op, state, eval, js, resume, reload. Everything else only observes. eval / js and describe with a path or --full / --all print no state line (parseable); runtime still has it |
| `npm run map` | Regenerate CODEMAP, API.md + api/, each game's GAMEMAP and the event-name list (generated from `EventMap` in core.d.ts; add a new event to EventMap first) after changing code, JSDoc or content (run it before `check`) |
| `npm run shot -- / --time 18:30 --weather rain --pos x,z` | Only when you need to see the picture; by default 1 image of 960x540 into the workspace's .threedog/shots/; **read the state as text first with `--describe-only`**. `/<page>.html` switches the page, `-w game` switches the game, `--wait seconds` advances time |
| `npm run shot -- styletest --view room --time dusk --weather rain` | The fixed style-judging scene (`examples/styletest`, page `/styletest.html`; a bare name is a page of the workspace). `--view` = a named camera (overview, character, water, room, path, ui), `--time` also takes day / dusk / night, `--weather` clear / rain / snow; same arguments every round, so only the style differs. `--panel` is not a shot option: open `/styletest.html?panel=1` in a browser for the workbench (recipes/35) |
| `npx threedog capture [page] [--top N] [--no-spector] [--full]` | Find out what a frame draws: renders one steady frame headless and prints draw calls, shadow-map draws, render passes (post effects) and the largest draws with world record id, budget tag and material purpose. Also records the WebGL command stream of that frame with Spector.js (fetched on first use into `.threedog/cache/`, not a dependency) to `.threedog/captures/`; `--no-spector` skips it |
| `npm run bake` | Before release, or to take code-generated models into Blender: exports public/models/baked/*.glb (`-- -w game`) |
| `npm run assets` | Compress glTF from art/models/ into public/models/ (names such as col_ and spawn are kept; `-- -w game`). Skips files whose source content, options and tool versions are unchanged. Prints a report per file (sizes, meshes / materials / textures / animations, final texture format, texture transfer size vs GPU memory; also `.threedog/assets-report.json`). `-- --ktx2` makes KTX2 textures; without the ktx tool it falls back to WebP and says so, `-- --ktx2 --strict` fails instead |
| `npm run assets -- check [glb or folder] [--json] [--strict]` | Inspect models without building (default art/models/): the level manifest (spawns, col_ colliders, trigger_ zones, npcs, markers, template / id nodes, missing templates, duplicate ids), material and color-space suspicions (data texture in a color slot, BLEND, texture without UV, oversized texture), statistics. `--json` for tools, exit 1 on errors (`--strict`: on warnings too). `npm run check` also reads the level glbs for content validation |
| `npm run perf` | Performance comparison (plain three.js vs engine vs per-module cost in openWorld); compare with `PERF.md` |
| `npx threedog content ids [-w game \| folder] [--write]` | Stateful content entries (pickups, template instances with state / container / interact / body) that rely on their index id: prints the id each has now as `-`/`+` lines (dry run); `--write` writes them into `content/*.js`. Rename later through `content/renames.js` (recipe 30) | <!-- r18-ignore-line -->
| `npm run doctor` | Check the environment, one line per item: ✓ passed · ✗ problem -> fix · – info only; `-- --ci` does not fail the command on problems. Checks Node version, node_modules, workspace links, package-lock consistency, `.threedog` writable, the physical copy (real path, version, package.json mtime) of engine / tools / three per context (check, run/build per game; a `MISMATCH` line when contexts use different copies, e.g. vendor/ vs node_modules), port 5173, the dev server recorded in `.threedog/dev.json`, Playwright chromium, headless WebGL2, `EXT_disjoint_timer_query_webgl2` (software rendering normally lacks it; info only). Run it first when the environment acts strange |
| `npm run new-style name` | New style pack from a clean template (gray neutral materials, sky, one palette, empty post, one palette-colored example model): `packages/styles/<name>`, package `@threedog/style-<name>`, workspace link and lock updated, then `style check`, `map` and `check` run. Lowercase letters, digits and hyphens only |
| `threedog style check [pack\|folder\|file] [--json] [--assets file]` | Check the final merged style: unknown fields (did-you-mean), world-state fields, palette keys read but not defined, color formats, post-effect conflicts, misspelled material roles / types, asset names the pack does not register; plus R34 for that pack. Exit 1 on errors. Static: it cannot prove a pack has no gameplay logic. See `recipes/35-style-from-reference.md` |
| `threedog style palette <image> [--n 8] [--average] [--region x,y,w,h] [--ignore-ui] [--crop out.png]` | Dominant colors of a reference picture and a one-line summary (headless Chromium reads the pixels). `--average` adds the mean color (HSL); `--region` measures one rectangle; `--ignore-ui` cuts a flat frame around the picture (edge row / column one flat color, frame 3% to 45% of the picture; a plain sky at the edge looks the same, so check with `--crop out.png`, which saves the measured area). The output says what was measured. A measurement, not a design decision |
| `threedog style compare <reference> <screenshot> [--region x,y,w,h] [--ref-region ..] [--shot-region ..] [--json]` | Differences as numbers: brightness, saturation, contrast (std of luma), fine detail (variance of the Laplacian of luma; read as a ratio), average and main color (hue / saturation / lightness), plus one neutral sentence ("18% darker, 2.3x more broken up"). Both pictures are scaled to one size and the note says so. **An aid to judging, not a replacement for looking; no number is a quality score and there is no "similarity %".** recipes/35 |
| `threedog scene [--hidden] [--limit N] [--json]` | **The mesh exists but is not drawn: use this first** (needs the running game). Lists every Mesh / Points / Line / Sprite and for each undrawn one every reason, most likely first: `visible = false` on it or a parent, layers vs camera, material flags, scale 0 / NaN, NaN position or vertices, empty geometry, behind the camera, beyond `camera.far`, outside the view. "maybe" reasons (depthWrite off, fully fogged...) do not stop drawing. `--hidden` = only undrawn; default limit 40. Code: `engine.inspect.scene()`; MCP tool `scene`. Cannot see shader output |
| `npm run build` | Bundle each workspace into its own dist/ |

## Reproducing a scenario and debugging
- Add `?time=18:30&weather=rain&pos=40,-20&save=slot1&cutscene=skip&state=name` to the URL (effective in development).
- In the console / tests: `engine.describeText()` reads the state as English text; `engine.step(seconds)` fast-forwards synchronously (no rendering);
  `engine.pause()` stops the real-time loop.
- To wait for the page: `page.waitForFunction(() => window.engine?.stateApplied)` (start has finished and all URL parameters are applied); never read
  `_`-prefixed private fields. When the dev bridge / `npm test` / `npm run shot` cannot reach the engine (no `window.engine` after 40 seconds, or it
  exists but never becomes ready), the error states the page status, the latest page errors and the fix.
- Advancing dialogue headlessly: `engine.step(1)` lets the typing finish, then press a number key or run
  `engine.ops.run('dialogue.choose', { index: i })` (while typing it completes the sentence first).
- Debug objects on window: `window.engine = engine` is already declared; for a game's own, write `/** @type {any} */ (window).game = {...}`
  (`npm run types` reports properties on window as web hints, not errors).
- To operate a running game use the dev bridge, see `recipes/16-dev-bridge.md`.

## Folder guide (inside packages/engine)
- `core/` core: Engine (main loop, ground, step/describe), Events Input Saves Assets Audio I18n Clock Vars Jobs Stream Rays Budget UrlState Animator.
- `modules/` modules, one folder each, installed with `engine.use`; list in `CODEMAP.md`.
- `render/ ui/` material factory, post-processing; UI basics (windows, UI focus stack, toast, fadeScreen, worldToScreen).
- `index.js index.d.ts types/` entry and API declarations (`types/generated/` is generated from source JSDoc, never edited by hand).
- `packages/styles/lowpoly/` (`@threedog/style-lowpoly`, optional; the engine ships no art) the lowpoly package: `index.js` holds the style pack (all
  look parameters) and exports the asset pack `assets`, `models.js` the procedural models in it, `shapes.js` the default humanoid and pickup shapes,
  The bloom / outline / ao effects are in `packages/post-effects/` (`@threedog/post-effects`). The terrain preset `terrainPreset()` is a separate package, `packages/terrain-noise/` (`@threedog/terrain-noise`).
- `examples/world/` is the engine example (open world `/`, content-only placement). The small city (level, no terrain, no style pack, top-down) and
  the co-op page are test pages in the engine repository (`tests/city/`, `tests/coop/`), opened at `/tests/city/index.html` and `/tests/coop/index.html`.
- `tests/` specs.mjs + specs/ test list, `<name>/index.html` test pages, fixtures/ test assets. `public/` art for the examples.
- Each game `games/<game>/`: package.json, vite.config.js (one line, gameConfig), index.html, main.js, `content/` (items npcs dialogues quests pickups
  containers props templates triggers actions places level vegetation audio grids renames rules, plus the game's own kinds registered in
  `content/rules.js`; only these file names are read), `public/` (art; Blender source files go in `art/models/`), DESIGN.md, GAMEMAP.md (generated), CLAUDE.md.
- Each workspace has its own `.threedog/` (browser error log errors.log, screenshots shots/, generated cache) and `dist/`; neither is committed.

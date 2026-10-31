# Dev bridge: operate the running game from the terminal (npx threedog describe / step / press / op...)

Purpose: after changing code, don't write a playwright script or take a screenshot; just ask "what does the game look like now", advance time, press keys, change state. Output is English, three lines or fewer, to save tokens.

What the bridge changes lives in this session only: `op`, `step`, `state` and `js` alter the running game and its saves, never the level. To change the level, edit `content/*.js` (templates, props, npcs…) or the level model and reload the page.

## 1. Usage
```
npm run dev -- my-game          # terminal A: start the dev server first (for the engine example just npm run dev)
npx threedog describe -w my-game     # terminal B: look at the scene (inside the game folder you can omit -w)
```
No browser needs to be open: when the first command arrives, the dev server itself opens a headless page with Playwright (`?threedog-headless`; the game only advances on step); once you open the page in a browser, commands go to the real page you clicked most recently.

| Command | What it does | Example output |
|---|---|---|
| `describe` | One-line scene summary: position / time and weather / nearby / quest | `player (4.0, 7.0) in forest · 07:11 day 1 · clear` |
| `describe --full` | The state as text, summary first (`engine.describeText()`: at most 30 lines, the nearest things, one line per module with its key counts, and a last line on how to expand). Details: `describe <path>` for one part, `engine.describeText({ full: true })` for everything | `quests: active[1], done=0, failed=0` |
| `describe --all` | Everything: every nearby thing and every module's full data (`describeText({ full: true })`); large, prefer a path | |
| `describe player.position` | Player coordinates { x, y, z } (numbers) | `{ "x": 4, "y": 1.2, "z": 7 }` |
| `describe player.state` | Just one item of `engine.describe()` (dotted path, `--max characters`) | `"idle"` |
| `step 2` | Advance 2 game seconds (deterministic; a real-time page is paused first) | `✓ stepped 2 s · player (4.0, 7.0) in forest · 07:20 day 1 · clear` |
| `press interact` | Press an action name or key once (`KeyE`, `e`, `Escape`). **It advances game time**: 0.1 s held + one rendered frame of 1/60 s, about 0.117 s in total; account for this when measuring timing, or shorten the hold with `--for 0.02` (a press must last at least one frame to be read, so there is no way to press without advancing) | `✓ pressed menu (Escape) · … · window open: settings` |
| `hold moveForward 1.5` | Hold for 1.5 seconds | `✓ held moveForward (KeyW) for 1.5 s · player (-0.6, 3.0) …` |
| `ops` | What the player can do now: every op offer checked with `can` (see `recipes/23-ops.md`) | `✓ shop.buy shop=bakery item=bread · ✗ shop.buy shop=bakery item=cake (soldOut)` |
| `op shop.buy shop=bakery item=bread n=2` | Run a game op (source `bridge`, **no time passes**). Values follow the op's `args` shape: `n=2` becomes a number, `position=3,0,-2` an array. **Change state with this, not with `js`**: `js` writes go around the op log and the dev guard warns | `✓ shop.buy → 2 · Bag gold×2 bread×2` / `✗ shop.buy: noMoney (Not enough gold)` |
| `inspect` / `inspect npc_3` / `inspect 10,-4` | What is around the player (or that actor / spot) and which ops it can do now, with reasons (`engine.inspect`, recipes/23-ops.md section 8) | `player at (4, 7) · near: 老渔夫 1 m` / `✗ barter.buy shop=fisher-basket item=feather (soldOut: …)` |
| `pick 480,270` | What is at that screen pixel (from the canvas top-left): record id, kind, template, the content file and line that defines it, its fields (recipes/30-templates.md section 5) | `✓ chest-home (kind chest, template chest) …` / `defined in content/props.js:14: edit it there …` |
| `explain op barter.buy shop=fisher-basket item=berry` / `explain quest first-light` | Why an op cannot run now (the reason and the op's note on fixing it first; `--full` adds the last attempt and the events around it, `detail`), or where a quest is stuck (`engine.explain`) | `✗ barter.buy {...} cannot run now: noFilm (Not enough film)` |
| `explain op name key=value --full` | Adds the detail: the op's last attempt and the events around it | |
| `scenario barter` | Run the scenario test `tests/scenarios/barter.json` on this page (recipes/23-ops.md section 7); prints failed checks, leaves the page paused | `✓ scenario barter: 6 checks passed` |
| `state time=18:30 weather=rain pos=40,-20` | Change the scene (same as URL parameters: time weather pos save wait cutscene state) | `✓ applied · … 18:30 day 1 · rain` |
| `js "engine.sky.timeOfDay"` (alias `eval`) | Evaluate an expression in the page; `engine` is available directly and `await` works inside; multi-line statements need their own `return` (e.g. `js "const p = engine.player.position; return p.x + p.z"`). Put long scripts in a file: `js --file script.js` (path relative to the current directory) | `✓ 0.77` |
| `snap name` | Screenshot to `.threedog/shots/name.png` | `✓ screenshot .threedog/shots/t1.png (163 KB)` |
| `snap-describe save` / `snap-describe diff` + name | Describe snapshot instead of a screenshot: save the gameplay part of `describe()` as a baseline, or print how the running page differs from it (section 7) | `✗ describe "market" differs from the baseline in 1 place:` |
| `errors` | Page errors added since last time (the full log is in `.threedog/errors.log`). Known error classes get a `-> Possible cause: … Read: recipes/…` line (section 8) | `✗ 1 new error` / `✓ no new errors` |
| `loading` / `loading hero` | What loading waits for, what failed (file, HTTP status, fallback) and whether it blocks the start; answers while `start()` is still running or stuck. With a name: that task with its source manifest and path (`recipes/05-props-bake.md` section 3) | `… waiting: decoding model "hero" (…)` / `✗ Loading finished, 4/5 ok, 1 failed` |
| `reload` / `resume` | Reload the page / resume real-time running | |

## 2. Notes
- **`step` / `press` pause the real page** (the output reminds you); resume with `npx threedog resume` when done. A headless page only advances on step anyway.
- **`snap` on a real page captures only the canvas** (not the HTML UI); on a headless page it captures the whole page. To see UI state use `describe` (`ui.windows`, dialogue).
- **Keys go through `engine.input` like a real keyboard**: action names are translated to keyboard keys (gamepad buttons are ignored); when a window locks input, menu-type actions (`pressedRaw`) are still received.
- **In your own page scripts and tests do the same with `engine.input.simulate(action, down = true)`** (it goes through the same path as `press`, and works with `engine.step`): `engine.input.simulate('jump'); engine.step(1 / 60); engine.input.simulate('jump', false)`. Never call `_keyDown` / `_keyUp` (internal).
- `describe` by default gives only the 3 nearest things and the first quest; for detail use a path (`quests.active`, `nearby`, `world`) or `--full`; don't dump everything at once.
- Several pages: `--page /<page>.html` picks the path; `-w name` picks the workspace.
- To change the port: `npm run dev -- my-game --port 5000`; the CLI finds the port from `.threedog/dev.json`, so you don't need to specify it again.
- If a command never becomes ready: most likely `main.js` doesn't set `window.engine = engine;` (it must come before `await engine.start()`). Under the dev server `engine.start()` attaches it automatically, but the bundled build used by npm test does not; the timeout error says whether the page has `window.engine`, `engine.ready`, and the latest page errors.
- Error messages give the cause and the next step, e.g. "no running dev server -> run npm run dev first".

## 3. Windows / PowerShell notes
- **Quote commas**: PowerShell splits `pos=1,-8` into two arguments and the coordinates become NaN. Write `npx threedog state "pos=1,-8"` (the bridge reports an error and shows this tip when pos is not two numbers).
- Wrap the whole js / eval expression in **double quotes** and use single quotes for strings inside: `npx threedog js "engine.vars.counter('score')"`. PowerShell expands `$variables` inside double quotes; to pass `$` literally wrap the whole thing in single quotes.
- **Write a command on a single line**: a multi-line here-string passed to a native command often silently returns nothing in PowerShell. Put several statements on one line separated by semicolons, or write them to a file and use `npx threedog js --file script.js` (no quoting or newline worries).
- Some terminal sandboxes (Bash) block commands containing the word `eval`: use `js`, not `eval`.
- Paths containing Chinese characters are fine; inside the game folder you can omit `-w`.

## 4. Let describe see the game's own state
A game's own state (score, number of targets, crops) is not in `describe` by default. **Small games use this**: register it in one line, no module needed:
```js
engine.describe.add('range', () => ({ score, targets: targets.length }));   // the returned handle's .remove() cancels it
```
After that `npx threedog describe range` shows it, and `describeText()` includes it too. The name must not collide with a core field (player, time...) or a module name; if the callback throws, only this item shows `{ error }` and the rest are unaffected.
**Large games write their systems as modules** (see 14-custom-module.md) and use the module's `describe(e, ctx)` hook: the return value likewise goes into `describe().<module name>`, and `ctx.near()` can report "things nearby".

## 5. Safety
The bridge exists only in the dev server (`apply: 'serve'`); built and preview output contains no bridge code (`npm test -- "dev bridge"` checks this). The command entry point `POST /__threedog/cmd` accepts only local connections, requires the random token in `.threedog/dev.json`, the Host must be localhost, and anything carrying an Origin (sent from a web page) is rejected.

## 6. Reuse in scenario tests
The commands run in `node_modules/@threedog/tools/threedog/commands.mjs`: `run(driver, command, args, { dir })`, and the driver only needs `{ evaluate(src, arg), screenshot(), reload?() }`. The dev bridge's driver forwards the three to the dev server; a scenario test implements the same three with Playwright's `page`.

## 7. Describe snapshots instead of screenshots
A baseline is the gameplay part of `engine.describe()` saved as JSON (`<workspace>/tests/snapshots/<name>.describe.json`, commit it). `perf` and `time.elapsed` are dropped; numbers compare within a tolerance (default 0.5); a list of things with an `id` or `name` is compared by that key, so a reordered `nearby` is not a change. A difference comes out as text, e.g. `player.x: 10 -> 14 (changed 4, tolerance 0.5)` or `nearby[Cow]: added {...}`.

```
npx threedog snap-describe save market-noon --only player,quests,nearby     # write / overwrite the baseline
npx threedog snap-describe diff market-noon --only player,quests,nearby     # compare the running page with it (exit code 1 if different)
```
Options: `--only a,b.c` (compare just these fields; dotted paths allowed), `--ignore x.y` (extra fields to skip), `--tolerance 1`. Use the same `--only` for save and diff.

In a test, one line (the page must already be in the state to freeze; use `engine.pause()` and `engine.step()` first):
```
import { expectDescribe } from '@threedog/tools/describe-snapshot';   // in the engine's own specs: '../../../tools/describe-snapshot.mjs'
await expectDescribe({ check, ev }, 'market-noon', { only: ['player', 'quests', 'nearby'], tolerance: { default: 0.5, player: 1 } });
```
Update after an intended change: `threedog test <name> --update-snapshots` (writes instead of comparing) or `threedog snap-describe save <name>`. Review the JSON diff in git before committing. Take a screenshot only when the look changed.

## 8. Errors carry a code, a fix and a doc page
Every error the engine raises by name carries a stable **code**: `err.code`, `err.fix` (what to do) and `err.docs` (pages to read), and its message ends with `[code]` (e.g. `clock.every(seconds): ... [clock-interval]`), so logs show it too. Other known classes (missing `world()`, non-plain world data, duplicate ids, unknown option / name, module order, asset 404, ...) get the code of the hint whose pattern matches. Dev text adds `Code: …` (when the message has no tag), `Possible cause: …` and `Read: recipes/…, api/…`. The same data shows in `engine.error` (`{ where, message, code, fix, docs }`), the first line of `describeText()`, `.threedog/errors.log` and `threedog errors`. Tables: `core/errorCodes.js` (`ERROR_CODES`: code -> fix, doc pages; a code never changes meaning) and `core/errorHints.js` (`ERROR_HINTS`: pattern, cause, doc pages; `codedError(code, message)` builds a coded error). To cover a new class append an entry (a pattern class also needs a sample message in the engine repository's `packages/tools/tests/ai-tools.mjs`).

## 9. Reusable scenarios
`engine.applyState({ time, weather, pos, ... })` (also URL parameters) sets up a scenario in one call; `engine.defineState(name, params)` names a combination so tests and scenarios reuse it.

## 10. MCP server: Claude Code, Cursor and other MCP clients
`npx threedog mcp` runs the dev bridge as an MCP server over stdio. Each command becomes a tool (`describe`, `step`, `press`, `hold`, `state`, `ops`, `op`, `inspect`, `explain`, `errors`, `loading`, `snap`, `snap_describe`, `scenario`, `reload`, `resume`) and returns the same text as the command line; `snap` also returns the PNG as an image. It finds the dev server through `.threedog/dev.json` like the CLI, so start `npm run dev` first (without it, a tool call answers with that fix). It is only a local client of the bridge and opens no port; every check in section 5 still applies. As with the command line, the `op` and `step` tools change the current session and its saves; the level itself changes only by editing content files.

Claude Code (in the game folder; in the engine repository add `-w name` after `mcp`):
```
claude mcp add threedog -- npx threedog mcp
```
Cursor, `.cursor/mcp.json` in the game folder: <!-- r18-ignore-line -->
```
{ "mcpServers": { "threedog": { "command": "npx", "args": ["threedog", "mcp"] } } }
```
On native Windows, wrap npx in cmd: `claude mcp add threedog -- cmd /c npx threedog mcp` (Cursor: `"command": "cmd", "args": ["/c", "npx", "threedog", "mcp"]`).

The `js` tool (arbitrary code in the page) is off by default; `threedog mcp --allow-js` enables it, for development only. Other options: `-w name` (workspace), `--page /<page>.html` (page path).

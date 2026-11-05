# Capability test results: batch 2 (drive and read the game)

Run 2026-11-05, 12:13 to 12:33, on branch `test/capability-b2`. Rows and pass lines: `tasks.md`.

**Result: 8 of 9 passed, 1 failed, 0 blocked.**

Renderer for every row: software. Headless Chromium, SwiftShader through ANGLE; WebGPU was asked for, `requestAdapter()` returned no adapter, so three's WebGL2 backend drew. No row ran on a real GPU. Only C04 reads pixels.

## Rows

| Row | Result | Minutes | Cause, if failed |
|---|---|---|---|
| C03 | pass | 3 | |
| C04 | fail | 4 | In a fresh `--open-world` game `state weather=rain` printed `✓ Set` with exit 0, but the weather stayed clear, because the game only has `clear` and the refusal goes to `errors` as a warning. |
| C05 | pass | 2 | |
| C06 | pass | 2 | |
| C07 | pass | 1 | |
| C08 | pass | 2 | |
| C24 | pass | 2 | |
| C33 | pass | 1 | |
| C27 | pass | 1 | |

Minutes are wall clock and include reading docs. C03 and C04 include about one minute of `new-game`; from C05 on the games were created ahead, so that minute is not counted.

C04 after adding one line of code (`weather: presets.weather.temperate` in `openWorld`): `state time=20:30 weather=rain` took effect, `describe weather` gave `rain`, and `picture compare` showed 36% darker. So the tool works once the game has a weather table; the prompt's "without editing code" cannot be met in a fresh game, and the tool said it had been.

## Root causes that block rows

| # | Root cause | Layer | Rows blocked | Fix belongs in |
|---|---|---|---|---|
| 1 | A bridge command prints `✓` and exit 0 when the request did not take effect. | tool (engine reports the refusal only as a warning) | C04 | `applyState` result, read by the bridge `state` command |
| 2 | A fresh open-world game has no weather but `clear`, while recipe 16 gives `state time=18:30 weather=rain` as the plain example. | tool (template) and docs | C04 | template: decide whether `openWorld` starts with a table; recipe 16: say the name must be in the game's table |

Cause 1 also reached two rows that passed, and those are the stronger reason to fix it:
- C05: `step 3` printed `✓ Stepped 3 s`, exit 0, although the engine froze on the error at tick 120, after 2 s. The error text is on the same line, but a script reading the exit code sees success.
- C08: `"fresh": 1` in a scenario's `state` is silently ignored. Only `true`, `'1'` and `''` count (`freshOn` in `core/UrlState.js`), so the number that looks like `state fresh=1` does nothing. `verify` passed once, then failed on the rerun with no code change. Confirmed with `applyState({ fresh: 1 })` against `{ fresh: true }`. Layer: engine.

## Problems that block no row

Engine
- Translated names leak into English bridge lines: `on 默认`, `· 晴`, `· 雨` (C03, C04, C07, C08). A comment in `core/describeText.js` says this was fixed there; the short status line still has it.
- A plain `undefined.toFixed` TypeError in game code is tagged `[not-installed]`, which points at a missing module (C05). The pattern in `core/errorHints.js` matches any "Cannot read properties of undefined".
- A used `once` interaction explains itself as `disabled (Its enabled() is false)`, not "already used" (C03, C07).

Tool
- `describe <path>` and `thing` cut long output mid-word with no notice (`describe modules` in C04, `thing` in C06, `describe time` in C24). `--max` exists but nothing points to it.
- `press` and `op` report success without saying what changed (`✓ interaction.use`); the result has to be looked up separately (C03, C07).
- `errors` shows the generic `gameplay-frozen` line and leaves out the real message; only `step` and `describe` print it (C05). It does give `rules.js:8:29`.
- `status` still reports the old page's error after `reload` until a new error or server replaces it (C05).
- `ops` prints `channel=[object Object]` (C03, C07, C08).
- `log(...)` in a `js --file` script prints nothing, on pass or fail (C33).
- `picture palette` and `picture compare` reject `-w`, the option every other command takes (C04).
- Fresh open-world template: its own `picture/index.js` sets `scene.background`, which raises an `[owned-prop]` warning at tick 0. The sky band was `#949494` at 07:16 and at 20:38 (C04). Not confirmed that the warning is why the sky did not change.

Docs
- Recipe 16 section 10 names `style_palette` and `style_compare`; the server has `picture_palette` and `picture_compare` (C27).
- The template comment says an interaction with `counter` "counts it", but the count is only in `describe hud`; `engine.vars.counter('coins')` stayed 0 (C07).
- Adding `inventory()` as the docs show raises `[input-unbound]` for `inventory`; the docs do not mention binding it (C06).

Not explained
- `hold moveForward 5` from a fresh start walked diagonally, to (-15.9, -15.5) (C03). Possibly the follow camera's starting angle; not checked.

## How far to trust these results

- C05 and C06 were not blind: I planted the error and built the shop, so I knew the answers. The outputs gave them unaided, but finding them cold was not tested.
- C05 had a second, unplanned error: my setup called `engine.vars.set`, which does not exist. `step` reported it and it was fixed from `docs/api/vars.md`.
- Each game was set up by me as the row's "the game": player and interaction (C03, C07, C08), shop (C06), calendar and timer (C24), game-over op (C33).
- C24: `skip seconds=600` equals 10 clock minutes only because I set `dayLength: 86400`. With another day length, 10 clock minutes is a different number of seconds.
- Engine source was read only to explain results after a row was judged. The one exception is `Vars.js`, read alongside `docs/api/vars.md` while fixing my own setup error.
- Other agents were using the machine, so minutes are rough. All test games are deleted and no process from this worktree is left running.

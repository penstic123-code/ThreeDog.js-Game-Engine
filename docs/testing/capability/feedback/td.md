# Feedback: Lantern Road (games/td)

Clock started 16:31 with the setup commands.

## Times
- First picture: 12 min 40 s (16:43:44, board, road, hearth, HUD, drawn by WebGPU).
- First playable: 15 min (16:46, towers placed by real mouse clicks, waves walking, lose window opening).
- Finished: 39 min (17:10; game done and all checks green at 17:08, the rest was records and the commit).

Last results: `threedog check -w games/td` passed, 0 errors, 0 warnings. `threedog test -w games/td`: 26 checks in 3 items, all passed (the run took 51 s once and 2.0 min once; the second was on a busy machine or after the new creep shape, I did not find out which).

## Where I got stuck
1. **`check` said my own data kinds needed a `load`, then the page died anyway.**
   `check`: `kind "towers" has no load(e, data) function, so its data would never reach the game`. My data reached the game fine: `main.js` imports it. I added an empty `load`, and said why in a comment. Then `check` passed but `shot` failed: `content.load: unknown content "towers"`. The cause was that `rules` must itself be listed in `content/index.js`. Recipe 20 says "Add `recipes` to `content/index.js`" but never says the same of `rules`, and the error's fix ("register it in content/rules.js") names what I had already done. The word `rules` in its long "Known:" list was the only clue. About 1 minute lost.
2. **Towers stopped shooting in wave 2, with no error anywhere. This was the costly one, about 8 minutes.**
   I stored a shot's target handle in a swarm field (`fields: ['target', ...]`), which recipe 65 seems to invite: handles are "safe to keep", "a handle in a save stays good". Handles go up by 2^20 each time a row is reused (seen: 5242881, 7340032, 8388609), so after a few dozen deaths they pass 16,777,216, and a Float32 column rounds them. `row()` then answers -1, which is also the honest answer for a dead target, so the shot quietly vanishes and the tower has fired a blank. It looked like bad balance: I retuned damage twice and the leak count did not move, which is what made me stop and trace creeps with `threedog js --file`. The recipe does say columns are Float32 and exact to 16,777,216, but in a different section, and nowhere says a handle can be larger. Fix: targets live in a plain `Map`. A warning from `spawn` when a value does not survive the column would have saved all of it.
3. **`engine.canvas` does not exist.** My test helper threw `Cannot read properties of undefined`. Used `document.getElementById('view')`. Small; no doc claimed it, I guessed.
4. **`threedog js --file` runs inside a wrapper that already has `log`.** `Identifier 'log' has already been declared`. Documented as a global, my mistake, 30 seconds.
5. **`js` output is cut at 500 characters** and says so (`--max`). Fine, only worth knowing when tracing.
6. **`git add -f games/td` picks up `.threedog/`** (25 MB of vite cache, 166,000 lines staged). The brief said leave out `node_modules` and `dist`; I also left out `.threedog` because it is tool output, and kept screenshots in `games/td/shots/`, which the root `.gitignore` comment points to.

Not a doc problem, but my time: a tool in my own harness refused long shell commands, so the first batch of files had to be rewritten with a file tool. About 3 minutes.

## What told me something false
- `check`: "its data would never reach the game" for a kind with no `load`. False for a game that imports its data; a kind with no `load` is a legitimate shape, and I ended up writing an empty function to quiet it.
- `check` passed while the page could not start (item 1): `check` knew about my `rules.js`, the runtime did not. A green `check` did not mean the content loads.
- Recipe 65: "Keep these" about handles, without the limit that a handle may not fit a swarm column (item 2).
- `new-game` CLAUDE.md "Commands": says `npm run dev`; the brief's `threedog play` was the better route and is only in COMMANDS.md. Not false, but the game's own notes never mention it.
- STATUS.md template says "Offer three minimal versions of the game", while CLAUDE.md says "A clear request: build it, no confirmation round". I followed CLAUDE.md.

## What worked better than I expected
`threedog how "tower defence grid"` went straight to the two recipes I needed. Grid, ops, swarm, `makeWindow` and `session.newGame` did what the docs said the first time; the lose run passed on its first try. `threedog test` ran real Playwright mouse clicks against the built page with no setup. "refused presses: tower.build noOil" in a failed test's summary is a very good line.

## What does not work, or is unproven
See STATUS.md "Not verified" and "Open problems". In short: nobody has played it by hand in real time; there is no sound; waves 1-3 are too easy.

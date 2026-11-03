# NOTES: acceptance run, 提灯人 (lantern)

Started 22:37, finished about 23:10 (roughly 33 minutes of the 60).

## First playable
- 22:37 start, about 22:45 first picture of the lamp-bearer in the village, 22:48 first green test run that walks and collects (jars, oil, gate, win). So **about 11 minutes** to "can walk and collect".
- After that: ~20 minutes of look work (camera, lighting, trees) and one bug (below), then tests, build and docs.

## Doc lookups (about 19 in total, all answered, none came back empty)
- `npx threedog how`: 2. "game test" returned the dev-bridge recipes (not the tests/specs format; that was in COMMANDS.md). "skip title" found recipe 07 section 1b.
- `AI.md`: 1 (whole index, found the rows for flow, settings, saves, ops).
- Recipes: 5. 01-new-game (setup, found), 07-flow-scenes-pause (title, session, pause, found), 32-action-game (ops, death/retry pattern, found), 26-ui-parts section 5-6 (title, settings tabs, found), 52-look + 09 first part (sky keyframes, fog, found).
- api pages: about 9. settings, openWorld, style (keyframes), saves, collision, characters, cameraRig, events (`ui:open`/`ui:close`), hud (not used).
- `COMMANDS.md` test section: 1 (spec file format, found).
- Also read: the `--example` template's `main.js` (as a pattern for ops/saves) and, once, `packages/engine/modules/collision/Collision.js` to learn the shape of `addBlocked`'s `bounds` (`{ minX, maxX, minZ, maxZ }`); the api page only says "bounds" without the shape.

## Runtime errors (3 engine-reported, plus 1 of mine in a test)
1. `TypeError: Cannot read properties of undefined (reading 'load')` (page threw before `window.engine` existed; hint `[not-installed]`). Cause: I replaced the template's `engine.use(world(), content())` and forgot `content()`, so `engine.content` was undefined. The hint said "a module is not installed", enough to find it. Fixed in one try.
2. `ops.run('game.die'): source 'shadow' is not one of player, game, bridge, test, replay, net [op-misuse]`. Changed the source to `'game'`. One try.
3. `engine.session.load() was called before engine.start() finished ... [session-early]` (in my first save test). Rewrote the test to go through the real title's Continue button. One try.
4. (Mine, not the engine's) a JS string with a real newline in `world.js`: build said `PARSE_ERROR Unterminated string` with the file and line; my first fix attempt did not change anything (my script), second worked.
Every engine error that was shown was fixed from its text on the first change.

## Internals / going around the engine
- No underscore fields and no undocumented engine fields used. Reading engine source: once, see above.
- Went around the engine on purpose, all with public or plain three.js routes:
  - Trees are not `collision.addCircle` colliders: every circle (any height) pulled the follow camera into the player. They are one `collision.addBlocked(fn)` rule instead (walking is blocked, the camera is not).
  - Pines between the camera and the player are cut open with an `onBeforeCompile` fragment discard (plain three.js).
  - `engine.camera.near = 2.5` (plain three.js).
  - HUD, death screen and win screen are DOM in `index.html` (the engine has no death/win screen; I did not use `hud()` for the jar counter, a choice, not a block).
  - Startup flag `?play` skips the engine title for tests and screenshots (recipe 07 section 1b pattern).

## Where I got stuck or confused (my words)
1. "The camera keeps collapsing into the player in the forest." Took about 15 minutes. I first thought it was camera settings, then the tree collider `height`; the real cause is that any `addCircle`/`addBox` collider blocks the camera ray, and `canopyHeight` in the collision docs applies only to the terrain's own trees. Nothing says "a collider can opt out of camera occlusion". I only saw the cause after printing camera position vs player distance (3.2 m instead of 10).
2. "`npm run shot -- /` opens `C:/Git/`": under Git Bash the page argument `/` was turned into a Windows path when going through `npm run` (COMMANDS.md says shot undoes this by itself; it did not through npm). Fixed with `MSYS_NO_PATHCONV=1`.
3. "How do I screenshot past the title?" The shot tool shows the engine title as an opaque screen; I had to add my own `?play` switch. Wished for a `--skip-title` or that the title were not part of the shot.
4. Smaller: `how "game test"` did not point at the tests/specs format; the settings `limits` and `freezeWorld` option names took a second read.
5. A bug I found only by playing the whole menu loop in a real browser, not by the unit tests: "Back to title" from the death screen set the phase to play before the quit finished, the frozen world un-froze, the shadow caught the player again and the death overlay stayed on top of the title (the title's buttons were unclickable). Fixed by unfreezing only after `session.quit()` resolves; a test now covers it.

## Not verified
- Real GPU look beyond the headless Chrome used here (software GL in my screenshot script, GPU in `npm run shot`); no phone/touch; sound does not exist.
- Two of the 7 test items failed once when run beside the others and passed alone (load-sensitive, they wait with fixed `wait()` times).

# Capability results: rows M11-M13, M16-M25

Run 2026-11-05 on branch `test/capability-b7a`, from commit c1863b3d. 12 passed, 0 failed, 1 blocked. About 32 minutes in total, including the checks after the last row.

**Renderer: software, for every row.** The dev bridge's headless page drew with SwiftShader through three's WebGL2 backend (`requestAdapter() returned no adapter`), although the machine has an RTX 5060. No row ran on a real GPU. Only M17's frame numbers depend on this, and software is the slower case.

## Rows

Minutes are wall clock and approximate. Each is well under the row's limit.

| Row | Result | Min | Limit | Evidence |
|---|---|---|---|---|
| M11 car | pass | 4 | 15 | 20.5 m in 3 s of held forward, up vector 0.9996, shot shows wheels on the ground. The recipe's `engineForce: 1200` gave 8.2 m, so it was raised to 3000 |
| M12 cameras | pass | 1 | 10 | Four kinds, four different positions, a full cycle of switches, no errors |
| M13 cutscene | pass | 2 | 12 | Door 50.2% open at 5 s, input blocked (W moved nothing), Esc jumped to the final state, input and camera handed back. Needed the workaround in cause 2 |
| M16 particles | pass | 2 | 10 | Shots show sparks, smoke and trail; all counts 0 after emitters stop and lifetimes end |
| M17 flock | pass | 6 | 12 | 200 alive after 30 s, 4 draw calls, 1697 triangles, JS 1.5 ms against the 8 ms reference, 56 fps on software. 3 of the minutes went to the hang in cause 3 |
| M18 settings | pass | 1 | 10 | Volume, quality and a rebind survived reload; the built-in button restores keys. Volume and graphics have no built-in reset (cause 8) |
| M19 music | blocked | 3 | 8 | Music half passes: track followed calm, danger, calm, and `playing` was real once audio ran. Stinger half cannot be judged (cause 1) |
| M20 villagers | pass | 3 | 15 | All three NPCs went round a 14 m wall and arrived within 12 s; player stopped at x = -1.4 against the wall face at x = -1; shot shows 4 characters |
| M21 use key | pass | 1 | 6 | Prompt shown at 1.7 m, hidden at 4 m; one press ran the action once |
| M22 dialogue | pass | 2 | 10 | Option 2 set the story switch, dialogue ended, input came back; bubble lines played while the player could move |
| M23 bag, shop, chest | pass | 2 | 12 | `noMoney` and `bagFull` both refused with readable text; gold and counts changed both ways; potions stacked 5 to a slot; chest gave its item |
| M24 pickups | pass | 1 | 8 | Nearest chosen each time, pickup went into the bag, drop re-created it at the player with its data kept |
| M25 quest | pass | 2 | 10 | Run 1 finished with the reward (25 gold); run 2 failed, `explain quest` exits 1 and the toast gives the reason |

## Which rows were not blind

None of the 13 was strictly blind, and M17 and M19 are the weakest. One agent ran all rows in order, after reading the whole of `tasks.md`, so it knew every pass line and the coverage table's module names, and it carried bridge knowledge from row to row. Read the times as a best case: the first row paid for learning the tools.

- **M17**: found `engine.swarm` from the docs file list after `threedog how "flock of birds"` found nothing. A blind AI might have written its own flock, which could still pass.
- **M19**: the word "stinger" came from the pass line, not the prompt.
- **M13, M18**: the skip and reset checks were written because the pass line names them.

Other limits on the method:
- Each game was a copy of one `new-game` output with the name replaced, not a new `new-game` run, because each run takes 90 s of full checks.
- `check` and `types` were not run on the row games, because no pass line asks for them.
- Docs came from `node_modules/threedog/docs` only. Engine source was not read, apart from one search that printed a file name.

## Root causes

Ordered by rows blocked, then by rows slowed. Only cause 1 blocks a row; the rest cost time or gave false information on rows that passed.

### Blocks a row

1. **Stinger leaves no record, and audio does not start on the bridge page** (M19). Owner: engine for the record, tool for the unlock.
   `music.stinger` emits nothing and appears in no state, and `tasks.md` says sound rows are judged by records, so "played once" cannot be shown; a wrapper around the call proved only that it was called. Simulated `press` does not unlock audio (`music.ready` stayed false, `playing` null); it took a hand-dispatched `pointerdown`-style event in `js`.

### Slows or misleads, no row blocked

Tool:

2. **The headless page silently opens with `cutscene=skip`** (M13; also tool plus docs). A cutscene finishes in tick 1 with no message, and recipe 16 gives the page address as only `?threedog-headless`. `state cutscene=keep` fixes it, but `state cutscene=play`, an invalid value, reports success and changes nothing.
3. **Every bridge command hangs when the page's script failed** (M17, reproduced on purpose). After a syntax error `reload` exits 1 with a clear message, then `step`, `inspect perf`, `resume` and `js` each printed nothing for 25 s until killed, and `snap` was never seen to finish. Any row with one typo can hit this.
4. **`threedog how` misses the plain words of a task** (M11, M17, M19; also docs). "four wheeled car" leaves recipe 11 out of the top five, "flock of birds" and "many moving objects" never reach recipe 65, and "stinger" is reported as unused by the docs although `api/music.md` documents it.
5. **`inspect perf` prints a green tick on no data while stepping** (M17). After 30 stepped seconds it says `✓ cpuMs 0 ms`, `fps 0`; real numbers need `resume`. A pass line built on it would pass anything.
6. **Small output faults**. With no player the summary is blank or `undefined` (`Pressed hit (KeyH) · undefined`; M16-M19, M23). `ops` prints `channel=[object Object]` (M22). `status` still reports the old page error after the file is fixed and reloaded (M17).

Engine:

7. **Container start items that do not fit are dropped silently** (M23). A shelf with capacity 6 listed 7 slots of items; one sword and both gems vanished with no warning, then `gem` read as sold out.
8. **No way to reset settings values** (M18). Only `resetBindings` exists. Volumes can be set back by hand, but the fresh `custom` quality state is not a preset, so a game must snapshot it itself.
9. **Silent no-ops around restart and reset** (M17, M25). A swarm spawned at startup is emptied by the new game with no warning (documented in recipe 65, but only there), and `quests.start` on a finished quest does nothing and says nothing. `explain quest` says "its fail() returned true" without naming the condition.
10. **Built-in text showed in Chinese in an English game** (M11, M18, M20, M22, M24, M25). Examples: `上车`, `捡起 Apple`, `任务完成`, the whole settings menu, and `on 默认` in summaries. `engine.i18n.locale` read `zh-CN`. This machine runs Chinese Windows, and the run did not check whether the locale follows the browser, so it may be correct behaviour here.

Docs:

11. **The vehicle recipe's sample car is slow** (M11). `engineForce: 1200` with `mass: 600` covers 8.2 m in 3 s, so a copied sample misses a plain "drives" test. One value change fixes it.
12. **`swarm` is missing from the game's own lists** (M17). `CLAUDE.md`'s table and GAMEMAP's "Not used yet" do not name it. `api/swarm.md` says `yaw` is "also drawn by the engine", but the column exists only if listed in `fields` (`d.yaw` was undefined without it), which is easy to miss.

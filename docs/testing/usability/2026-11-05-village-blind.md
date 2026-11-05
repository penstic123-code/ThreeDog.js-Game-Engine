# Small village blind test (2026-11-05, 07db1dc7)

A fresh agent got a 15-minute brief with no mention of content files: a village, villagers, find three chickens, win.

**Decision: flat content stays.** All placements went into `content/props.js` unprompted (houses, fences, trees, small props, ground patches), and NPCs, dialogues, quests, items and pickups into their content files. `main.js` stayed at 42 lines with no hand-placed objects. `content stamp`, `source` and `content capture` were not used, so this says nothing about them.

**The game was not finished.** First picture at 10 min 29 s; no working win. `threedog test -w village` passed 8 of 11: pressing E beside a hen picked nothing up, cause not found. Nine other agents were running on the machine, which slowed `check` (over a minute) and `test` (about 50 s).

Reported friction, not yet checked:
- `model: ['name', ...args]` works on props, crashes at run time on NPCs, and `check` misses it.
- `{ model: 'humanoid' }` in recipe 02 reads as built in; it is not registered in a new game.
- `check` rejects `place: 'home'` that the template's main.js supplies at startup.
- A prop's `scale` takes a number only.
- Conditions have no "or".
- `art board` run from the repo root wrote outside the game.
- Engine UI text follows the browser language in a game written in another language.

The game is at `../village/V1/games/village` (commit 72100b7d).

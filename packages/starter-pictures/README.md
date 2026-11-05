# Starter pictures

Does a copyable starter picture help an AI make a better-looking game, or just make every game look alike? This folder holds library entries so that question
can be tested, and any game can use them today. The trial plan is `docs/testing/usability/2026-11-05-starter-kit-trial.md`. Until the trial says otherwise these are an option, not a recommended way to start.

This is an ordinary threedog library folder. It sits in the repository, outside the engine package, the tools package and the template, because the engine ships no look: `npm install threedog` does not bring it.
A game that does not pull an entry gets nothing from it, and new games do not see it. There are two entries, far apart on purpose:

- `bright-cartoon`: clear, bright, flat color with clean edges, sky and clouds.
- `ascii-meadow`: a soft, muted landscape whose final image layer is real characters, drawn by its own `engine.post` effect in `ascii.js`.

## Pull it

Run these in a new game. `--force` replaces the four gray starter files in `picture/`, and `main.js` keeps working with no change.

```sh
threedog lib list --lib <repo>/packages/starter-pictures
threedog lib pull bright-cartoon --force --lib <repo>/packages/starter-pictures   # or ascii-meadow
```

A game that already has its own picture should pull beside it, then take only what it wants:

```sh
threedog lib pull bright-cartoon --to picture/starter --lib <repo>/packages/starter-pictures
```

To see all of it at once, call `sampler(engine, picture)` from `picture/sampler.js` after `createPicture` and shoot one of its views: `overview`, `shore`, `close` for `bright-cartoon`, `overview`, `bank`, `close` for `ascii-meadow`. Read the notes at the top of
`picture/index.js` next: they say what each file controls and what to change first.

The entry's `kind` is `picture`, which normally means one file. It holds several, so storing a new version needs `lib add picture --kind picture --force`.
Screenshots from real WebGPU are in `docs/testing/field/2026-11-05-starter-kit/` and `docs/testing/field/2026-11-05-ascii-meadow/`.

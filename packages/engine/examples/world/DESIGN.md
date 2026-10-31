# Design decisions

- **The pace is "slow"**: no combat, no failure; the player progresses by taking photos and wandering. For any new mechanic, first ask "will it make people feel rushed?"; if so, leave it out.
- **Film is the only limited resource**: each photo uses one (photo:taken in main.js); the only sources are the start, the old fisherman's dialogue, and quest rewards. Be careful when adding new ways to get it, so film never becomes unlimited.
- **Terrain is procedural, so coordinates cannot be hard-coded**: the cabin position (home) and the riverside (river) are computed at startup; everything in content/ is placed relative to them with `{ place: 'home', x, z }`.

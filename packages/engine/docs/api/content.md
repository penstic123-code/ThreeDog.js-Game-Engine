# engine.content — content()

Content loading (content() module)


## Methods and properties
- `content.load(data: ContentPack | ContentPack[], opts?: ContentLoadOptions)` — Load content (items, pickups, vegetation, NPCs, dialogue, quests, keys, trigger zones, props, the game vocabulary rules): one pack, or a list of packs loaded together in order; an id defined by two packs of one call is an error naming both (a later separate load overrides by name instead). Example: `engine.content.load([baseContent, forestDlc], { places: { home } })`
- `content.condition(name: string, def: ContentConditionDef)` — Register a custom condition, e.g. condition('timeAfter', { ref: 'clock', test: (e, t) => e.sky.timeOfDay >= t })
- `content.test(cond: any) → boolean` — Whether a condition holds (object, array or function)
- `content.run(effect: any) → any` — Run an effect (object, array or function)
- `content.place(name: string) → XZ | null` — Place name -> position (load's places first, then level markers), null if none
- `content.where(p: { place?, x?, z? }) → XZ` — Position form in content { place?, x?, z? } -> world coordinates
- `content.template(name: string) → Readonly<ContentTemplate>` — The shared, frozen definition of a content template (content/templates.js); instance state lives on the world record. e.g. template('chest').container.capacity
- `content.spawn(name: string, at: any, fields?: { id?, rot?, scale?, y?, items?, … }) → WorldRecord` — New runtime instance of a template (inside an op or fixed step), saved whole; returns the world record (kind = template name). e.g. spawn('chest', { x: 10, z: 4 }, { opened: true })
- Properties:
  - `ready: boolean` All vegetation models are fetched and the models of world data such as nearby props are built (world.ready)
  - `markers: Map<string, HudMarker | undefined>` Markers added by the marker effect: id -> marker

## Data structures
- **ContentConditionDef** Custom condition: test(e, value) says whether it holds; ref/desc/describe are for the validator and the game map
  - `ref?: ContentRef` How the value is written, e.g. 'clock'
  - `desc?: string` One-line description
  - `test(e: Engine, value: any, raw?: any) → boolean` — Whether it holds: value is the value converted by ref, raw is the form written in the content
  - `describe(value: any) → string` — Write the value as human-readable text (for the game map)

## Condition words / effect words in content files (generated from modules/content/rules.js)
Conditions are used in quest step done, dialogue option if and line variant if; effects in dialogue do, quest reward and trigger zone onEnter / onExit. Several entries in one object = all must hold / run in order; an array works too. A game's own condition words go in content/rules.js (or content.condition); a game's own actions are ops, called with { op: [...] } (recipes/23-ops.md). The format of actions.js and how to write loading are in recipes/20-content-actions-save.md.
- Condition words:
  - `flag` value is a flag name, e.g. 'metFisher': story flag is set
  - `notFlag` value is a flag name, e.g. 'metFisher': story flag is not set
  - `has` value is { itemId: count }, e.g. { berry: 3 }: inventory has at least
  - `lacks` value is { itemId: count }, e.g. { berry: 3 }: inventory has fewer than
  - `counter` value is { counterName: count }, e.g. { sunsetPhotos: 1 }: counter is at least
  - `can` value is ['noun.verb', { args }], e.g. ['shop.buy', { shop: 'bakery', item: 'bread' }]: an op would succeed now (engine.ops.can)
- Effect words:
  - `setFlag` value is a flag name, e.g. 'metFisher': set a story flag
  - `give` value is { itemId: count }, e.g. { berry: 3 }: give items
  - `take` value is { itemId: count }, e.g. { berry: 3 }: take items
  - `bump` value is a counter name, e.g. 'sunsetPhotos': counter +1
  - `startQuest` value is a quest id: start a quest
  - `toast` value is text: show a toast
  - `particles` value is { name, at: [x, y, z], count }: play particles
  - `marker` value is a place name, or { place, x, z } / { x, z }: add an objective marker (hud module)
  - `clearMarker` value is a place name, or { place, x, z } / { x, z }: remove an objective marker
  - `op` value is ['noun.verb', { args }], e.g. ['shop.buy', { shop: 'bakery', item: 'bread' }]: run a game op (engine.ops.run); the game's own actions are ops
- Files content/ recognizes:
  - `items.js` items (id -> name, icon, description); also export startItems for starting items
  - `pickups.js` pickups on the ground (list)
  - `containers.js` chests / shelves (container id -> { capacity, items: starting goods }; starting goods are placed only the first time, then saved)
  - `npcs.js` NPCs (id -> name, schedule, dialogue)
  - `dialogues.js` dialogues (id -> speaker, nodes)
  - `quests.js` quests (id -> title, steps, reward; a step can have a target position)
  - `actions.js` own key actions of the game (action name -> default key, label)
  - `places.js` place names (coordinates computed at runtime in main.js)
  - `triggers.js` trigger zones (tag -> position / from level, enter/exit effects)
  - `level.js` level markers (spawn point, NPCs, trigger zones)
  - `vegetation.js` vegetation (name -> model, growth rule)
  - `props.js` props (list: model, position, facing, collision; or { template, x, z } = an instance of a template; or { id, grid, item, cell } = a grid item), streamed in on demand
  - `templates.js` reusable objects (name -> model, collide, interact, container, sound, animate, state defaults, physics body); shared read-only definitions
  - `audio.js` sounds by asset name, ambience and music rules as data, footsteps (sounds, ambience, music: { tracks, rules }, footsteps)
  - `grids.js` placement grids (name -> { cell, origin, size, zone?, flat? }); layout rules, not saved
  - `renames.js` renamed or deleted authored ids (old id -> new id, or null = deleted on purpose): the player's saved changes follow the new id
  - `rules.js` condition words added by the game ({ conditions }); actions are ops, not effect words
  - any other `<name>.js` the game registers in content/rules.js as kinds: { name: { desc, load(e, data), check?, map? } } (enemies, recipes, loot tables…)

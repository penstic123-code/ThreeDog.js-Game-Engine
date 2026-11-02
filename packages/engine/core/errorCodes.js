// Stable error codes: errors the engine raises by name end their message with "[code]" and carry err.code / err.fix / err.docs (codedError in errorHints.js).
// Plain data with no imports (node tools load it through threedog/error-hints). A code never changes meaning once shipped: tools and tests match on it.

// Naming rule for a NEW code: `<area>-<problem>` in lowercase with hyphens (save-version, look-verb, unknown-name): the area first so the codes sort
// and grep by subsystem. Codes already published keep their names even where they do not follow it (renaming would break the tools and tests that match them).

/**
 * Errors the engine raises by name (the message ends with "[code]"): code -> { fix, docs }. Codes are stable: tools and tests may match on them.
 * @type {Record<string, { fix: string, docs: string[] }>}
 */
export const ERROR_CODES = {
  'save-part-threw': {
    docs: ['recipes/20-content-actions-save.md', 'api/saves.md'],
    fix: 'A save part\'s save() threw, so nothing was written and the previous save is kept. Fix the save() named in the message ' +
      '(it must return plain data).' },
  'save-load-threw': {
    docs: ['recipes/20-content-actions-save.md', 'api/saves.md'],
    fix: 'A save part\'s load() threw, so the game was rolled back to how it was before the load. Fix the load() named in the ' +
      'message.' },
  'save-refused': {
    docs: ['recipes/20-content-actions-save.md', 'api/saves.md'],
    fix: 'The save is unreadable, from a newer build, or a migrate step is missing; nothing changed. Add the migrate step, or run ' +
      'the newer build.' },
  'save-version': {
    docs: ['recipes/20-content-actions-save.md', 'api/saves.md'],
    fix: 'saves.register(key, { version, migrate }): version is a whole number >= 1; migrate keys are older versions, each a ' +
      'function data => newData.' },
  'save-import': {
    docs: ['recipes/20-content-actions-save.md', 'api/saves.md'],
    fix: 'Import only text or files made by saves.export / exportFile; attachments must be data: URLs. Nothing was fetched or ' +
      'changed.' },
  'save-autosave': {
    docs: ['recipes/20-content-actions-save.md', 'api/saves.md'],
    fix: 'saves.autosave(minutes) takes a positive number of minutes of play.' },
  'session-early': {
    docs: ['recipes/20-content-actions-save.md', 'api/engine.md'],
    fix: 'engine.session needs the new-game state that start() captures: call it from a button or after `await engine.start()`.' },
  'session-handle': {
    docs: ['api/engine.md'],
    fix: 'session.track(handle) takes something with remove(), such as the result of events.on / onFixed / clock.after.' },
  'clock-interval': {
    docs: ['recipes/06-clock-events.md', 'api/clock.md'],
    fix: 'clock.after / every take a finite number of game seconds (every needs > 0). For every fixed step use engine.onFixed.' },
  'threads-option': {
    docs: ['recipes/15-perf.md', 'api/engine.md'],
    fix: 'createEngine({ threads }) takes \'auto\', a worker count (0 = none) or false.' },
  'threads-transfer': {
    docs: ['recipes/15-perf.md', 'api/engine.md'],
    fix: 'The worker died after the task moved its buffers away (transfer), so the task cannot rerun on the main thread. Resend ' +
      'it, or send it without transfer.' },
  'pure-function': {
    docs: ['recipes/18-world.md', 'recipes/15-perf.md'],
    fix: 'A worker function sees only its parameters and worker-safe globals (Math, JSON, Number...): no closure variables, ' +
      'engine, window or document. Pass values in, or store them on the record.' },
  'asset-name-clash': {
    docs: ['recipes/05-props-bake.md', 'api/assets.md'],
    fix: 'One name was registered as two asset types (models / textures / sounds). Give each its own name, e.g. grass and ' +
      'grass_tex.' },
  'item-mesh': {
    docs: ['recipes/03-items-pickups.md', 'recipes/05-props-bake.md'],
    fix: 'An item\'s ground shape is a model name: register the file or generator in an asset pack (assets.manifest({ models })) and write ' +
      'model: \'name\' on the item, or name the model \'pickup:<item>\' / \'pickup\'.' },
  'audio-synth-gone': {
    docs: ['recipes/31-audio.md', 'api/audio.md'],
    fix: 'A synthesized sound is an asset: register the function in assets.manifest({ sounds: { ding: fn } }); audio.sounds entries only say ' +
      'how it plays (src: the sound name, volume, variants, bus).' },
  'audio-name-clash': {
    docs: ['recipes/31-audio.md', 'api/audio.md'],
    fix: 'One audio name is defined twice: a sound / footstep in both createEngine({ audio }) and a content pack, or a rule key that ' +
      'is both a condition and a measure. Keep each name in one place.' },
  'engine-disposed': {
    docs: ['api/engine.md'],
    fix: 'engine.dispose() ran while start() was still loading, so start() stopped. Create a new engine instead of starting a ' +
      'disposed one.' },
  'skip-amount': {
    docs: ['recipes/06-clock-events.md', 'api/engine.md'],
    fix: 'engine.skip takes { to: \'06:00\' } (needs the sky module) or { seconds: 600 } (game seconds, > 0).' },
  'stream-timeout': {
    docs: ['recipes/18-world.md', 'api/stream.md'],
    fix: 'The teleport destination did not finish loading in time (terrain, colliders, nearby models). Read describe().loading or ' +
      '`threedog loading`; raise { timeout } or check the place exists.' },
  'stream-removed': {
    docs: ['recipes/18-world.md', 'api/stream.md'],
    fix: 'A stream source was removed (remove(), its until, or engine.dispose) before it was ready, so its whenReady rejects. Await ' +
      'whenReady only on a source you keep.' },
  'stream-option': {
    docs: ['recipes/18-world.md', 'api/stream.md'],
    fix: 'stream.source(position, { detail }) takes \'full\' or \'simple\'.' },
  'op-misuse': {
    docs: ['recipes/23-ops.md', 'api/engine.md'],
    fix: 'Ops are defined with ops.define(name, { can, run }) and run with ops.run(name, args); args are plain data and can() only ' +
      'reads. The message says which rule was broken.' },
  'renamed-field': {
    docs: ['MIGRATING-0.3.md'],
    fix: 'A field of a result the engine returns was renamed in 0.3; the message names the new one (result .reason -> .code, runState.by -> .owners).' },
  'pause-owner': {
    docs: ['recipes/23-ops.md', 'api/engine.md'],
    fix: 'const p = engine.pause(owner); ... p.remove() ends that owner pause; the loop resumes only when every owner has removed theirs.' },
  'mod-owner': {
    docs: ['recipes/06-clock-events.md', 'api/engine.md'],
    fix: "engine.mod(name, { owner, set | add | mul | clamp, for?, clock?, id?, priority? }): owner is a non-empty string, exactly one of set / add / mul / clamp for a number; pause / freeze / takeCamera / debug.view name their owner the same way. Only that owner ends it, with the handle's remove()." },
  'views-define': {
    docs: ['recipes/46-blender-art-route.md', 'api/engine.md'],
    fix: "engine.views.define(name, { position: [x, y, z], target?: [x, y, z], fov? }): position and target are 3-number arrays." },
  'ops-guard': {
    docs: ['recipes/23-ops.md'],
    fix: 'Gameplay state (world, containers, vars, quests) was changed outside a fixed step and outside an op. Do it inside ' +
      'engine.ops.run(...) or an onFixed / module fixed hook.' },
  'quest-step': {
    docs: ['recipes/04-quests.md', 'api/quests.md'],
    fix: 'A saved quest step or part id no longer exists in the quest definition. Keep step ids stable (steps: [{ id, text, done ' +
      '}]) or add a migrate step to the quests save part.' },
  'save-write': {
    docs: ['recipes/20-content-actions-save.md', 'api/saves.md'],
    fix: 'The browser refused to store the save (storage full, private mode, blocked IndexedDB); the previous save is kept. Free ' +
      'space or export the save as a file.' },
  'save-bad-record': {
    docs: ['recipes/20-content-actions-save.md', 'api/saves.md'],
    fix: 'A core field of a saved record is malformed (a position that is not three finite numbers, a record without kind); the ' +
      'load was refused and rolled back. The save was edited by hand or damaged: fix the field the message names, or load another save.' },
  'save-value': {
    docs: ['recipes/20-content-actions-save.md', 'api/saves.md'],
    fix: 'A saved number was not finite or out of range (a negative clock, a count beyond any stack); it was clamped or dropped and the ' +
      'rest of the part loaded. The save was edited by hand or damaged; save again to write the fixed values.' },
  'save-stale': {
    docs: ['recipes/20-content-actions-save.md', 'api/saves.md'],
    fix: 'Another tab or window of this game saved into this slot after this one last loaded or saved it, so it was not overwritten ' +
      '(that would lose the newer progress). Load the slot to continue from it, save into another slot, or close the other tab.' },
  'budget-over': {
    docs: ['recipes/15-perf.md', 'api/budget.md'],
    fix: 'A performance budget set with createEngine({ budget }) was exceeded; the message names the biggest costs. Measure with ' +
      'describe().perf or npm run perf.' },
  'jobs-slow': {
    docs: ['recipes/15-perf.md', 'api/jobs.md'],
    fix: 'A job step ran too long or a job queued too many steps. Yield more often inside the generator (engine.jobs.add(function* ' +
      '() { ...; yield; })).' },
  'threads-crash': {
    docs: ['recipes/15-perf.md', 'api/engine.md'],
    fix: 'A worker failed or went silent past the lane timeout (the reason is printed with it); the lane now runs on the main thread with the same ' +
      'results, only slower. Fix the worker file or its imports; a lane whose tasks really take longer passes a bigger lane({ timeout }).' },
  'input-binding': {
    docs: ['api/input.md'],
    fix: 'An action was defined again with different keys; the later keys win. Define each action once, or change keys with ' +
      'input.rebind(action, keys).' },
  'asset-cache': {
    docs: ['recipes/05-props-bake.md', 'api/assets.md'],
    fix: 'The dev model cache could not be used, so code-generated models are built from code. Run the game through its vite ' +
      'config (threedog gameConfig); npm run bake once a model is final.' },
  'webgl-lost': {
    docs: ['api/engine.md'],
    fix: 'The browser dropped the WebGL context (GPU reset, too many tabs); gameplay waits until it is restored. Nothing to fix ' +
      'unless it repeats: then lower quality or texture sizes.' },
  'module-params': {
    docs: ['recipes/51-capability-catalog.md'],
    fix: 'A module option does not fit the module params schema (unknown key, wrong type, out of range or not one of the allowed values). ' +
      'The message names the option and what it should be; engine.catalog(name).params lists every option with its default.' },
  'module-dispose': {
    docs: ['recipes/14-custom-module.md'],
    fix: 'A module\'s dispose(e) threw; the other modules and core were still cleaned up. Fix that module\'s dispose.' },
  'module-order': {
    docs: ['recipes/14-custom-module.md', 'api/engine.md'],
    fix: 'A module\'s before / after contradicts the stage order (stages always run in order; before / after only order modules inside one ' +
      'stage). Give both modules the same stage, or remove the before / after.' },
  'module-critical': {
    docs: ['recipes/14-custom-module.md', 'api/engine.md'],
    fix: 'A module declared critical: true failed in init(), so start() stopped instead of starting a broken game. The message names the module ' +
      'and the reason: fix its init(), or drop critical if the game can run without it.' },
  'module-not-ready': {
    docs: ['recipes/14-custom-module.md', 'api/engine.md'],
    fix: 'start() waited longer than engine.loading.timeoutMs for modules whose isReady(e) stays false. Fix what that module waits for, ' +
      'or raise engine.loading.timeoutMs if the load is only slow. engine.loading.view().waiting names the current item.' },
  'step-seconds': {
    docs: ['api/engine.md'],
    fix: 'engine.step(seconds) takes a finite number >= 0 in game seconds: 0 advances nothing, 0.5 is half a second, 1 / 60 is one fixed step.' },
  'player-control': {
    docs: ['recipes/01-new-game.md', 'api/characters.md'],
    fix: "createPlayer() has no default feel: give control. Usually createPlayer({ ...presets.player.thirdPerson, spawn }); else control: 'camera' | " +
      "'none' | (player, input, dt) => ({ x, z }), plus runKeys / jumpKeys / cameraFollow as wanted." },
  'interaction-setup': {
    docs: ['recipes/02-npc.md', 'api/interactions.md'],
    fix: 'interactions() has no default pick or key: use interactions({ ...presets.interactions.nearest }) or interactions({ pick, keys: ' +
      "['KeyE'] }); keys may be left out only when createEngine({ bindings }) already binds the action." },
  'open-world-camera': {
    docs: ['recipes/21-camera.md', 'api/openWorld.md'],
    fix: "openWorld() installs no camera on its own: pass camera: 'follow' | 'firstPerson' | 'rts' | 'fixed' | a camera module | false." },
  'look-param': {
    docs: ['recipes/52-look.md'],
    fix: 'A look part was given a key it does not have, a value of the wrong type, or a spec without a default. engine.catalog("look.<part>").params lists every key, its default, why and how to turn it off.' },
  'look-verb': {
    docs: ['recipes/52-look.md'],
    fix: 'This look part does not support that verb (set / patch / replace), or the hook name is unknown. engine.catalog("look.<part>").verbs lists what it supports; the message names the verb to use instead.' },
  'engine-two-copies': {
    docs: ['THREE.md'],
    fix: "vite.config.js: resolve: { dedupe: ['threedog', 'three'] }. Two copies of threedog are loaded (the message names both paths); " +
      'each hooks THREE.Mesh.prototype for shadows, so keep one: `npm ls threedog`, and packs / tools list threedog as a peerDependency.' },
  'debug-override': {
    docs: ['recipes/41-thing-registry.md'],
    fix: "engine.debug.override(owner, target, patch): owner names who sets it (engine.debug.clear(owner) removes all of them), target is a thing id or Object3D, " +
      "patch is { visible?, material?: 'flat' | 'wire', apply? }. Overrides change only what the screen shows and are never saved." },
  'thing-id': {
    docs: ['recipes/41-thing-registry.md'],
    fix: "Ids given to engine.add(obj, { id }) are non-empty strings without '#', unique across engine.add objects and world records. " +
      'engine.thing(id) takes such an id, a world record id, an object name or an Object3D; the message suggests the closest id.' },
  'thing-owned': {
    docs: ['recipes/41-thing-registry.md', 'recipes/18-world.md'],
    fix: "Two systems manage one object: a world model is placed by world every frame. Change the record (ops.run('thing.set', { id, " +
      "position }), world.set / world.move) instead of the model, and never engine.add a model world built." },
  'thing-unsaved': {
    docs: ['recipes/41-thing-registry.md'],
    fix: 'An object you expect to keep cannot be saved: it has no stable id or was added during play. Give it an id at setup ' +
      "(engine.add(obj, { id })), or make it a template and create it inside an op with engine.content.spawn(name, at)." },
  'thing-orphan': {
    docs: ['recipes/41-thing-registry.md'],
    fix: "The 'scene' save part names an id no engine.add object has: the code that added it changed its id or no longer runs. " +
      'The data is kept in the save; restore the id, or ignore it if the object was deleted on purpose.' },
  'engine-misuse': {
    docs: ['api/engine.md'],
    fix: 'An engine call got an argument it cannot use; the message names the call and the accepted forms.' },
  'many-lights': {
    docs: ['recipes/09-style-pack.md', 'api/lightPool.md'],
    fix: 'More than 8 real-time lights are in the scene. Use engine.use(lightPool({ point: 8 })) and register torches / lamps with ' +
      'engine.lightPool.add(...) so a fixed small set of real lights follows the nearest sources.' },
  'light-recompile': {
    docs: ['recipes/09-style-pack.md', 'api/lightPool.md'],
    fix: 'The number of lights changed during play, so three.js compiled new shader programs (a long frame). Keep the light ' +
      'count fixed: engine.use(lightPool({ point: 8 })) before engine.start() and register torches / lamps with ' +
      'engine.lightPool.add(...), or create your own lights before start and fade them with intensity instead of adding, ' +
      'removing or hiding them.' },
  // ---- W4 (one failure shape): every engine throw carries a code. One code per kind of misuse per module; the message names the exact
  // call and the accepted values, the fix says where to look and what to change. Hint-table classes that matched engine messages moved here too
  // (the engine tags its own errors now; errorHints.js keeps patterns only for three.js / browser messages).
  'preset-option': {
    docs: ['api/openWorld.md', 'api/engine.md'],
    fix: 'An openWorld() / preset option has a wrong value or a part name it does not know. The message lists the accepted values; ' +
      'use one of them, or leave the key out for the default.' },
  'asset-misuse': {
    docs: ['api/assets.md', 'recipes/05-props-bake.md'],
    fix: 'An engine.assets call got a model it does not know or an object that is not an assets.model() copy. Register the model ' +
      '(manifest or assets.define) and pass its name, or the object assets.model() returned.' },
  'batching-option': {
    docs: ['recipes/15-perf.md'],
    fix: 'engine.batch / batching got an option it does not have. Use the options named in the message.' },
  'debug-view': {
    docs: ['recipes/16-dev-bridge.md', 'api/engine.md'],
    fix: 'engine.debug.defineView(name, { what, apply }): the name must be new (not a built-in view mode) and apply(scene) returns ' +
      'what to restore. Pick another name or fix the definition.' },
  'probes-option': {
    docs: ['recipes/34-environment-lighting.md', 'api/engine.md'],
    fix: 'engine.bakeProbes / loadProbes got a wrong option: bounds must be a Box3 or { min, max }, spacing a positive number of meters ' +
      '(raise it when the grid has too many probes), follow focus, camera, an Object3D, a function or false.' },
  'probes-data': {
    docs: ['recipes/34-environment-lighting.md', 'api/engine.md'],
    fix: 'engine.loadProbes(json) was given data that is not a probe file (or a damaged one), so nothing was added. Pass what ' +
      'handle.toJSON() returned, or bake again with engine.bakeProbes.' },
  'grid-data': {
    docs: ['recipes/29-grid.md', 'api/grids.md'],
    fix: 'sampleGrid / gridFromImage / decodePng got data it cannot read: wrong width * height, an unknown interp or channel, or a PNG ' +
      'kind it does not decode (interlaced, palette). Fix the numbers, or re-save the image as plain 8 / 16-bit gray or RGB.' },
  'ground-missing': {
    docs: ['api/ground.md'],
    fix: 'Nothing provides ground height at that spot: install terrain() or a level with a heightfield, or place the object at an ' +
      'explicit y instead of snapping it.' },
  'input-owner': {
    docs: ['api/input.md'],
    fix: 'input.push(name, { owner }) needs a non-empty owner string (who pushed the context), so pop / describe can tell owners apart.' },
  'style-value': {
    docs: ['recipes/09-style-pack.md', 'recipes/52-look.md'],
    fix: 'A style value is the wrong shape (toneMapping, exposure, a style part), or is world state put in a style. Use the form in the ' +
      'message; world state (map size, rules) goes in the game, not in the look.' },
  'owned-misuse': {
    docs: ['recipes/52-look.md', 'recipes/54-three-idioms.md'],
    fix: 'defineOwned / look.<part>.manual(key) was called wrongly: a module definition misses id / part / read / levels.manual, or ' +
      'manual() named a key the part does not write. Use a key listed in the message.' },
  'shadow-type': {
    docs: ['recipes/45-cascaded-shadows.md'],
    fix: 'Unknown shadow type: use one of the names listed in the message.' },
  'wrap-misuse': {
    docs: ['recipes/55-mods-time-wrap.md'],
    fix: 'engine.wrap(target, method, fn): target must be an object, fn a function, and method a public method that exists on it ' +
      '(the message lists them). Wrap a public method, not a private _one.' },
  'ambience-rule': {
    docs: ['api/ambience.md', 'api/audio.md'],
    fix: 'An ambience rule names no sound: give sound: a name registered in audio.sounds.' },
  'camera-option': {
    docs: ['recipes/21-camera.md', 'api/cameraRig.md'],
    fix: 'A camera option is wrong: projection is \'perspective\' or \'orthographic\' (orthographic needs size > 0 and engine.camera), ' +
      'ground / shots use the values the message lists.' },
  'character-option': {
    docs: ['api/characters.md', 'recipes/13-animation.md'],
    fix: 'A character / NPC option or model name is wrong. The message names the option and the accepted forms; an unknown model lists ' +
      'the registered ones.' },
  'collision-misuse': {
    docs: ['api/collision.md'],
    fix: 'A collision call got a wrong argument, e.g. collision.addBlocked needs fn(x, z) => boolean.' },
  'content-id': {
    docs: ['recipes/20-content-actions-save.md', 'api/content.md'],
    fix: 'A content id is invalid (contains # or /) or defined twice across content files, or a rename table is malformed. Ids are ' +
      'unique per kind across files; saves match on them, so rename through the rename table.' },
  'content-misuse': {
    docs: ['recipes/20-content-actions-save.md', 'api/content.md'],
    fix: 'content.load / content files hold something the loader cannot use (an unknown key, a rule needing a module that is not ' +
      'installed, a malformed field table). Install the module named in the message or fix the entry it points at.' },
  'content-pack': {
    docs: ['recipes/20-content-actions-save.md', 'api/content.md'],
    fix: 'A content pack is not a plain object, carries code where data is expected, or defines a key another pack already has. ' +
      'Give each pack its own ids.' },
  'content-template': {
    docs: ['recipes/30-templates.md', 'api/content.md'],
    fix: 'A content template definition or instance is invalid (missing model, an onUse without op, a key that is not a template ' +
      'field, a module it needs not installed). The message names the template and the field to fix.' },
  'inventory-misuse': {
    docs: ['recipes/03-items-pickups.md', 'api/inventory.md'],
    fix: 'An inventory call or option got a wrong value (an item id with #, pauseGame not boolean, a pickup radius not > 0). Use the ' +
      'form in the message.' },
  'grids-misuse': {
    docs: ['recipes/29-grid.md', 'api/grids.md'],
    fix: 'grids(): a grid or item name is unknown or defined twice. Define it once with grids.define / grids.item, and use a listed name.' },
  'level-node': {
    docs: ['recipes/10-blender-level.md', 'api/level.md'],
    fix: 'A level node points at content that is not defined, clashes with another record, or is used before the level loaded. Define ' +
      'the content id, or wait for level:loaded.' },
  'light-type': {
    docs: ['api/lightPool.md'],
    fix: 'lights / lightPool got a light type it does not pool. Use one of the listed types and reserve slots for it.' },
  'music-track': {
    docs: ['api/music.md'],
    fix: 'A music track is defined twice or has neither url nor stems. Define each track once with { url } or { stems }.' },
  'net-option': {
    docs: ['recipes/27-net.md', 'api/net.md'],
    fix: 'net() needs role \'host\' or \'client\' and a transport; reconnect() is for clients only.' },
  'rigid-misuse': {
    docs: ['recipes/11-vehicles.md', 'api/rigid.md'],
    fix: 'A rigid-body call got a wrong argument, e.g. a vehicle id already in use. Give each body / vehicle its own id.' },
  'settings-tab': {
    docs: ['api/settings.md'],
    fix: 'settings({ tabs }) names a built-in tab that does not exist. Use a listed built-in name, or define your own section.' },
  'clock-time': {
    docs: ['recipes/06-clock-events.md', 'api/calendar.md'],
    fix: "A clock time (?time= in the URL, calendar({ time }), sky({ time }), a schedule's at, calendar.at / between, skip({ to })) is 'HH:MM' such as '18:30' or a fraction of the day 0-1 such as 0.75; words like 'night' are not times." },
  'calendar-option': {
    docs: ['recipes/06-clock-events.md', 'api/calendar.md'],
    fix: 'A calendar option, season name or scenario season is wrong (day length not > 0, a season list entry without name / days, a season the ' +
      'calendar does not have). Day, time, seasons and hours per day are calendar({...}) options; sky({ time }) is only the fixed time drawn without a calendar.' },
  'sky-option': {
    docs: ['recipes/08-weather-sky.md', 'recipes/36-sky-ground-plant-looks.md', 'api/sky.md'],
    fix: 'A sky / fog / clouds / shadow option has a wrong value or is not an option (day length, days and seasons are calendar() options). Own GLSL goes through ' +
      'engine.look.<part>.patch(slot, glsl), not a style key. The message lists the accepted values.' },
  'terrain-option': {
    docs: ['recipes/28-terrain.md', 'recipes/42-terrain-shape.md', 'api/terrain.md'],
    fix: 'A terrain option or terrain edit is wrong (shape mask missing, a brush number not a number, an unknown paint). Use the form ' +
      'in the message.' },
  'vegetation-option': {
    docs: ['api/vegetation.md', 'recipes/36-sky-ground-plant-looks.md'],
    fix: 'A vegetation option is wrong: positions entries, densityMap form, fade range or a model with several materials. Fix the ' +
      'entry the message points at.' },
  'water-option': {
    docs: ['api/water.md', 'recipes/44-water-weather-look-hooks.md'],
    fix: 'A water option is wrong; own GLSL goes through look.water.patch(slot, glsl) and must define the function the message names.' },
  'weather-option': {
    docs: ['api/weather.md', 'recipes/44-water-weather-look-hooks.md'],
    fix: 'A weather type, field, pool or particle definition is wrong. The message lists the defined types and the accepted forms.' },
  'world-option': {
    docs: ['recipes/18-world.md', 'api/world.md'],
    fix: 'A world option is wrong (an anchor shape, a simulate channel that is not a time channel). Use the form in the message.' },
  'material-option': {
    docs: ['recipes/48-make-material.md', 'recipes/43-shader-patches-surface-looks.md'],
    fix: 'A material / surface / detail / lighting spec is wrong: an unknown type, texture slot or setting, or GLSL that does not define ' +
      'the function the slot expects. The message names the key and the accepted values.' },
  'post-effect': {
    docs: ['api/post.md', 'recipes/52-look.md'],
    fix: 'A post effect is malformed or clashes: it needs { name, create } or a fuse snippet, a unique name, a known slot. Change an ' +
      'existing effect with look.post.set, add a new one with look.post.add.' },
  'shader-patch': {
    docs: ['recipes/43-shader-patches-surface-looks.md'],
    fix: 'A shader patch is malformed: glsl goes with a slot name (a string per slot), raw anchors use vertex / fragment, and the ' +
      'material must provide what the patch needs. The message lists the slot names.' },
  'ui-misuse': {
    docs: ['recipes/26-ui-parts.md', 'api/hud.md'],
    fix: 'A UI part, theme or toast call is wrong (an unknown part or verb, a value of the wrong type, the engine not passed first). ' +
      'The message lists the defined parts and the accepted forms.' },
  'module-needs': {
    docs: ['recipes/14-custom-module.md', 'api/engine.md'],
    fix: 'A call needs a module that is not installed or not ready yet (e.g. pickups need interactions(), timeline say needs dialogue(), ' +
      'rigid bodies need engine.start() first). Install the module named in the message, or call after engine:ready.' },
  'load-failed': {
    docs: ['api/assets.md', 'recipes/05-props-bake.md'],
    fix: 'A file the engine loads on the side (a particle texture, a generated vegetation model, an ambience sound, a level) failed; ' +
      'the engine fell back (round dot, no model, silence). Check the path named in the message.' },
  'tween-property': {
    docs: ['api/timeline.md'],
    fix: 'A tween names a property path that does not exist or is not a number / color / vector. Check the path (a.b.c) against the object.' },
  'level-size': {
    docs: ['api/level.md'],
    fix: 'The level is larger than the heightfield resolution allows, so the cell was enlarged (coarser ground). Pass a larger ' +
      'cellSize on purpose, or split the level.' },
  'nav-build': {
    docs: ['recipes/12-navmesh.md', 'api/nav.md'],
    fix: 'The navmesh could not be built from this geometry; paths fall back. The message has the builder\'s reason (usually too few ' +
      'walkable triangles or wrong cell sizes).' },
  'grid-overlap': {
    docs: ['recipes/29-grid.md', 'api/grids.md'],
    fix: 'Two grid items claim the same cell; the second is skipped. Move one, or remove the other first.' },
  'grid-orphan': {
    docs: ['recipes/29-grid.md', 'api/grids.md'],
    fix: 'A placed record names an item the content no longer defines, so it has no size and takes no cells; the record is kept. Define the item again, or remove the record with grid.remove.' },
  // ---- classes that were patterns in errorHints.js: the engine raises these messages itself, now tagged with the code ----
  'module-requires': {
    docs: ['recipes/14-custom-module.md', 'api/engine.md'],
    fix: 'A module needs another module that is not installed yet, or is installed after it. Add the missing module, or put it earlier in engine.use(...) (a typo is suggested in the message).' },
  'module-cycle': {
    docs: ['recipes/14-custom-module.md'],
    fix: 'before / after constraints of two or more modules point at each other. Remove one of them or give a module a different stage.' },
  'module-stage': {
    docs: ['recipes/14-custom-module.md'],
    fix: 'Modules sort by stage (+ before / after), not by number. Use one of the listed stage names.' },
  'module-name': {
    docs: ['recipes/14-custom-module.md'],
    fix: 'The module name becomes engine.<name>; it must not be an existing engine property or another module name.' },
  'module-called': {
    docs: ['recipes/01-new-game.md', 'api/engine.md'],
    fix: 'engine.use() takes the module object: write engine.use(sky()), not engine.use(sky).' },
  'describe-name': {
    docs: ['recipes/16-dev-bridge.md', 'api/engine.md'],
    fix: 'describe.add names share one namespace with the standard fields and module names. Pick a unique name.' },
  'world-missing': {
    docs: ['recipes/18-world.md', 'api/world.md'],
    fix: 'The feature stores its data in engine.world, but the world() module is not installed or comes after it. engine.use(world(), ...) first; the openWorld() preset already includes it.' },
  'world-plain': {
    docs: ['recipes/18-world.md', 'api/world.md'],
    fix: 'A record holds a three.js object, function or class instance. World data must be JSON-like (it is saved and may go to a worker). Keep the model in world.present(), the logic in world.simulate().' },
  'pickup-prop-id': {
    docs: ['recipes/03-items-pickups.md', 'api/inventory.md'],
    fix: 'A pickup / prop id collides with other data. Use distinct ids; stable ids are what saves match on.' },
  'pickup-misuse': {
    docs: ['recipes/03-items-pickups.md', 'api/inventory.md'],
    fix: 'pickups.spawn() got a wrong value: give must be an item id (needs inventory()) or a function (e, { actor }) => result; radius a positive number.' },
  'world-id': {
    docs: ['recipes/18-world.md', 'api/world.md'],
    fix: 'Two records share one id. Omit id to auto-number, give each its own id, or use world.set(id, patch) to update an existing record.' },
  'world-record': {
    docs: ['recipes/18-world.md', 'api/world.md'],
    fix: 'The id was never added, was removed, or is misspelled. world.query({ kind }) lists what exists.' },
  'world-add': {
    docs: ['recipes/18-world.md', 'api/world.md'],
    fix: 'world.add({ kind, position, ... }) needs a kind; initial records need a stable id; id and kind of an existing record cannot be changed by set().' },
  'world-present': {
    docs: ['recipes/18-world.md', 'api/world.md'],
    fix: 'present(kind, { build }) must return a three.js object (or use show: rec => false to hide). Errors inside build also land here.' },
  'bad-position': {
    docs: ['CONVENTIONS.md', 'api/world.md'],
    fix: 'A position was NaN or the wrong shape: a Vector3 used like an array (v[0]), a missing field, or a division by zero upstream. Use [x, y, z], { x, z } or the Vector3 itself.' },
  'content-place': {
    docs: ['recipes/20-content-actions-save.md', 'api/content.md'],
    fix: 'content.load references a place that has no coordinates, or needs world() for props / pickups. Give the place in content.load({ places }) or add the marker to the level.' },
  'container': {
    docs: ['recipes/03-items-pickups.md', 'api/inventory.md'],
    fix: 'Container id / capacity / count was invalid, or a container used in transfer was never created. Create it first with inventory.container(id, { capacity }).' },
  'npc-behavior': {
    docs: ['recipes/02-npc.md', 'api/characters.md'],
    fix: 'The schedule / behavior name is unknown. Register it with engine.npcs.behavior(name, { near, far }) before npcs.add, or use a listed built-in.' },
  'unknown-option': {
    docs: ['api/engine.md', 'CONVENTIONS.md'],
    fix: 'An options key is misspelled or does not exist for this call (ignored, so the feature silently does nothing). Use the suggested key or one of the listed options.' },
  'unknown-name': {
    docs: ['CONVENTIONS.md', 'api/engine.md'],
    fix: 'A name (action, item, asset, weather, text key, ...) was never registered or has a typo. The message lists the registered names.' },
  'event-typo': {
    docs: ['api/events.md'],
    fix: 'The event name is probably a typo of an engine event (the engine emits no event you did not subscribe to under this name).' },
  'owned-prop': {
    docs: ['recipes/52-look.md', 'recipes/54-three-idioms.md'],
    fix: 'The engine wrote this value on its own (sky, camera, fog distance ...); your direct write took it over, so the engine no longer changes it. Intended: say so with the manual() call in the message. Not intended: give it back with manual(key, false) and adjust it with set(...).' },
  'camera-kind': {
    docs: ['recipes/21-camera.md', 'api/cameraRig.md'],
    fix: 'setCamera() got an unknown camera kind. Use one of the listed kinds; for a camera of your own, take it with engine.takeCamera(owner) and place engine.camera yourself (recipes/21-camera.md).' },
  'camera-none': {
    docs: ['recipes/21-camera.md', 'api/cameraRig.md'],
    fix: 'setCamera() switches between camera kinds once a camera module is installed. Install one first: engine.use(fixedCamera({ position, lookAt })) (or followCamera / firstPersonCamera / rtsCamera); openWorld installs followCamera.' },
  'movement': {
    docs: ['api/characters.md', 'api/engine.md'],
    fix: 'A movement parameter was zero, negative or not a number (a typo in a name gives undefined).' },
  'commit-fallback': {
    docs: ['api/jobs.md'],
    fix: 'Async results apply at fixed steps; the fallback is the deterministic main-thread computation used when the result is late.' },
  'asset-critical': {
    docs: ['recipes/05-props-bake.md', 'api/assets.md'],
    fix: 'An asset marked critical: true in the manifest (or an engine.loading.track step) failed, so start() stopped instead of starting a broken game. The line names the file, HTTP status and manifest. Fix the path or the file; if the game can run without it, drop critical so it falls back. engine.loading.list({ phase: "failed" }) or threedog loading shows every failure.' },
  'asset-missing-ref': {
    docs: ['recipes/05-props-bake.md', 'api/assets.md'],
    fix: 'The model file loaded, but a file it references (texture image or .bin) is missing, usually after moving the .gltf without its folder or a case mismatch in the referenced name. Export as .glb (everything in one file) or copy the referenced files next to it.' },
  'asset-not-loaded': {
    docs: ['api/assets.md', 'recipes/05-props-bake.md'],
    fix: 'assets.modelNow only hands out a model something already loaded; it never starts a load. A code-built model loads too (built, or read from the bake cache). Write `modelNow(name) ?? await model(name)`, or mark it preload: true and await assets.preload() before the code that must not wait.' },
  'asset-load': {
    docs: ['api/assets.md', 'recipes/05-props-bake.md'],
    fix: 'The file was not found (404) or is not valid. Check the path (files under public/ are served from /), the extension, and the case of the name. A registered file that is not critical now shows its fallback; engine.loading.get(name) has the details.' },
  'audio-unsupported': {
    docs: ['api/audio.md'],
    fix: 'No AudioContext in this browser / test environment. Guard calls with typeof AudioContext, or skip audio in headless tests.' },
  'indexeddb': {
    docs: ['api/saves.md', 'recipes/20-content-actions-save.md'],
    fix: 'Saves use IndexedDB, which is blocked in private windows and some embedded browsers. Test in a normal window, or export / import the save as a file.' },
  'gameplay-frozen': {
    docs: ['recipes/16-dev-bridge.md', 'recipes/14-custom-module.md'],
    fix: 'In dev / tests a gameplay error freezes the game on purpose, so half-applied state is not mistaken for normal. Read the error printed with it (engine.error has where + message), fix it, reload.' },
  'canvas-released': {
    docs: ['api/engine.md'],
    fix: 'engine.dispose() gave the WebGL context back to the browser, so that canvas cannot draw again. Create the new engine on a new canvas, or dispose the old one with engine.dispose({ keepContext: true }).' },
  'dispose-options': {
    docs: ['api/engine.md'],
    fix: 'engine.dispose() takes nothing or { keepContext: true }.' },
  'module-disabled': {
    docs: ['recipes/14-custom-module.md'],
    fix: 'A presentation-only module (particles, ambience, music...) threw and was switched off; the game keeps running without it. The error printed with it is the real cause.' },
};

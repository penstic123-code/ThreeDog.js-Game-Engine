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
  'pause-owner': {
    docs: ['recipes/23-ops.md', 'api/engine.md'],
    fix: 'engine.pause(owner) and engine.resume(owner) must use the same owner name; the loop resumes only when every owner has resumed.' },
  'claim-owner': {
    docs: ['api/engine.md'],
    fix: 'pause / freeze / takeCamera / debug.view name who holds them with a non-empty owner string; only that owner releases it (resume, unfreeze, handle.remove()).' },
  'views-define': {
    docs: ['recipes/46-blender-art-route.md', 'api/engine.md'],
    fix: "engine.views.define(name, { position: [x, y, z], target?: [x, y, z], fov? }): position and target are 3-number arrays." },
  'renamed-api': {
    docs: ['recipes/52-look.md'],
    fix: 'The call was renamed in 0.2 and the old name now throws; the message names the new call. The table is in recipes/52-look.md "Renamed in 0.2".' },
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
    fix: 'A worker failed (the error is printed with it); the lane now runs on the main thread with the same results, only slower. ' +
      'Fix the worker file or its imports.' },
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
      "(engine.add(obj, { id })), or make it a template and create it inside an op with engine.spawn(name, at)." },
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
};

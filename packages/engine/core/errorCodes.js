// Stable error codes: errors the engine raises by name end their message with "[code]" and carry err.code / err.fix / err.docs (codedError in errorHints.js).
// Plain data with no imports (node tools load it through threedog/error-hints). A code never changes meaning once shipped: tools and tests match on it.

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
  'engine-disposed': {
    docs: ['api/engine.md'],
    fix: 'engine.dispose() ran while start() was still loading, so start() stopped. Create a new engine instead of starting a ' +
      'disposed one.' },
  'skip-amount': {
    docs: ['recipes/06-clock-events.md', 'api/engine.md'],
    fix: 'engine.skip takes { to: \'06:00\' } (needs the sky module) or { seconds: 600 } (game seconds, > 0).' },
  'load-timeout': {
    docs: ['recipes/18-world.md', 'api/load.md'],
    fix: 'The teleport destination did not finish loading in time (terrain, colliders, nearby models). Read describe().loading or ' +
      '`threedog loading`; raise { timeout } or check the place exists.' },
  'load-removed': {
    docs: ['recipes/18-world.md', 'api/load.md'],
    fix: 'A load source was removed (remove(), its until, or engine.dispose) before it was ready, so its whenReady rejects. Await ' +
      'whenReady only on a source you keep.' },
  'load-option': {
    docs: ['recipes/18-world.md', 'api/load.md'],
    fix: 'load.source(position, { detail }) takes \'full\' or \'simple\'.' },
  'op-misuse': {
    docs: ['recipes/23-ops.md', 'api/engine.md'],
    fix: 'Ops are defined with ops.define(name, { can, run }) and run with ops.run(name, args); args are plain data and can() only ' +
      'reads. The message says which rule was broken.' },
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
  'module-dispose': {
    docs: ['recipes/14-custom-module.md'],
    fix: 'A module\'s dispose(e) threw; the other modules and core were still cleaned up. Fix that module\'s dispose.' },
  'engine-misuse': {
    docs: ['api/engine.md'],
    fix: 'An engine call got an argument it cannot use; the message names the call and the accepted forms.' },
};

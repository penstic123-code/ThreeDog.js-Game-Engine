// Headless loading after start: a headless engine (?threedog-headless, createEngine({ headless: true })) has no real-time loop, so after start()
// nothing runs frames unless someone calls step(). Anything that makes the world load again after start (a species added with
// vegetation.define, terrain.setDensity, a teleport, a level swap) queued its work and waited for frames that never came: the page sat on
// "waiting for module terrain" forever, while the same page in a live browser loaded within a second.
//
// Why a load pump and not "step more" in the tools: step() is synchronous, and chunk results come back from workers between tasks, so no
// number of steps inside one call can finish a load. Only frames spread over real time can, which is what a live loop gives. So while the
// world is not settled, the headless engine runs the same loading frame start() runs (frame hooks, stream, jobs; game time does not move:
// dt 0, jobs drain deterministically), on a timer. A settled world runs nothing, so step()-driven tests keep their exact frame count.
//
// stateApplied waits for it too (Engine.js): screenshots, npm test and the dev bridge wait on stateApplied, so a load that began after
// start is finished before they capture. A load that never settles stops holding stateApplied after engine.loading.timeoutMs (same limit
// as start()) with one warning naming who is still waiting, so a stuck module cannot hang a tool.
import { DEV, warnOnce } from './validate.js';
import { coded } from './errorHints.js';

const TICK_MS = 16;   // one loading frame per ~60 Hz tick: the same pace a live loop gives the workers

/** Modules whose isReady(e) is false, plus the stream when its required nearby builds are not done ([] = settled) */
export function unsettled(e) {
  const who = [];
  for (const m of e.modules.values()) if (m.isReady && !m.isReady(e)) who.push(m.name);
  if (!e.stream.ready) who.push('the stream (required nearby builds)');
  return who;
}

/** @internal start(): begin pumping loading frames for a headless engine (no-op for a live one, its loop already runs frames) */
export function startHeadlessLoad(e) {
  if (!e.headless || e._headlessLoad) return;
  const s = e._headlessLoad = { since: -1, stalled: false, timer: 0 };
  const tick = () => {
    if (e.disposed) return;
    if (!unsettled(e).length) { s.since = -1; s.stalled = false; }
    else {
      const now = performance.now();   // measure: wall clock, only to stop a stuck load from holding stateApplied forever
      if (s.since < 0) s.since = now;
      // the same loading frame start() runs while it waits (startup.js _waitReady): frame hooks, stream, jobs; game time stays put
      // (no input.endFrame: a key a test pressed before its next step() must still read as just pressed there)
      e._frameHooks(0, true);
      if (!s.stalled && now - s.since > e.loading.timeoutMs) {
        s.stalled = true;
        const who = unsettled(e);
        if (DEV && who.length) warnOnce(coded('module-not-ready', `headless load after start stalled: still waiting after ${Math.round(e.loading.timeoutMs / 1000)} s for: ${who.join(', ')}; stateApplied no longer waits for it. A module's isReady(e) keeps returning false; fix that module, or raise engine.loading.timeoutMs if the load is just slow`));
      }
    }
    s.timer = setTimeout(tick, TICK_MS);   // main-loop: a headless engine's stand-in for the live frame loop while something is loading
  };
  tick();
}

/** @internal stateApplied: true when the world is settled (or its post-start load gave up after timeoutMs); always true for a live engine */
export function headlessSettled(e) {
  const s = e._headlessLoad;
  return !s || s.stalled || !unsettled(e).length;
}

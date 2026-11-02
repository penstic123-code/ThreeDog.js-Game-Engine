// UI timers on the page clock.
// How long a toast stays: one rule, it runs on whatever drives the page. A page the browser runs (the game) counts wall-clock
// time, so a message still goes away while gameplay is paused (a pause menu stops the frame loop, not the clock). A headless tool page
// (?threedog-headless) is driven by engine.step: its "now" is the stepped time, so `threedog step 60` then `snap` shows the messages of the last
// seconds only. Before, a headless page kept wall-clock timers too and a step of 60 game seconds took a few real seconds, so eight toasts from
// the step covered the shot (farm R4). CSS fades are not timers: they always run on the browser's clock.
// How: the headless timers advance in _frameHooks (core/loop.js), which runs for every frame step() makes and for a resumed headless loop.

/**
 * Call fn after ms of the page's own time (wall clock in the game, stepped time on a headless page)
 * @param {any} e the engine @param {number} ms @param {() => void} fn
 */
export function uiAfter(e, ms, fn) {
  if (!e.headless) { setTimeout(fn, ms); return; }   // wall-clock: the browser drives this page
  (e._uiTimers ??= []).push({ left: ms / 1000, fn });
}

/** Advance the headless UI timers by dt seconds (core/loop.js _frameHooks) @param {any} e @param {number} dt */
export function advanceUiClock(e, dt) {
  const T = e._uiTimers;
  if (!T?.length || !(dt > 0)) return;
  const due = [];
  for (let i = T.length - 1; i >= 0; i--) if ((T[i].left -= dt) <= 0) due.push(T.splice(i, 1)[0]);
  for (let i = due.length - 1; i >= 0; i--) due[i].fn();   // in the order they were set
}

// R4 real time and randomness in game logic: setTimeout / setInterval / performance.now / Date.now / Math.random
//   in packages/engine/core or packages/engine/modules → error.
// Why: real time ignores pause, freeze and engine.step fast-forward, so it cannot be tested or saved; Math.random makes step/test results non-reproducible.
// Fix: for timing use the hook's dt or engine.clock (after / every); for gameplay randomness use the seeded engine.random (core/Random.js: next / range / int / pick / chance, saved with the game).
//
// Allowlist convention (written in the code, not here): a usage tag in a comment at the end of the line, or on the whole line above, lets it through:
//   // presentation   only affects visuals/sound, not gameplay (toast fade-out, loading-screen fade, music crossfade, ambient pitch jitter, particle jitter)
//   // measure   only measures elapsed time (profile, startup timing), or spreads presentation work over frames (building models, uploading meshes).
//            "measure" is not accepted inside a fixed step (fixed / _fixedStep methods, onFixed callbacks): truncating by real milliseconds there makes gameplay results depend on machine speed; use a per-count limit instead
//   // debug   dev tools
//   // wall-clock   records a real-world timestamp (save time, autosave by real minutes)
//   // main-loop   the main loop converts real time to game time (tick in core/loop.js), and waits that yield to the browser while loading / setting up a scenario (startup.js, UrlState.js)
// A tag may be followed by an explanation, e.g. // presentation: bird-call pitch jitter.
// Example: src.playbackRate.value = 0.5 + Math.random() * 0.5;   // presentation
import { engineFiles, lines, codeOnly, lineTag, reE } from './_lib.mjs';

export const TAGS = ['presentation', 'measure', 'debug', 'wall-clock', 'main-loop'];
// Whole file exempt: [path regex, reason]
const ALLOW_FILES = [
  [reE('modules\\/debug\\/'), 'the debug panel is a dev tool'],
];
const BAD = /\b(setTimeout|setInterval|performance\.now|Date\.now|Math\.random)\b/g;
// Gameplay or presentation? If the result affects anything in a save, events, quest/weather state → gameplay (use engine.random / game time);
// if it only changes this frame's visuals or sound and the player cannot tell a different value from the right one → presentation (add a tag).
const FIX = {
  setTimeout: 'use engine.clock.after(seconds, fn) (game time) or accumulate dt in a fixed hook',
  setInterval: 'use engine.clock.every(seconds, fn) or accumulate dt in a fixed hook',
  'performance.now': 'game logic uses the hook dt / engine.clock.now; if it only measures elapsed time, add // measure at the end of the line',
  'Date.now': 'game logic uses engine.clock.now; if it records a real-world timestamp, add // wall-clock at the end of the line',
  'Math.random': 'gameplay randomness uses engine.random (seeded, reproducible in step/tests, saved with the game); pure presentation (pitch, particle jitter) gets // presentation at the end of the line',
};

// Start of a fixed-step function body: method fixed(…) { / _fixedStep() { , or an onFixed(… => { callback (the end is found by indentation, no syntax analysis needed)
const FIXED_START = /^(\s*)(?:(?:fixed|_fixedStep)\s*\([^)]*\)\s*\{|.*\bonFixed\(.*=>\s*\{)\s*$/;
const FIX_FIXED = 'a gameplay-deciding branch in a fixed step must not look at real time: limit by count / steps instead (e.g. world.farMaxPerTick) so the result is independent of machine speed';

export default {
  id: 'R4', title: 'Real time and randomness in game logic',
  run() {
    const out = [];
    for (const f of engineFiles().filter(f => reE('(core|modules)\\/').test(f))) {
      if (ALLOW_FILES.some(([r]) => r.test(f))) continue;
      let fixedEnd = null;   // inside a fixed-step body = its indentation (ends at a } with the same indentation)
      lines(f).forEach((raw, i) => {
        if (fixedEnd === null) { const m = FIXED_START.exec(raw); if (m) fixedEnd = m[1]; }
        else if (raw.startsWith(fixedEnd + '}')) fixedEnd = null;
        if (/^\s*(\/\/|\*|\/\*)/.test(raw)) return;
        const hits = [...new Set([...codeOnly(raw).matchAll(BAD)].map(m => m[1]))];
        if (!hits.length) return;
        const tag = lineTag(f, i + 1, TAGS);
        if (tag && !(tag === 'measure' && fixedEnd !== null)) return;
        out.push({ level: 'error', file: f, line: i + 1, msg: `${tag ? 'a fixed step allows real time through "measure"' : 'uses real time/randomness'}: ${hits.join(', ')}  ${raw.trim().slice(0, 80)}`,
          fix: tag ? FIX_FIXED : hits.map(h => FIX[h]).join('; ') });
      });
    }
    return out;
  },
};

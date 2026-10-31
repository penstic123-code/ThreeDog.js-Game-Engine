// Detection: R28 no catch that only logs. A catch block (or .catch handler) whose whole body is one console.error / console.warn call hides a gameplay
// failure in dev: the game runs on half-updated and tests pass. Engine code reports through reportError (errors.js: frozen with engine.error in dev,
// once in release), warnOnce, or handles the failure (returns false, retries, falls back) and says so.
// Flags: `catch (x) { console.error(...); }` and `.catch(x => console.error(...))` (also console.warn) in packages/engine/{core,modules,render,ui}.
// Level: error in core (fixed there), warn elsewhere (modules still have some; fix them, then raise to error).
// Known limits: one-line forms only (a multi-line catch whose only statement is a console call is not seen).
import { engineFiles, lines, P } from './_lib.mjs';

// [file under packages/engine, reason]
const ALLOW = [
  ['core/Events.js', 'fallback when the bus has no onError (an Events built without an engine); the engine always passes reportListenerError'],
  ['core/lifecycle.js', 'dispose: the engine is being torn down, so freezing or engine.error would mean nothing; the message carries code module-dispose'],
  ['core/threadServe.js', 'worker side: a broadcast (no reply id) has nobody to answer, so the worker console is the only place'],
];
const RE = /catch\s*(?:\([^)]*\))?\s*\{\s*console\.(?:error|warn)\([^;{}]*\);?\s*\}|\.catch\(\s*\(?\w*\)?\s*=>\s*console\.(?:error|warn)\(/;

export default {
  id: 'R28', title: 'No catch that only logs (report through reportError / warnOnce, or handle it)',
  run() {
    const out = [];
    for (const f of engineFiles()) {
      const base = f.slice(P.ENGINE_REL.length + 1);
      if (ALLOW.some(([file]) => file === base)) continue;
      const core = base.startsWith('core/');
      lines(f).forEach((l, i) => {
        if (!RE.test(l)) return;
        out.push({ level: core ? 'error' : 'warn', file: f, line: i + 1, msg: 'a catch whose only job is console.error / console.warn',
          fix: 'gameplay failure: reportError(engine, err, where); a warning said once: warnOnce(coded(code, text)); or handle it (return false, fall back) and comment why' });
      });
    }
    return out;
  },
};

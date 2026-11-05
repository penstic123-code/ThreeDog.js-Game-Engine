// Error tiers.
// What to do when a module hook, onFixed / onFrame / clock callback or event listener throws (the main loop and the event bus both come here).
//   picture and ui modules (the module's type says it: particles, sky, music, a HUD, a menu...): disable the module (its hooks are no longer called),
//     log once to the console, emit module:disabled; the game carries on -- a missing picture, sound or panel does not change game state.
//   Gameplay (all other modules, the game's own callbacks and event listeners): in dev and tests (DEV) fail hard -- freeze gameplay (freeze('error')),
//     engine.error records where and why, emits engine:error, and describe() / describeText() show it on the first line;
//     so a half-deducted inventory or half-updated quest does not keep running, and a test does not mistake it for normal. A release build reports once and keeps running (so the player is not stuck for the whole session).
//   soft (core steps such as rendering and stream.update): report once per site and continue.
// engine.error is machine-readable: { where, message, code, fix, docs } (code / fix / docs come from the error itself or from the hint table, errorHints.js).
import { DEV } from './validate.js';
import { errorInfo, hintText } from './errorHints.js';

const STRINGS = { once: '[engine] {key} threw (later errors at the same place are not reported again)', disabled: '[engine] {type} module {name} threw and was disabled (the game continues) [module-disabled]', halted: '[engine] {key} threw and gameplay is frozen (in dev / tests a gameplay error fails hard; see engine.error for details) [gameplay-frozen]', listener: 'listener of event {name}',
  rejected: '[engine] a promise rejected and nothing caught it (e.g. audio.play() of a missing file, an async callback that threw); reported once, the game continues. Add .catch or await it in try. ' };

/** picture / ui modules only show the game, so an error in one switches it off instead of freezing gameplay (the type is the one source; no extra flag) */
const failsSoft = m => m?.type === 'picture' || m?.type === 'ui';

/** Handle an error. key: where it happened (for display); module: the module definition that threw (none means a game callback / event listener, counted as gameplay); soft: report only once */
export function reportError(engine, err, key, { module = null, soft = false } = {}) {
  if (failsSoft(module)) return disableModule(engine, module, err);
  if (!soft && DEV && !engine.error) {
    const message = String(err?.message ?? err);
    // code + fix + docs: what to do and which page to read; at: the line that threw (the message alone often does not say which callback line)
    engine.error = { where: key, message, ...errorInfo(err), at: firstFrame(err) };
    engine.freeze('error');
    console.error(STRINGS.halted.replace('{key}', key) + hintText(err?.code ? `[${err.code}]` : message), err);
    engine.events.emit('engine:error', engine.error);
    return;
  }
  if (engine._hookErrors.has(key)) return;
  engine._hookErrors.add(key);
  console.error(STRINGS.once.replace('{key}', key), err);
}

/** First stack frame of an error: V8 "at fn (file:line:col)", Firefox / Safari "fn@file:line:col"; null without a stack */
const firstFrame = err => String(err?.stack ?? '').split('\n').map(l => l.trim()).find(l => l.startsWith('at ') || /@\S+:\d+/.test(l)) ?? null;

/**
 * Dev / tests: a rejection nobody caught is reported once as a soft error (console + describe().unhandled { message, code, fix, docs, count }); it never freezes,
 * since an uncaught promise is usually presentation (a sound, a fetch). Without this it was only a red line in the console that tools and AIs never saw.
 */
export function watchRejections(engine) {
  if (!DEV || typeof addEventListener !== 'function') return;
  addEventListener('unhandledrejection', ev => {
    if (engine._unhandled) { engine._unhandled.count++; return; }
    const err = ev.reason;
    engine._unhandled = { message: String(err?.message ?? err), ...errorInfo(err), count: 1 };
    console.error(STRINGS.rejected + hintText(err?.code ? `[${err.code}]` : engine._unhandled.message), err);
  }, { signal: engine.signal });
}

/** An event listener threw (called by the event bus): counted as gameplay */
export function reportListenerError(engine, name, err) { reportError(engine, err, STRINGS.listener.replace('{name}', name)); }

/** Disable a picture / ui module: remove its fixed / frame / afterRender hooks */
function disableModule(engine, m, err) {
  if (engine.disabledModules.has(m.name)) return;
  engine.disabledModules.add(m.name);
  for (const k in engine._hooks) engine._hooks[k] = engine._hooks[k].filter(h => h.name !== m.name);
  console.error(STRINGS.disabled.replace('{type}', m.type).replace('{name}', m.name), err);
  engine.events.emit('module:disabled', { name: m.name, message: String(err?.message ?? err) });
}

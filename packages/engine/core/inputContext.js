import { codedError } from './errorHints.js';
// Input contexts. Like Unity Action Maps: a stack of named groups of actions. The top context shadows lower ones that bind the same key;
// an opaque context (the default) blocks everything below it, a `pass` context lets unrelated actions through. Menus, dialogue, cutscenes and
// full-screen UI push an opaque context instead of "locking input", so there is one mechanism, not two.
// Changes take effect at the start of the next fixed step (before the input snapshot), so a key pressed in step N never acts in both the old and the new context.

/** The base context: walking around (the common names: walk, vehicle, dialog, menu, cutscene; a game may add its own) */
export const BASE_CONTEXT = 'walk';

/** @internal */
export function initContexts(input) {
  input._stack = [{ name: BASE_CONTEXT, pass: true }];
  input._pendingCtx = [];
  input._readable = null;   // action -> readable? Rebuilt lazily after a switch / define / rebind
  input._muted = new Set(); // keys cleared by a switch: ignored until physically released (keyboard auto-repeat must not revive them)
}

/** @internal */
export function pushContext(input, name, { pass = false, owner = name } = {}) {
  // owner: who pushed it (describe().holds.input, runState.blockedBy), so "why can't I move" names a system, not only a context
  if (typeof owner !== 'string' || !owner) throw codedError('input-owner', `input.push('${name}', { owner }): owner must be a non-empty string, e.g. input.push('${name}', { owner: 'shop-menu' })`, TypeError);
  const entry = { name, pass, owner };
  let gone = false;
  input._pendingCtx.push({ add: entry });
  return {
    name,
    /** Pop this context (safe to call twice) */
    remove() { if (!gone) { gone = true; input._pendingCtx.push({ del: entry }); } },
  };
}

/** Which actions can currently be read: walk the stack from the top down to the action's own context @internal */
export function readableMap(input) {
  if (input._readable) return input._readable;
  const keysOf = new Map();
  for (const [n, a] of input.actions) { const c = a.context || BASE_CONTEXT; let s = keysOf.get(c); if (!s) keysOf.set(c, s = new Set()); for (const k of input.keysOf(n)) s.add(k); }
  const m = new Map(), stack = input._stack;
  for (const [name, a] of input.actions) {
    const ctx = a.context || BASE_CONTEXT;
    let ok = false;
    for (let i = stack.length - 1; i >= 0; i--) {
      const c = stack[i];
      if (c.name === ctx) { ok = true; break; }
      if (!c.pass) break;
      const shadow = keysOf.get(c.name);
      if (shadow && input.keysOf(name).some(k => shadow.has(k))) break;
    }
    m.set(name, ok);
  }
  return input._readable = m;
}

/** Queued pushes and removes played onto a stack @internal */
function playQueue(q, stack) {
  for (const op of q) {
    if (op.add) stack.push(op.add);
    else { const i = stack.indexOf(op.del); if (i > 0) stack.splice(i, 1); }
  }
  return stack;
}

/** The stack as the next fixed step will leave it: what reports read, because a halted page may wait long for that step @internal */
export function settledStack(input) { return playQueue(input._pendingCtx, input._stack.slice()); }

/** Apply queued push/remove at the start of a fixed step; held keys of newly blocked actions are cleared (a key stays dead until released) @internal */
export function applyContexts(input) {
  const q = input._pendingCtx;
  if (!q.length) return;
  const before = readableMap(input);
  playQueue(q, input._stack);
  q.length = 0;
  input._readable = null;
  const after = readableMap(input);
  for (const [name, was] of before) {
    if (!was || after.get(name)) continue;
    for (const k of input.keysOf(name)) {
      if (!input.keys.has(k)) continue;   // even if another action on this key becomes readable: it needs a fresh press (F that boards must not also exit)
      input.keys.delete(k); input._accP.delete(k); input._accR.delete(k); input._muted.add(k);
    }
  }
  input.engine.events.emit('input:context', { stack: input._stack.map(c => c.name) });
}

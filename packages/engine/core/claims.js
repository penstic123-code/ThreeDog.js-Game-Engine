// claims(): one small "who holds this" primitive shared by pause, freeze, the camera takeover and debug views.
// Why one primitive: those four each grew their own owner rules (pause warned, freeze was silent, the camera had no owner at all, a debug view checked
// its owner only on 'off'), so a tool could not predict what release by a non-owner does. Here the rules are the same everywhere:
//   - take(owner, data) -> { owner, remove() }: the same owner taking again updates its data, keeps its place and time (one claim per owner)
//   - only the owner releases: release(owner) / handle.remove() drop that owner's claim and nothing else; a stale handle (the owner released and took
//     again since) removes nothing, so an old handle cannot cancel a newer claim
//   - owners() -> [{ owner, at }] is what describe shows, the same shape for every user
// Look layers, the input stack and sky.modify keep their own owner models on purpose (layered values, a stack, blended layers): different semantics.
import { codedError } from './errorHints.js';

/**
 * @param {{ what: string, now?: () => number, onChange?: () => void }} o what names the user in error messages; now gives `at`; onChange runs after any take / release
 */
export function claims({ what, now = () => 0, onChange = () => {} }) {
  /** @type {Map<string, { owner: string, at: number, data: any }>} */
  const held = new Map();
  const drop = (owner, c) => { if (c && held.get(owner) !== c) return false; if (!held.delete(owner)) return false; onChange(); return true; };
  return {
    /** @param {string} owner @param {any} [data] */
    take(owner, data) {
      if (!owner || typeof owner !== 'string') throw codedError('claim-owner', `${what}: owner is a non-empty string naming who holds it, e.g. 'my-menu', got ${JSON.stringify(owner)}`);
      let c = held.get(owner);
      if (c) c.data = data; else held.set(owner, c = { owner, at: now(), data });
      onChange();
      return { owner, remove: () => { drop(owner, c); } };
    },
    /** Drop owner's claim; false when it held none @param {string} owner */
    release(owner) { return drop(owner); },
    /** @param {string} owner */
    has(owner) { return held.has(owner); },
    get size() { return held.size; },
    /** Owner names in take order */
    names() { return [...held.keys()]; },
    /** @returns {{ owner: string, at: number }[]} */
    owners() { return [...held.values()].map(({ owner, at }) => ({ owner, at })); },
    /** The claim taken last (the one in charge where only one can act: the camera), or null */
    top() { let t = null; for (const c of held.values()) t = c; return t; },
    /** Claims whose data matches pred (pause kinds) @param {(data: any) => boolean} pred */
    some(pred) { for (const c of held.values()) if (pred(c.data)) return true; return false; },
    clear() { if (!held.size) return; held.clear(); onChange(); },
  };
}

/**
 * pause('x') and pause({ owner: 'x' }) both work: look parts pass { owner }, the loop kept a positional owner; both spellings are accepted everywhere
 * @param {string | { owner?: string } | undefined} a @param {any} [b] @returns {{ owner: string, opts: any }}
 */
export function ownerArgs(a, b, fallback = 'game') {
  if (a && typeof a === 'object') return { owner: a.owner ?? fallback, opts: a };
  return { owner: a ?? fallback, opts: b ?? {} };
}

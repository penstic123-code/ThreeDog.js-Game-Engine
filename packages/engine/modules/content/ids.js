// Stable ids of authored entries (one place for the rules; recipes/30-templates.md "Ids"):
//   written id                     as written (`chest-home`); may not contain `#` or `/` (runtime and level-node ids use them, so they never collide)
//   keyed content (npcs, containers)  the key
//   stateless prop without id      `prop:<model>:<index>`, a template prop without id `<template>:<index>` (pure decoration only)
//   level-model node               `<level>/<node>` (level module)
// An entry with state (pickups, grid items, templates with state / container / interact / body) needs a written id: an index id shifts when an entry
// is inserted above it, and the save then puts its changes on the wrong entry. Dev warns once per load, naming the entries and the id to write.
// Two entries with the same id in one load are an error with the fix. Source lines ("defined in content/props.js:14") come from the dev-only
// line tables of packages/tools/vite/vite-threedog-content-src.js (srcOf); a release build has none.
import { DEV, warnOnce } from '../../core/validate.js';

const STRINGS = {
  badId: 'content: id "{id}" ({what}) may not contain "#" or "/": "#" is for records made during play and "/" for level-model nodes. Write it with - _ . or :, e.g. "{fix}"',
  dup: 'content: id "{id}" is used twice: by {a} and by {b}. Ids name an entry in saves, so each must be unique: rename one, e.g. "{id}-2"',
  noId: 'content: {n} entr(y/ies) with state have no id, so saves match them by array index and an inserted entry shifts them: {list}. '
    + 'Write the id they have now (e.g. id: \'{first}\') to keep old saves working, or a readable one',
};
const fmt = (s, p) => s.replace(/\{(\w+)\}/g, (m, k) => p[k] ?? m);

/** The dev line table the vite plugin attached to a content value (null in release or for data built in code) */
const tableOf = v => (DEV && v && typeof v === 'object' && globalThis.__threedogSrc?.get(v)) || null;

/**
 * Where content entry `key` (array index or object key) of `container` was written: 'content/props.js:14', or null.
 * @param {any} container  the array / object a content file exports (props, pickups, npcs, templates...)
 * @param {string | number} key
 * @returns {string | null}
 * @internal
 */
export function srcOf(container, key) {
  const t = tableOf(container);
  return t ? `${t.file}:${t.at[key] ?? t.line}` : null;
}

/** Per content.load: catches duplicate ids across props, pickups, NPCs, containers and grid items, and collects stateful entries without an id @internal */
export class IdCheck {
  constructor() { this.seen = new Map(); this.missing = []; }
  /** An authored id: format check, and an error if this load already used it @param {string} id @param {string} what e.g. "props[3] (template chest)" */
  claim(id, what) {
    if (typeof id === 'string' && /[#/]/.test(id)) throw new Error(fmt(STRINGS.badId, { id, what, fix: id.replace(/[#/]/g, '-') }));
    const a = this.seen.get(id);
    if (a) throw new Error(fmt(STRINGS.dup, { id, a, b: what }));
    this.seen.set(id, what);
  }
  /** A stateful entry relies on its index id */
  unnamed(id, what) { this.missing.push(`${what} -> '${id}'`); }
  /** One dev warning per load listing the stateful entries without an id */
  done() {
    if (!DEV || !this.missing.length) return;
    const m = this.missing;
    warnOnce(fmt(STRINGS.noId, { n: String(m.length), list: m.slice(0, 6).join(', ') + (m.length > 6 ? ', …' : ''), first: m[0].split("-> '")[1].slice(0, -1) }));
  }
}

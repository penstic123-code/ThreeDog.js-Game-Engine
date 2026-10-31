// Stable ids of authored entries (one place for the rules; recipes/30-templates.md "Ids"):
//   written id                     as written (`chest-home`); may not contain `#` or `/` (runtime and level-node ids use them, so they never collide)
//   keyed content (npcs, containers)  the key
//   stateless prop without id      `prop:<model>:<index>`, a template prop without id `<template>:<index>` (pure decoration only)
//   level-model node               `<level>/<node>` (level module)
// An entry with state (pickups, grid items, templates with state / container / interact / body) needs a written id: an index id shifts when an entry
// is inserted above it, and the save then puts its changes on the wrong entry. Dev warns once per load, naming the entries and the id to write.
// Two entries with the same id in one load are an error with the fix. Source lines ("defined in content/props.js:14") come from the dev-only
// line tables of packages/tools/vite/vite-threedog-content-src.js (srcOf); a release build has none.
import { DEV, warnOnce, fmt } from '../../core/validate.js';

const STRINGS = {
  badId: 'content: id "{id}" ({what}) may not contain "#" or "/": "#" is for records made during play and "/" for level-model nodes. Write it with - _ . or :, e.g. "{fix}"',
  dup: 'content: id "{id}" is used twice: by {a} and by {b}. Ids name an entry in saves, so each must be unique: rename one, e.g. "{id}-2"',
  noId: 'content: {n} entr(y/ies) with state have no id, so saves match them by array index and an inserted entry shifts them: {list}. '
    + 'Write the id they have now (e.g. id: \'{first}\') to keep old saves working, or a readable one',
};
const RENAME_STRINGS = {
  shape: "content renames: write { oldId: 'newId' } (or oldId: null for an entry deleted on purpose), got {got} for '{id}'",
  badTarget: "content renames: '{a}' -> '{b}': the new id may not contain \"#\" (that is for records made during play)",
  stuck: 'content renames: saved data under {list} was not moved. A rename moves saved state only when the old id is gone from content and the new id has none of its own',
};

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

/**
 * content/renames.js ({ oldId: 'newId' | null }): before any placement is added, saved changes, removals, owed time and container goods under an old
 * authored id move to the new id (null drops them quietly). World and inventory remember the map, so a save loaded after content is renamed too.
 * Why in content and not a save version: renaming is an authoring change; the save format stays the same and an unrenamed save still loads. @internal
 * @param {any} e
 * @param {Record<string, string | null>} map
 */
export function applyRenames(e, map) {
  for (const [a, b] of Object.entries(map || {})) {
    if (b !== null && typeof b !== 'string') throw new Error(fmt(RENAME_STRINGS.shape, { id: a, got: JSON.stringify(b) }));
    if (typeof b === 'string' && b.includes('#')) throw new Error(fmt(RENAME_STRINGS.badTarget, { a, b }));
  }
  const stuck = e.world?.renameIds(map) ?? [];
  e.inventory?.renameIds(map);
  if (DEV && stuck.length) warnOnce(fmt(RENAME_STRINGS.stuck, { list: stuck.join(', ') }));
}

/** Index id of a pickup without a written id (the loader's id, and what `threedog content ids` writes) @param {any} p @param {number} i @internal */
export const pickupId = (p, i) => p.id ?? `pickup:${p.item}:${i}`;
/** Index id of a template instance without a written id @param {any} p @param {number} i @internal */
export const templateId = (p, i) => p.id ?? `${p.template}:${i}`;
/** Instances of this template keep state a save must find again by id @param {any} d @internal */
export const stateful = d => !!(d?.state || d?.container || d?.interact || d?.body);

/**
 * Stateful entries that rely on their index id, with the id they have now: what dev warns about at load and `threedog content ids` writes into the
 * content files (node side, no engine). One list, so the warning and the writer always agree. Grid items are not here: they cannot load without an id.
 * @param {{ pickups?: any[], props?: any[], templates?: Record<string, any> }} c
 * @returns {{ file: 'pickups' | 'props', index: number, id: string }[]}
 * @internal
 */
export function missingIds(c) {
  const out = [];
  (Array.isArray(c.pickups) ? c.pickups : []).forEach((p, i) => { if (p && p.id == null) out.push({ file: 'pickups', index: i, id: pickupId(p, i) }); });
  (Array.isArray(c.props) ? c.props : []).forEach((p, i) => { if (p?.template && p.id == null && stateful(c.templates?.[p.template])) out.push({ file: 'props', index: i, id: templateId(p, i) }); });
  return out;
}

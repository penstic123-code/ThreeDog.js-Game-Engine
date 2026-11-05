// Detection: R55 the public surface changes on purpose only (the 1.0 API lock). docs/api-surface.txt lists every public name with its signature
// (`threedog api-count --lock` rewrites it; one sorted line per name, so a diff shows exactly which names moved).
//   1. The live surface (the same reader as `threedog api-count`: type declarations, CLI commands and options, error codes) must equal the snapshot.
//      A new name only needs the snapshot regenerated in the same change (error until then).
//   2. A name removed or a signature changed compared with the base snapshot also needs a line under "## Unreleased" in packages/engine/CHANGELOG.md
//      that names it (the migration note). Base = the snapshot at the newest v* tag, else at the merge-base with main, else at HEAD (the uncommitted change).
//   3. A name the base snapshot marks @experimental may change or go with no note: that is what the mark promises. A name that was stable and is now marked
//      needs a note naming it or its parent (`grids` covers `grids.add`), or the mark would be a free way out of the lock.
// Why: the engine is frozen for 1.0, and an AI renames or retypes a public name as readily as it adds one; the old count guard saw only growth.
// Engine repository only (game: false): a game does not own these names. Known limits: a note is matched by the full name written anywhere in the Unreleased text.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './_lib.mjs';
import { surfaceLines, EXPERIMENTAL } from '../api-count.mjs';

const SNAP = 'docs/api-surface.txt', CHANGELOG = 'packages/engine/CHANGELOG.md';
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

/** @param {string[]} lines @returns {Map<string, string>} "group | name" -> signature */
export function parse(lines) {
  const m = new Map();
  for (const l of lines) { if (!l || l.startsWith('#')) continue; const x = /^([^|]+?) \| ([^|]+?)(?: \|(?: (.*))?)?$/.exec(l); if (x) m.set(`${x[1]} | ${x[2]}`, x[3] ?? ''); }   // an empty signature is written "group | name |"
  return m;
}
/** @returns {{ added: string[], removed: string[], changed: string[] }} keys ("group | name") that differ */
export function diff(base, now) {
  const added = [], removed = [], changed = [];
  for (const [k, v] of now) if (!base.has(k)) added.push(k); else if (base.get(k) !== v) changed.push(k);
  for (const k of base.keys()) if (!now.has(k)) removed.push(k);
  return { added, removed, changed };
}
/** Is this signature marked as allowed to change? */
export const marked = sig => sig === EXPERIMENTAL || sig.endsWith(' ' + EXPERIMENTAL);
const bare = sig => marked(sig) ? sig.slice(0, -EXPERIMENTAL.length).trimEnd() : sig;
/**
 * What needs a migration note between two snapshots: a stable name removed or retyped, or a stable name newly marked. The mark itself is not a retype.
 * @returns {{ removed: string[], changed: string[], marked: string[] }}
 */
export function breaks(base, now) {
  const stable = [...base.keys()].filter(k => !marked(base.get(k))), there = stable.filter(k => now.has(k));
  return { removed: stable.filter(k => !now.has(k)), changed: there.filter(k => bare(now.get(k)) !== base.get(k)), marked: there.filter(k => marked(now.get(k))) };
}
/** The text under "## Unreleased" in the changelog ('' when there is none) */
export function unreleased(text) {
  const m = /^## Unreleased[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text);
  return m ? m[1] : '';
}
function baseSnapshot() {
  const tag = (git('tag', '--list', 'v*', '--sort=-v:refname') ?? '').split('\n').filter(Boolean).find(t => git('cat-file', '-e', `${t}:${SNAP}`) !== null);
  if (tag) return git('show', `${tag}:${SNAP}`);
  const mb = git('merge-base', 'HEAD', 'main');
  const fromMain = mb && git('cat-file', '-e', `${mb}:${SNAP}`) !== null ? git('show', `${mb}:${SNAP}`) : null;
  return fromMain ?? git('show', `HEAD:${SNAP}`);
}

export default {
  id: 'R55', title: 'Public API lock: names and signatures match docs/api-surface.txt', game: false,
  async run() {
    const file = join(ROOT, SNAP);
    if (!existsSync(file)) return [{ level: 'error', file: SNAP, line: 1, msg: 'API snapshot missing', fix: 'run `threedog api-count --lock`' }];
    const now = parse(await surfaceLines()), snap = parse(readFileSync(file, 'utf8').split(/\r?\n/));
    const out = [];
    const d = diff(snap, now);
    const show = k => k.split(' | ')[1];
    for (const [what, list] of [['new', d.added], ['removed', d.removed], ['signature changed', d.changed]])
      if (list.length) out.push({ level: 'error', file: SNAP, line: 1, msg: `${what} public name differs from the snapshot: ${list.slice(0, 8).map(show).join(', ')}${list.length > 8 ? ` (+${list.length - 8})` : ''}`, fix: 'run `threedog api-count --lock` and commit docs/api-surface.txt in the same change' });
    // migration notes: names removed or retyped since the base snapshot
    const baseText = baseSnapshot();
    if (baseText) {
      const b = breaks(parse(baseText.split(/\r?\n/)), snap);
      const notes = unreleased(readFileSync(join(ROOT, CHANGELOG), 'utf8'));
      for (const [what, list] of [['removed', b.removed], ['changed', b.changed]])
        for (const k of list) {
          const n = show(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (!new RegExp(`(^|[^\\w.])${n}(?![\\w])`).test(notes)) out.push({ level: 'error', file: CHANGELOG, line: 1, msg: `public name ${what} without a migration note: ${show(k)}`, fix: `add a line naming \`${show(k)}\` under "## Unreleased" (what replaces it, or how to upgrade)` });
        }
      for (const k of b.marked) {
        const n = show(k).split('.')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), whole = show(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`(^|[^\\w.])(${whole}|${n})(?![\\w])`).test(notes)) out.push({ level: 'error', file: CHANGELOG, line: 1, msg: `public name newly marked @experimental without a note: ${show(k)}`, fix: `add a line naming \`${show(k)}\` under "## Unreleased": the mark takes back a promise` });
      }
    }
    return out;
  },
};

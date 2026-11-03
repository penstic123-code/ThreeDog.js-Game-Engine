// Scoped check (check -w <game>, or check run from inside a game folder): problems in that workspace's files are reported in full and decide the exit
// code; problems elsewhere are only counted, then summed into one line for other games and one for the engine and shared packages.
// check.mjs filters the rule runner through this; types.mjs does the same for tsc errors and hands its counts back to check with
// --tally-json (one TALLY line that check parses and merges).
import { resolve } from 'node:path';
import * as P from '../paths.mjs';

export const TALLY = 'THREEDOG_TALLY ';

/**
 * The scope of a check on workspace dir, as paths.mjs command(argv, { workspace: 'scope' }) picked it (the named workspace, else the game
 * workspace holding cwd); null for a repo-wide check.
 * @param {string | null} dir
 */
export const checkScope = dir => dir ? scope(dir) : null;

function scope(dir) {
  const mineRel = P.rel(dir), list = P.workspaces().map(P.rel).filter(Boolean).sort((a, b) => b.length - a.length);
  /** Workspace of a repo-relative (or absolute) file: its rel path, '' for the engine and shared packages */
  const owner = f => { const r = P.rel(resolve(P.ROOT, f || '.')); return list.find(w => P.under(r, w)) ?? ''; };
  const games = new Map(), engine = { errors: 0, warnings: 0 };
  const bucket = w => w && w !== P.ENGINE_REL ? (games.get(w) ?? games.set(w, { errors: 0, warnings: 0 }).get(w)) : engine;
  const add = (w, errors, warnings) => { const b = bucket(w); b.errors += errors; b.warnings += warnings; };
  return {
    dir, rel: mineRel,
    /** The engine package is outside the scope (its stale declarations etc. are only counted) */
    notEngine: dir !== P.ENGINE,
    /** Whether a file belongs to the scoped workspace */
    mine: f => !!f && owner(f) === mineRel,
    /** Count a problem outside the scope (level 'error' or anything else = warning) */
    other: (f, level) => add(owner(f), level === 'error' ? 1 : 0, level === 'error' ? 0 : 1),
    /** Count engine-package problems that have no single file (stale generated docs, declaration coverage) */
    engine: (errors, warnings = 0) => add('', errors, warnings),
    /** The counts as one TALLY line (types.mjs → check.mjs) */
    toJson: () => TALLY + JSON.stringify({ games: Object.fromEntries(games), engine }),
    /** Merge a subprocess's output: TALLY lines are folded into the counts and removed from the text */
    absorb(out) {
      return out.split('\n').filter(line => {
        if (!line.startsWith(TALLY)) return true;
        const t = JSON.parse(line.slice(TALLY.length));
        for (const [w, c] of Object.entries(t.games)) add(w, c.errors, c.warnings);
        add('', t.engine.errors, t.engine.warnings);
        return false;
      }).join('\n');
    },
    /** Print the counts: the TALLY line with --tally-json in argv (a subprocess of check), the summary lines otherwise */
    report(argv = process.argv) { for (const line of argv.includes('--tally-json') ? [this.toJson()] : this.summary()) console.log(line); },
    /** At most two lines: other games, then the engine and shared packages (only the non-empty ones) */
    summary() {
      const n = (c, w) => [c && `${c} error${c === 1 ? '' : 's'}`, w && `${w} warning${w === 1 ? '' : 's'}`].filter(Boolean).join(', ');
      const bad = [...games.values()].filter(c => c.errors || c.warnings);
      const ge = bad.reduce((s, c) => s + c.errors, 0), gw = bad.reduce((s, c) => s + c.warnings, 0);
      const out = [];
      if (bad.length) out.push(`other workspaces: ${bad.length} game${bad.length === 1 ? '' : 's'} with ${n(ge, gw)} (run npm run check at the root)`);
      if (engine.errors || engine.warnings) out.push(`engine and shared packages: ${n(engine.errors, engine.warnings)} (run npm run check at the root)`);
      return out;
    },
  };
}

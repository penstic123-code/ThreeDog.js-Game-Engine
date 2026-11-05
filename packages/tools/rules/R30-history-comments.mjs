// Detection: R30 comments describe the code as it is, not its history. "as before", "used to", "previously", "no longer uses", "the old way"
// tell a reader what changed, which only the git log should say; an AI reading the file takes them as current behavior or as a TODO.
// Flags those phrases in // and /* */ comments of packages/engine/**/*.js (strings and code are not read). Level: error in core, warn elsewhere.
// The tools are not scanned on purpose: their comments keep the failure a line guards against ("used to report success"), which is the reason for the line.
// Known limits: phrase list only; "no longer" alone is allowed ("when no longer needed" describes behavior).
import { walk, lines, P } from './_lib.mjs';

const PHRASES = /\b(as before|as it did before|did before|used to (be|do|have|call)|previously (was|did|used)|no longer (uses|calls|exists)|before (this|the) change|the old (way|code|form) (was|did))\b/i;

/** The comment text of a line ('' if none); string literals are blanked first so '//' inside a string is not a comment */
const comment = l => { const s = l.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""'); return s.match(/\/\/(.*)$/)?.[1] ?? s.match(/\/\*(.*?)(\*\/|$)/)?.[1] ?? (/^\s*\*/.test(s) ? s : ''); };

export default {
  id: 'R30', title: 'Comments state current behavior, not history',
  run() {
    const out = [];
    for (const f of walk(P.ENGINE_REL)) {
      if (/\/(node_modules|tests|docs|dist)\//.test(f)) continue;
      const core = f.startsWith(P.CORE_REL + '/');
      lines(f).forEach((l, i) => {
        const m = comment(l).match(PHRASES);
        if (!m) return;
        out.push({ level: core ? 'error' : 'warn', file: f, line: i + 1, msg: `comment narrates history: "${m[0]}"`, fix: 'say what the code does now; the change history belongs in git' });
      });
    }
    return out;
  },
};

// R68 tools reach the engine's internals only through engine._tools (error). Why: a private name called from a tool has no type and no test near it, so a rename in core broke the
// tool silently; core/inspect/toolDoor.js is the one list of what tools may do there. Scanned: packages/tools minus its tests, rules and contract.mjs (a stand-in engine builds these names, it does not reach them).
// Matched: `e | E | eng | engine | window.engine` . _name, and the debug view's userData._dbgOf mark. Limits: an engine held in a local of another name is not followed.
import { walk, read, codeOnly, P } from './_lib.mjs';

const REACH = /\b(?:e|E|eng|engine)\??\.(_(?!tools\b)[a-zA-Z]\w*)|userData\??\.(_dbgOf)\b/g;
/** The private names a line of tool code reaches for @param {string} line */
export const reaches = line => [...codeOnly(line).matchAll(REACH)].map(m => m[1] ?? m[2]);

export default {
  id: 'R68', title: 'Tools reach engine internals only through engine._tools',
  run() {
    const out = [], files = walk(P.TOOLS_REL, ['.js', '.mjs']).filter(f => !/\/(tests|rules)\/|\/contract\.mjs$/.test(f));
    for (const f of files) read(f).split('\n').forEach((line, i) => {
      for (const name of reaches(line)) out.push({ level: 'error', file: f, line: i + 1, msg: `a tool reaches the engine's private ${name}`, fix: 'go through engine._tools; when it has no word for this, add one in core/inspect/toolDoor.js' });
    });
    out.note = `${files.length} tool files`;
    return out;
  },
};

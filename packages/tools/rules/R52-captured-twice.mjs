// R52 a captured group is not placed by code and by content at once (warn).
// Why: `threedog content capture` moves a group's placement into content, and its code must then go. When it stays, the game shows two of everything
// and nothing errors: both copies load, stand in the same spot, and z-fight or block the player. That is a warning for the author to read, not a crash.
// How: the arrangement's header names the group it came from. Once content holds a copy (an entry with source: <arrangement>), a game file that still
// has that group name as a string is what placed it. Before the first stamp the code is still the only copy, so nothing is reported.
// Not caught: a name built at run time (`stall-${i}`) has no literal to find, and code that stopped naming the group while still building it. A string
// that only looks like it (the same word used for something else) is reported too; rename it or the group.
// Scope: the same as R51 (examples, templates, games/*); tests/, dist/ and content/ are skipped.
import { read } from './_lib.mjs';
import { gameFolders } from './R51-module-keys.mjs';

const HEADER = /^\/\/ Arrangement '([\w-]+)', captured from group '([^']+)'/;

/** One game's findings from its file list (paths as the rule walker gives them); text reads one file */
export function scanGame(files, text = read) {
  const out = [], content = files.filter(f => /(^|\/)content\//.test(f));
  const code = files.filter(f => !/(^|\/)(content|tests|dist|node_modules)\//.test(f));
  for (const f of content.filter(x => /(^|\/)content\/arrangements\/[^/]+\.js$/.test(x))) {
    const m = HEADER.exec(text(f));
    if (!m) continue;
    const [, name, group] = m, stamped = new RegExp(`\\bsource:\\s*['"\`]${name}['"\`]`);
    if (!content.some(c => /(^|\/)content\/props(\.js$|\/)/.test(c) && stamped.test(text(c)))) continue;
    const quoted = [`'${group}'`, `"${group}"`, `\`${group}\``];
    for (const c of code) {
      const at = text(c).split(/\r?\n/).findIndex(l => quoted.some(q => l.includes(q)));
      if (at >= 0) out.push({ level: 'warn', file: c, line: at + 1, msg: `group '${group}' was captured into ${f} and stamped into content, but this file still names it: the game may show it twice`,
        fix: `delete the code that places group '${group}'; content is the one source for it now` });
    }
  }
  return out;
}

export default {
  id: 'R52', title: 'A captured group is not placed by code and by content at once', game: true,
  run: () => gameFolders().flatMap(files => scanGame(files)),
};

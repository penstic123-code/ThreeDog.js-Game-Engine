// Detection: R53 no merge conflict left in a committed file. A line starting "<<<<<<< " or ">>>>>>> " in any file git tracks is an error, whatever the file type:
// a conflict in a changelog or a doc breaks no build and no test, so nothing else would ever say so.
// Why only those two markers: "=======" alone is a Markdown heading underline, and "|||||||" appears only together with them.
// Reads the list from `git ls-files`, not a folder walk: an untracked scratch file is nobody's commit. Binary files (a NUL byte) are skipped. Outside a git checkout it checks nothing.
// Known limits: a doc that must show a marker has to indent it.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './_lib.mjs';

const MARKER = /^(<{7}|>{7}) /;

/** @param {string} text @returns {number[]} 1-based lines holding a conflict marker */
export function markerLines(text) {
  const out = [];
  text.split(/\r?\n/).forEach((l, i) => { if (MARKER.test(l)) out.push(i + 1); });
  return out;
}

/** @param {string} root a git checkout @returns {{ level: 'error', file: string, line: number, msg: string, fix: string }[]} */
export function scan(root) {
  let listed;
  try { listed = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return []; }   // not a checkout: a game installed from npm has nothing to read here
  const out = [];
  for (const file of listed.split('\0').filter(Boolean)) {
    const p = join(root, file);
    if (!existsSync(p)) continue;   // deleted, not yet committed
    const buf = readFileSync(p);
    if (buf.indexOf('<<<<<<< ') < 0 && buf.indexOf('>>>>>>> ') < 0) continue;
    if (buf.includes(0)) continue;
    for (const line of markerLines(buf.toString('utf8'))) out.push({ level: /** @type {const} */ ('error'), file, line, msg: 'merge conflict marker committed', fix: 'resolve the conflict and delete the marker lines' });
  }
  return out;
}

export default {
  id: 'R53', title: 'No merge conflict markers in tracked files', game: true,
  run: () => scan(ROOT),
};

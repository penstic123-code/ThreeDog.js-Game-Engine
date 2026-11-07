// Detection: R54 the editor's screen reaches design data only through editor/design.js. Flat content is still being tested with real users; if its format
// changes, the plan is that design.js and content-write.mjs change and the screen does not. That holds only while the screen stays ignorant of the format
// and of the endpoint, so this rule reads every file in packages/tools/editor/ except design.js for the words that would tie it down.
// All editor files, design.js too: no direct write to world records (a move goes through the thing.set op, so it is in the op log and undoable).
// Known limits: a text scan; comments are stripped first, so a sentence about a word does not trip it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './_lib.mjs';
import { noComments } from '../lib/text.mjs';

const DIR = 'packages/tools/editor', DOOR = 'design.js';
const SCREEN = [[/\bfetch\s*\(|__threedog\//, 'talks to the server'], [/\bengine\.(world|content)\b/, 'reads content or world records'], [/\.definedAt\b|\bfileValues\b/, 'reads where an entry is written'],
  [/\.(template|source|grid|cell)\b/, 'names a content field']];
const ALL = [[/\bworld\.(set|move|remove|add)\s*\(/, 'writes a world record directly']];

/** @param {string} name file name in editor/ @param {string} text @returns {{ line: number, msg: string }[]} */
export function problems(name, text) {
  const out = [], rules = name === DOOR ? ALL : [...SCREEN, ...ALL];
  noComments(text).split('\n').forEach((l, i) => { for (const [re, what] of rules) if (re.test(l)) out.push({ line: i + 1, msg: `the editor ${what}` }); });
  return out;
}

export default {
  id: 'R54', title: 'The editor reaches design data only through editor/design.js',
  run() {
    const dir = join(ROOT, DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => f.endsWith('.js')).flatMap(f => problems(f, readFileSync(join(dir, f), 'utf8')).map(p =>
      ({ level: /** @type {const} */ ('error'), file: `${DIR}/${f}`, line: p.line, msg: p.msg, fix: `move it into ${DIR}/${DOOR}: the screen holds a neutral entry and calls entryAt / moveEntry` })));
  },
};

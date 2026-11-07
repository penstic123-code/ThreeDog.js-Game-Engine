// Detection: R56 a test item that fails a check when a measured time is too LONG, and is not `serial: true`. Warning.
// Why: items run side by side (npm test --jobs), and a page measured beside other pages reads several times too high (COMMANDS.md); a pass/fail
// verdict on such a number fails on a busy machine and passes on a quiet one. `serial: true` runs the item alone. (The runner retries a failed
// item alone once, which hides the flake but costs a run each time.)
// What counts: inside run() source, a check(...) call (its label, the first string, is ignored) holding `<` / `<=` against a timing name (ms,
//   fooMs, perStep, p95, frameTime; not `elapsed`, too often game time) on one side, or `>` / `>=` with it on the right. A lower bound (`ms >= 20`) passes when slower,
//   a plain `>= 0` / `> 0` only says "was measured": neither is judged. Helpers defined outside run() are not seen.
// Known limits: text match, not data flow (a time copied into a name that is not timing-like is missed); a deliberately relative verdict
//   (`a.ms < b.ms * 3`, both measured under the same load) is still reported: put `serial: true` on it anyway, or ignore the line.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { P, rel } from './_lib.mjs';
import { workspaceSpecs } from '../lib/specs.mjs';

// a timing name: r.crowd.ms, rows[0].cpuMs, perStep ("elapsed" is too often game time, "rms" is not a time, "stems" neither: the name starts at a word edge)
const ID = String.raw`(?<![\w.])(?:[\w\[\]]+\.)*(?:ms|\w+Ms|ms[A-Z]\w*|perStep|p9[059]|frameTime)\b`;
const UPPER = new RegExp(String.raw`${ID}(?:\s*[*+/-]\s*[\w.]+)*\s*<=?\s*[^<>=\s]|>=?\s*\(?\s*[\w.\[\]*+\s/()-]*?${ID}`);
/** The text of a check(...) call without its first string argument (the label may talk about "ms" freely) */
const stripLabel = s => s.replace(/^\s*(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)\s*,?/, '');

/** @param {string} src source of a run() @returns {string|null} the first check text that judges a time by an upper bound, or null */
export function timingVerdict(src) {
  for (const m of src.matchAll(/\bcheck\(([^;]*?)\);/gs)) {
    const body = stripLabel(m[1]).split(/,\s*(?:JSON\.stringify|String|`)/)[0];   // the trailing detail argument only prints
    if (UPPER.test(body)) return body.replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  return null;
}

export default {
  id: 'R56', title: 'A test item that judges by a measured time runs with serial: true', game: true,
  async run() {
    const out = [];
    for (const dir of P.workspaces()) {
      const items = await workspaceSpecs(dir, []);   // a file that does not load is the test runner's error, not this rule's
      for (const { spec, file } of items) {
        if (spec.serial) continue;
        const why = timingVerdict(String(spec.run));
        if (!why) continue;
        const path = join(dir, 'tests', 'specs', file), line = readFileSync(path, 'utf8').split(/\r?\n/).findIndex(l => l.includes(spec.name.slice(0, 40))) + 1;
        out.push({ level: /** @type {const} */ ('warn'), file: rel(path), line: line || 1, msg: `"${spec.name.slice(0, 50)}" fails on a measured time (${why}) but runs beside other pages`, fix: 'add serial: true to the item (a time read beside other pages comes out several times too high)' });
      }
    }
    return out;
  },
};

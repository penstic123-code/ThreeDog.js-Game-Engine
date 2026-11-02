// Atomic file write + "check, restore on failure": the one copy shared by content write-back (content-write.mjs) and `threedog tune write`.
// Why temp file + rename: a crash or a full disk halfway through leaves either the old file or the new one, never half of each (a half-written
// content file would not even load, and the dev server would serve it at once).
// Why restore also when the check throws: a check that crashes on the new text is a failed check, not a reason to keep a file nobody validated.
import * as fs from 'node:fs';

/**
 * Write text to path through a temp file next to it and one rename
 * @param {string} path  @param {string} text
 * @param {{ writeFileSync: Function, renameSync: Function }} [io]  file functions (tests pass counting wrappers)
 */
export function writeAtomic(path, text, io = fs) {
  const tmp = path + '.threedog-tmp';
  io.writeFileSync(tmp, text);
  io.renameSync(tmp, path);
}

/**
 * Write `after`, run check(); when it returns problems or throws, write `before` back. Returns { ok: true } or { ok: false, problems: string[] }
 * @param {string} path  @param {string} before  the file text now (what a failure restores)  @param {string} after
 * @param {() => Promise<string[]> | string[]} check  problems after the write (empty = keep it)
 * @param {any} [io]
 */
export async function writeChecked(path, before, after, check, io = fs) {
  writeAtomic(path, after, io);
  let problems;
  try { problems = await check(); } catch (e) { problems = [`the check threw: ${e.message}`]; }
  if (problems.length) { writeAtomic(path, before, io); return { ok: false, problems }; }
  return { ok: true, problems: [] };
}

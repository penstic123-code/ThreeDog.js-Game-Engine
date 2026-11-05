// Atomic file write + "check, restore on failure": the one copy shared by content write-back (content-write.mjs, content-ids.mjs) and `threedog tune write`.
// Why temp file + rename: a crash or a full disk halfway through leaves either the old file or the new one, never half of each (a half-written
// content file would not even load, and the dev server would serve it at once).
// Why the retry: on Windows a rename over a file another process has open fails with EPERM or EBUSY for a moment. A dev server reads a content file as soon as it changes, and
// three busy readers made 77 of 100 renames fail in a measured loop. Other errors, and a file still held after the last try, throw as before.
// Why restore also when the check throws: a check that crashes on the new text is a failed check, not a reason to keep a file nobody validated.
import * as fs from 'node:fs';

const BUSY = ['EPERM', 'EBUSY', 'EACCES'], TRIES = 5, PAUSE = new Int32Array(new SharedArrayBuffer(4));

/**
 * Write text to path through a temp file next to it and one rename
 * @param {string} path  @param {string} text
 * @param {{ writeFileSync: Function, renameSync: Function, rmSync?: Function }} [io]  file functions (tests pass counting wrappers)
 */
export function writeAtomic(path, text, io = fs) {
  const tmp = path + '.threedog-tmp';
  io.writeFileSync(tmp, text);
  for (let i = 1; ; i++) {
    try { return io.renameSync(tmp, path); }
    catch (e) { if (i === TRIES || !BUSY.includes(e.code)) { io.rmSync?.(tmp, { force: true }); throw e; } }
    Atomics.wait(PAUSE, 0, 0, i * 20);   // the write is synchronous for its callers, so this sleeps; 200 ms in all
  }
}

/**
 * Write `after`, run check(); when it returns problems or throws, write `before` back. Returns { ok: true } or { ok: false, problems: string[] }
 * @param {string} path  @param {string} before  the file text now (what a failure restores)  @param {string} after
 * @param {() => Promise<string[]> | string[]} check  problems after the write (empty = keep it)
 * @param {any} [io]  needs readFileSync as well
 */
export async function writeChecked(path, before, after, check, io = fs) {
  writeAtomic(path, after, io);
  let problems;
  try { problems = await check(); } catch (e) { problems = [`the check threw: ${e.message}`]; }
  if (problems.length) {
    if (io.readFileSync(path, 'utf8') === after) writeAtomic(path, before, io);   // only our own text: a hand save during the check is newer than `before`
    return { ok: false, problems };
  }
  return { ok: true, problems: [] };
}

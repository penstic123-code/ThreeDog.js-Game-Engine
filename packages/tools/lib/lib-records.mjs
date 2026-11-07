// Pull records: <game>/.threedog-lib.json says which files of a game came from which library entry and what they looked like when they landed.
// Why a record at all: a pull is a copy that belongs to the game, so nothing links back, but the game still has to be able to answer "where did this
//   come from, have we changed it, is there a newer one" (lib status, lib list, art board, lib check). Guessing from bytes stops working the moment the
//   game edits its copy, which is the whole point of a pull.
// Why it stores no library path: the file is committed with the game and read on other machines; the library is found the usual way (libraryDir).
// Why hashes ignore CRLF: git on Windows may rewrite line ends on checkout, and that is not an edit anybody made.
// Nothing here ever changes a game file except the record: a newer entry is reported, never applied.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { writeAtomic } from './atomic.mjs';
import { posix } from '../paths.mjs';

export const RECORD_FILE = '.threedog-lib.json';
/** Files of an entry folder that describe it and are never pulled, so they are no part of its content */
const NOT_CONTENT = new Set(['entry.json', 'preview.png']);

/** Short content hash of one file; line ends do not count in a text file */
export function hashFile(path) {
  let b = readFileSync(path);
  if (!b.subarray(0, 8000).includes(0)) b = Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'));
  return createHash('sha256').update(b).digest('hex').slice(0, 16);
}

/** An entry folder's content files, relative and sorted */
export const contentFiles = dir => readdirSync(dir, { recursive: true }).map(f => posix(String(f))).filter(f => !NOT_CONTENT.has(f) && statSync(join(dir, f)).isFile()).sort();

/** Hash of an entry's content (its files and their paths), the version mark lib status compares */
function hashEntry(dir) {
  const files = contentFiles(dir);
  return createHash('sha256').update(files.map(f => `${f}\0${hashFile(join(dir, f))}\n`).join('')).digest('hex').slice(0, 16);
}

/** The game's records, sorted by entry name; [] when it has pulled nothing. A file that cannot be read throws: a pull must not write over it */
export function readRecords(game) {
  const f = join(game, RECORD_FILE);
  if (!existsSync(f)) return [];
  try {
    const pulls = JSON.parse(readFileSync(f, 'utf8')).pulls;
    if (Array.isArray(pulls)) return pulls;
    throw new Error('it has no "pulls" list');
  } catch (e) { throw new Error(`lib: ${f} cannot be read (${e.message.split('\n')[0]}). Fix the file, or delete it to forget where this game's library files came from`); }
}

/**
 * Note one pull in the game, replacing the entry's earlier record.
 * @param {string} game @param {any} entry the entry as readLibrary gives it (with dir) @param {string[]} paths every file the pull put in the game (absolute)
 */
export function recordPull(game, entry, paths) {
  const files = Object.fromEntries([...new Set(paths)].sort().map(p => [posix(relative(game, p)), hashFile(p)]));
  const row = { entry: entry.name, kind: entry.kind, summary: entry.summary ?? '', from: entry.from ?? '', version: hashEntry(entry.dir), pulled: new Date().toISOString().slice(0, 10), style: entry.style?.tags ?? [], needs: entry.needs?.entries ?? [], packages: entry.needs?.packages ?? [], files };
  const pulls = [...readRecords(game).filter(r => r.entry !== entry.name), row].sort((a, b) => a.entry.localeCompare(b.entry));
  writeAtomic(join(game, RECORD_FILE), JSON.stringify({ pulls }, null, 2) + '\n');
  return row;
}

/**
 * Each record against the game's files and the library now.
 * changed / missing: game files that differ from the pull or are gone. library: 'same', 'newer' (the entry's content moved on) or 'gone' (no such entry).
 * @param {string} game @param {any[]} libraryEntries readLibrary(...).entries
 */
export function pullStatus(game, libraryEntries) {
  return readRecords(game).map(r => {
    const paths = Object.keys(r.files), gone = paths.filter(f => !existsSync(join(game, f)));
    const changed = paths.filter(f => !gone.includes(f) && hashFile(join(game, f)) !== r.files[f]);
    const e = libraryEntries.find(x => x.name === r.entry);
    return { ...r, changed, missing: gone, library: !e ? 'gone' : hashEntry(e.dir) === r.version ? 'same' : 'newer' };
  });
}

/** "changed (2 of 3 files)", "unchanged": the words every report uses for one status row */
export function changeWords(s) {
  const n = s.changed.length + s.missing.length, all = Object.keys(s.files).length;
  return n ? `changed (${n} of ${all} file${all === 1 ? '' : 's'})` : 'unchanged';
}

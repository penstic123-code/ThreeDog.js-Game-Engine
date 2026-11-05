// Rule R53 on a throwaway git repo: a committed conflict marker is an error in any text file; a binary, an untracked file, a Markdown underline and an indented example are not.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markerLines, scan } from '../rules/R53-conflict-markers.mjs';

export const name = 'rule R53: no committed merge conflict markers';
const open = '<'.repeat(7), close = '>'.repeat(7);   // built here so this file does not hold a marker of its own

export function run({ check }) {
  const conflict = `# Log\r\n${open} HEAD\r\nours\r\n=======\r\ntheirs\r\n${close} fix/branch\r\n`;
  check('both markers are found, CRLF too', markerLines(conflict).join() === '2,6', markerLines(conflict).join());
  check('a Markdown underline and an indented example are not', !markerLines(`Title\n=======\n    ${open} HEAD\n`).length);
  check('seven signs with no space after are not a marker', !markerLines(`${open}\n`).length);
  const dir = mkdtempSync(join(tmpdir(), 'r52-'));
  try {
    const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(join(dir, 'CHANGELOG.md'), conflict);
    writeFileSync(join(dir, 'clean.md'), 'nothing here\n');
    writeFileSync(join(dir, 'image.bin'), Buffer.concat([Buffer.from(`${open} HEAD\n`), Buffer.from([0, 1, 2])]));
    git('add', '.');
    writeFileSync(join(dir, 'scratch.md'), conflict);   // never added
    const found = scan(dir);
    check('only the tracked text file is reported', found.length === 2 && found.every(f => f.file === 'CHANGELOG.md' && f.level === 'error'), JSON.stringify(found));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const outside = mkdtempSync(join(tmpdir(), 'r52-none-'));
  try { check('outside a git checkout it checks nothing', !scan(outside).length); } finally { rmSync(outside, { recursive: true, force: true }); }
}

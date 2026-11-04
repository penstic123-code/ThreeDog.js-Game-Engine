// lib pull records: every pull route leaves a note in the game, and status / list / art board read that note instead of guessing from bytes.
// Why: "from the library, changed or not" is the one thing a game cannot work out afterwards; a route that forgets the note would make a pulled file
// look hand-written, and an update that touches the game would break the promise that a pull belongs to the game.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { TOOLS } from '../paths.mjs';
import { addEntry, pullEntry, entries } from '../lib.mjs';
import { scanArt } from '../art-board-scan.mjs';
import { RECORD_FILE, hashFile, pullStatus, readRecords } from '../lib/lib-records.mjs';

export const name = 'lib records: every pull notes entry, source and hashes in .threedog-lib.json; lib status / list / art board say changed or not and newer or not, and never touch the game';

export async function run({ check }) {
  const tmp = mkdtempSync(join(tmpdir(), 'threedog-lib-rec-'));
  const put = (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t); };
  const cli = (args, cwd) => spawnSync(process.execPath, [join(TOOLS, 'bin', 'threedog.mjs'), 'lib', ...args], { cwd, encoding: 'utf8', env: { ...process.env, THREEDOG_LIBRARY: lib } });
  const lib = join(tmp, 'library');
  try {
    const a = join(tmp, 'game-a'), b = join(tmp, 'game-b');
    put(join(a, 'package.json'), '{"name":"game-a"}');
    put(join(b, 'package.json'), '{"name":"game-b"}');
    put(join(a, 'art', 'dust.js'), '/** Dust puffs */\nexport function dust() { return { name: "dust", type: "rules", install() { return {}; } }; }\n');
    put(join(a, 'art', 'crate.png'), 'png');
    put(join(a, 'art', 'tint.js'), '/** A tint */\nexport function tint(THREE) { return new THREE.MeshBasicMaterial(); }\n');
    await addEntry('art/dust.js', { game: a, cwd: tmp, lib, kind: 'effect', noPreview: true });
    await addEntry('art/crate.png', { game: a, cwd: tmp, lib, noPreview: true });
    await addEntry('art/tint.js', { game: a, cwd: tmp, lib, kind: 'picture', noPreview: true });

    // a dry run and a refused pull change nothing, so they note nothing
    await pullEntry('dust', { game: b, cwd: tmp, lib, dry: true });
    check('pull --dry leaves no record', !existsSync(join(b, RECORD_FILE)));

    // [guard] all three routes (plugins with a wiring file, art/, the picture folder) are noted, with every file they landed
    await pullEntry('dust', { game: b, cwd: tmp, lib });
    await pullEntry('crate', { game: b, cwd: tmp, lib });
    await pullEntry('tint', { game: b, cwd: tmp, lib });
    const recs = readRecords(b), of = n => recs.find(r => r.entry === n);
    check('[guard] each pull route leaves a record with its files and their hashes',
      recs.map(r => r.entry).join() === 'crate,dust,tint' && Object.keys(of('dust').files).join() === 'plugins/dust.js,plugins/dust/dust.js'
      && Object.keys(of('crate').files).join() === 'art/crate.png' && Object.keys(of('tint').files).length === 1 && of('dust').files['plugins/dust.js'] === hashFile(join(b, 'plugins', 'dust.js')), JSON.stringify(recs));
    check('the record says where it came from and keeps no machine path', /^game-a /.test(of('dust').from) && !readFileSync(join(b, RECORD_FILE), 'utf8').includes(tmp.replace(/\\/g, '\\\\')), JSON.stringify(of('dust')));

    // unchanged, then the game edits its copy; line ends alone are not an edit
    const fresh = pullStatus(b, entries(lib));
    check('status: everything unchanged and the same as the library right after a pull', fresh.every(s => !s.changed.length && !s.missing.length && s.library === 'same'), JSON.stringify(fresh));
    const code = join(b, 'plugins', 'dust', 'dust.js'), text = readFileSync(code, 'utf8');
    writeFileSync(code, text.replace(/\n/g, '\r\n'));
    check('status: a checkout that only changed line ends is not an edit', pullStatus(b, entries(lib)).find(s => s.entry === 'dust').changed.length === 0);
    writeFileSync(code, text + '// this game\'s own\n');
    rmSync(join(b, 'art', 'crate.png'));
    const edited = pullStatus(b, entries(lib)), row = n => edited.find(s => s.entry === n);
    check('status: an edited file and a deleted file are told apart', row('dust').changed.join() === 'plugins/dust/dust.js' && row('crate').missing.join() === 'art/crate.png', JSON.stringify(edited));

    // the library moves on: reported, the game untouched
    put(join(a, 'art', 'dust.js'), readFileSync(join(a, 'art', 'dust.js'), 'utf8') + '// v2\n');
    await addEntry('art/dust.js', { game: a, cwd: tmp, lib, kind: 'effect', noPreview: true, force: true });
    rmSync(join(lib, 'tint'), { recursive: true });
    const before = readFileSync(code, 'utf8'), st = cli(['status'], b);
    check('cli status: changed files, newer in the library, gone from the library, and how to look before taking it',
      st.status === 0 && /^dust {2}\[effect\] {2}changed \(1 of 2 files\), NEWER in the library/m.test(st.stdout) && /changed here: plugins\/dust\/dust\.js/.test(st.stdout)
      && /deleted here: art\/crate\.png/.test(st.stdout) && /^tint .*no longer in the library/m.test(st.stdout) && /lib pull <name> --dry/.test(st.stdout), st.stdout + st.stderr);
    check('[guard] status changes no game file', readFileSync(code, 'utf8') === before && !readFileSync(code, 'utf8').includes('// v2'));

    const ls = cli(['list'], b);
    check('cli list: says what this game pulled and whether it changed; a game that pulled nothing shows the plain line',
      /^dust .*pulled here, changed \(1 of 2 files\)$/m.test(ls.stdout) && !/pulled here/.test(cli(['list'], a).stdout), ls.stdout);
    check('cli status: a game that pulled nothing says so', /has pulled nothing/.test(cli(['status'], a).stdout));

    const board = await scanArt(b, { lib }), it = board.items.find(x => x.ref === 'library dust');
    check('art board: the entry shows from the records, changed files named, even though its bytes differ now',
      it?.pulled === 'changed (1 of 2 files)' && it.changed.join() === 'plugins/dust/dust.js' && it.libraryState === 'newer' && /pulled from the library, changed/.test(it.line), JSON.stringify(it));

    // a broken record file stops the pull with the fix, instead of being overwritten
    writeFileSync(join(b, RECORD_FILE), '{ nope');
    let broken = '';
    try { await pullEntry('crate', { game: b, cwd: tmp, lib }); } catch (x) { broken = x.message; }
    check('a record file that cannot be read stops the pull, says how to fix it, and is left as it was', /cannot be read.*delete it/.test(broken) && readFileSync(join(b, RECORD_FILE), 'utf8') === '{ nope' && !existsSync(join(b, 'art', 'crate.png')), broken);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

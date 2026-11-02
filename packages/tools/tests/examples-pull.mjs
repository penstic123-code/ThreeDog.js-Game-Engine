// threedog examples list / pull: the engine's copyable examples. Offline, no browser, temp folders only.
// Why a unit test: the pull is only useful if the list is complete (a technique folder missing from pullable.json is invisible), the files it
// names exist and import nothing that stays behind, and an edited copy in the game is never overwritten without --force.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ENGINE } from '../paths.mjs';
import { pullable, listExamples, pullExample } from '../examples.mjs';

export const name = 'examples: every technique folder is listed, pulls copy only listed files with no imports left behind, never overwrite without --force';

const throws = fn => { try { fn(); return ''; } catch (e) { return e.message; } };

export async function run({ check }) {
  const all = pullable(), dirs = Object.values(all).map(e => e.dir);
  const techniques = readdirSync(join(ENGINE, 'examples/techniques'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => `techniques/${d.name}`);
  check('every examples/techniques/* folder is in pullable.json', techniques.every(d => dirs.includes(d)), 'missing: ' + techniques.filter(d => !dirs.includes(d)).join(', '));
  const list = listExamples();
  check('list: each example has a summary (its README\'s first line)', list.length === Object.keys(all).length && list.every(x => x.summary.length > 10), JSON.stringify(list));
  // relative imports of a pulled file must point at another pulled file: the copy has to run where it lands
  const left = [];
  for (const [n, e] of Object.entries(all)) for (const f of e.files.filter(f => f.endsWith('.js'))) {
    const src = readFileSync(join(ENGINE, 'examples', e.dir, f), 'utf8');
    for (const m of src.matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)) if (!e.files.includes(m[1].replace(/^\.\//, ''))) left.push(`${n}/${f} -> ${m[1]}`);
  }
  check('pulled files import only each other or packages (nothing left behind)', !left.length, left.join(', '));

  const tmp = mkdtempSync(join(tmpdir(), 'threedog-examples-'));
  try {
    const game = join(tmp, 'game'), sub = join(game, 'src');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(game, 'package.json'), '{"name":"game"}');
    const r = pullExample('contact-shadows', { cwd: sub });
    const dest = join(game, 'techniques', 'contact-shadows');
    check('pull: default folder is <game root>/techniques/<name>/, only the listed files', r.out === dest && readdirSync(dest).sort().join() === [...all['contact-shadows'].files].sort().join(), JSON.stringify(r));
    check('pull: reports the import line and the packages the code imports', /applyContactShadows/.test(r.use) && r.packages.includes('threedog') && r.packages.includes('@threedog/post-effects'), JSON.stringify(r));
    const again = pullExample('contact-shadows', { cwd: sub });
    check('pull again unchanged: nothing written, no error', again.written.length === 0 && again.same.length === r.written.length, JSON.stringify(again));
    writeFileSync(join(dest, 'contactShadows.js'), '// edited by the game\n');
    const refused = throws(() => pullExample('contact-shadows', { cwd: sub }));
    check('an edited copy stops the pull without --force, and nothing is written', /already has a different contactShadows\.js; nothing was written/.test(refused) && readFileSync(join(dest, 'contactShadows.js'), 'utf8') === '// edited by the game\n', refused);
    pullExample('contact-shadows', { cwd: sub, force: true });
    check('--force overwrites', readFileSync(join(dest, 'contactShadows.js'), 'utf8') !== '// edited by the game\n');
    const out = pullExample('rc2d', { cwd: sub, out: 'fx/rc' });
    check('--out is relative to the current folder', out.out === join(sub, 'fx', 'rc') && existsSync(join(sub, 'fx', 'rc', 'shaders.js')));
    check('an unknown name fails with did-you-mean', /did you mean day-night-grade\?/.test(throws(() => pullExample('day-night-grad', { cwd: sub }))));
    check('an Object member name ("constructor") is just an unknown example', /no example "constructor"/.test(throws(() => pullExample('constructor', { cwd: sub }))));
    // a manifest entry that climbs out ("../x") is refused before anything is read or written
    const fake = join(tmp, 'engine');
    mkdirSync(join(fake, 'examples', 'evil'), { recursive: true });
    writeFileSync(join(fake, 'examples', 'secret.txt'), 'outside');
    writeFileSync(join(fake, 'examples', 'pullable.json'), JSON.stringify({ examples: { evil: { dir: 'evil', files: ['../secret.txt'], use: '' } } }));
    const escaped = throws(() => pullExample('evil', { cwd: sub, engineDir: fake }));
    check('a listed file outside the example folder is refused, nothing written', /outside its folder: \.\.\/secret\.txt/.test(escaped) && !existsSync(join(game, 'techniques', 'secret.txt')), escaped);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

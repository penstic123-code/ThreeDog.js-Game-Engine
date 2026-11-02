// threedog examples: list the engine's copyable examples and pull one into this game as the game's own files.
//   threedog examples list                              name + the first line of its README
//   threedog examples pull <name> [--out dir] [--force]   copy the game-facing files to <game>/techniques/<name>/ (or --out), print what to import
// The list lives in one place: the engine package's examples/pullable.json (name -> dir, files, the import line). A folder not named there is
// not pullable, so a demo page or test helper never lands in a game by accident.
// Why copy and not import from node_modules: a technique is learned and then adapted to the game's own look (its DESIGN.md); the copy is the
// game's to change, and an engine update never changes it behind the game's back. There is no link back and no update command, on purpose.
// Why all-or-nothing: a file that exists with different content stops the whole pull (nothing is written) unless --force, so an edited copy is
// never half-overwritten. A file with the same content is skipped silently.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from './paths.mjs';
import { closest, nearest } from './lib/text.mjs';
import { parseOptions } from './lib/cli-args.mjs';

/** The manifest of an engine folder: { name: { dir, files, use } } */
export function pullable(engineDir = ENGINE) {
  const f = join(engineDir, 'examples', 'pullable.json');
  if (!existsSync(f)) throw new Error(`examples: ${f} is missing (the engine package ships it; reinstall threedog)`);
  return JSON.parse(readFileSync(f, 'utf8')).examples;
}

/** [{ name, summary, dir }]: summary = the README's first line without the heading mark */
export function listExamples(engineDir = ENGINE) {
  return Object.entries(pullable(engineDir)).map(([name, e]) => {
    const readme = join(engineDir, 'examples', e.dir, 'README.md');
    const first = existsSync(readme) ? readFileSync(readme, 'utf8').split(/\r?\n/)[0] : '';
    return { name, summary: first.replace(/^#+\s*/, '').trim(), dir: `examples/${e.dir}` };
  });
}

/** The nearest folder at or above dir with a package.json (the game root), else dir */
function gameRoot(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) { if (existsSync(join(d, 'package.json'))) return d; if (dirname(d) === d) return resolve(dir); }
}

/**
 * Copy one example's files. Returns { out, written, same, use, packages }; throws on an unknown name (with did-you-mean) or on a changed
 * existing file without force (nothing written).
 * @param {string} name
 * @param {{ out?: string, force?: boolean, cwd?: string, engineDir?: string }} [o]
 */
export function pullExample(name, { out, force = false, cwd = process.cwd(), engineDir = ENGINE } = {}) {
  const all = pullable(engineDir), names = Object.keys(all);
  if (!name) throw new Error(`examples pull: name an example: ${names.join(', ')} (threedog examples list)`);
  // own keys only: "constructor" / "__proto__" would otherwise find Object's members and fail with a TypeError instead of "no example"
  const e = Object.hasOwn(all, name) ? all[name] : null;
  if (!e) {
    const near = closest(name, names);
    throw new Error(`examples: no example "${name}"${near ? `; did you mean ${near}?` : `; close: ${nearest(name, names).join(', ')}`} (threedog examples list)`);
  }
  const src = join(engineDir, 'examples', e.dir), dest = out ? resolve(cwd, out) : join(gameRoot(cwd), 'techniques', name);
  const plan = e.files.map(f => ({ f, from: join(src, f), to: join(dest, f) }));
  // a listed file must stay inside its example folder and inside the destination: a "../x" entry in a (hand-edited or broken) manifest
  // would otherwise read or write outside both
  const inside = (root, p) => { const r = relative(root, p); return r && !r.startsWith('..') && !isAbsolute(r); };
  const outside = plan.filter(p => !inside(src, p.from) || !inside(dest, p.to));
  if (outside.length) throw new Error(`examples: ${name} lists files outside its folder: ${outside.map(p => p.f).join(', ')} (fix examples/pullable.json)`);
  const missing = plan.filter(p => !existsSync(p.from));
  if (missing.length) throw new Error(`examples: ${name} lists files the package does not have: ${missing.map(p => p.f).join(', ')}`);
  const same = [], conflicts = [];
  for (const p of plan) {
    p.text = readFileSync(p.from);
    if (!existsSync(p.to)) continue;
    if (readFileSync(p.to).equals(p.text)) same.push(p.f); else conflicts.push(p.f);
  }
  if (conflicts.length && !force) throw new Error(`examples: ${relative(cwd, dest) || '.'} already has a different ${conflicts.join(', ')}; nothing was written. --force overwrites, --out puts it elsewhere`);
  const written = [];
  for (const p of plan) if (!same.includes(p.f)) { mkdirSync(dirname(p.to), { recursive: true }); writeFileSync(p.to, p.text); written.push(p.f); }
  // package imports of the copied code: the game needs them installed (relative imports stay inside the pulled folder)
  const packages = [...new Set(plan.filter(p => /\.m?js$/.test(p.f)).flatMap(p => [...p.text.toString('utf8').matchAll(/^\s*import\s[^'"]*['"]([^'".][^'"]*)['"]/gm)].map(m => m[1])))]
    .map(s => s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]).filter((s, i, a) => a.indexOf(s) === i);
  return { out: dest, written, same, use: e.use, packages };
}

export function main(argv) {
  const [sub, ...rest] = argv;
  try {
    if (sub === 'list') {
      parseOptions(rest, { flags: [], values: [], page: null });
      const l = listExamples(), w = Math.max(...l.map(x => x.name.length));
      for (const x of l) console.log(`${x.name.padEnd(w)}  ${x.summary}`);
      console.log('\nthreedog examples pull <name> [--out dir] copies one into this game (techniques/<name>/). Learn the technique, then adapt it to the game\'s own look.');
      return 0;
    }
    if (sub === 'pull') {
      const { opt, page: name } = parseOptions(rest, { flags: ['force'], values: ['out'], page: '' });
      const r = pullExample(name, { out: opt.out, force: !!opt.force });
      const where = relative(process.cwd(), r.out).split('\\').join('/') || '.';
      console.log(`${name} -> ${where}/: ${r.written.length ? 'wrote ' + r.written.join(', ') : 'nothing new'}${r.same.length ? ` (unchanged: ${r.same.join(', ')})` : ''}`);
      console.log(`Use it (paths relative to ${where}/): ${r.use}`);
      if (r.packages.length) console.log(`Imports packages: ${r.packages.join(', ')} (install any this game lacks)`);
      console.log(`Read ${where}/README.md first: why it works, the knobs, the cost, and how to adapt it to this game's look.`);
      return 0;
    }
    const near = closest(sub ?? '', ['list', 'pull']);
    console.error(`Usage: threedog examples list · threedog examples pull <name> [--out dir] [--force]${sub ? ` (unknown "${sub}"${near ? `; did you mean ${near}?` : ''})` : ''}`);
    return 1;
  } catch (e) { console.error(e.message); return 1; }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)));

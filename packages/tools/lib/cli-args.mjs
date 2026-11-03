// Option parsing shared by the CLI tools that take a page path and --options (shot, capture, gallery; the bridge's --page uses pagePath):
// one place decides what a page argument is and which options exist, so an unknown option fails instead of being stored and ignored.
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { closest } from './text.mjs';

/**
 * A page path as typed. Git Bash (MSYS) rewrites an argument that starts with "/" into a path under the Git install ("/" -> "C:/Git/",
 * "/styletest.html" -> "C:/Program Files/Git/styletest.html"), and the tool then asked the browser for "http://127.0.0.1:5173C:/Git/".
 * A page path is never a drive path, so the rewrite is undone: the Git root is the folder holding usr/bin/msys-2.0.dll, the rest is the page.
 * The same happens through `npm run shot -- /` (npm echoes `> threedog shot C:/Git/`; the tool still opens /). Git Bash also names its root in
 * EXEPATH (`C:\Git\bin`) for every program it starts, npm's children included: that prefix is undone first, so a root whose dll sits elsewhere works too.
 * @param {string} arg @param {{ exists?: (p: string) => boolean, env?: Record<string, string | undefined> }} [io] @returns {string}
 */
export function pagePath(arg, { exists = existsSync, env = process.env } = {}) {
  if (!/^[A-Za-z]:[\\/]/.test(arg)) return arg;
  const q = arg.indexOf('?'), path = (q < 0 ? arg : arg.slice(0, q)).replace(/\\/g, '/'), query = q < 0 ? '' : arg.slice(q);
  const root = env.MSYSTEM && env.EXEPATH ? dirname(env.EXEPATH.replace(/\\/g, '/')).replace(/\/+$/, '').toLowerCase() : '';
  if (root.includes('/') && (path.toLowerCase() === root || path.toLowerCase().startsWith(root + '/'))) return (path.slice(root.length) || '/') + query;
  for (let d = path.replace(/\/+$/, ''); d.includes('/'); d = d.slice(0, d.lastIndexOf('/'))) {
    if (exists(d + '/usr/bin/msys-2.0.dll')) return (path.slice(d.length) || '/') + query;
  }
  throw new Error(`"${arg}" is a Windows path, not a page path (Git Bash rewrites an argument that starts with "/"). ` +
    'Write the page without the slash (`shot styletest`, `shot "?time=18:00"`), set MSYS_NO_PATHCONV=1, or run the command from PowerShell');
}

/**
 * The one argument parser of every command (paths.mjs command() adds the workspace on top). Strict on purpose: most commands used to look up
 * the switches they knew with argv.includes and drop the rest, so a typo (`--verbos`, `--only world` where `--only=world` was meant) ran the
 * command the default way and reported success.
 *   flags      switches, never take a value (so `--look /page` keeps /page as the page)
 *   values     options that take one (`--out x` or `--out=x`); given twice is an error (the second used to replace the first silently)
 *   lists      of those values, the ones that may repeat: `--rule R10 --rule R2` comes back as 'R10,R2' (the command splits on commas)
 *   short      one-letter spellings: { j: 'jobs' } makes `-j 4` / `-j4` mean `--jobs 4`
 *   page       the default page when the command takes one page path; null (the default) when it takes none
 *   positional true: the command takes any number of plain arguments (test names, words, a subcommand's names), returned in `rest`
 *   workspace  true: -w / --workspace <name> is accepted and returned as `workspace` (paths.mjs command() resolves it)
 *   conflicts  [a, b, why] pairs where b switches a off (shot: --ref with --no-look), so a given a would silently do nothing
 *   passthrough  true (with positional): unknown --options land in `rest` unchanged for a sub-parser (the dev bridge commands only)
 * Everything after a bare `--` is positional. Throws on an unknown option (naming the closest known one and listing all), a missing value, a
 * value option given twice (unless in lists), a plain argument where none is taken, a second page argument (it used to replace the first), or a conflicting pair.
 * @param {string[]} args
 * @param {{ flags?: string[], values?: string[], lists?: string[], short?: Record<string, string>, page?: string | null, positional?: boolean, workspace?: boolean,
 *   conflicts?: [string, string, string][] }} spec
 * @returns {{ page: string | null, pageArg: string | null, opt: Record<string, string | true>, rest: string[], workspace?: string }}
 */
export function parseOptions(args, { flags = [], values = [], lists = [], short = {}, page: def = null, positional = false, workspace = false, passthrough = false, conflicts = [] } = {}) {
  const opt = {}, rest = [], known = [...flags, ...values, ...(workspace ? ['workspace'] : [])];
  const shorts = { ...short, ...(workspace ? { w: 'workspace' } : {}) };
  const list = () => [...known.map(o => '--' + o), ...Object.entries(shorts).map(([s, l]) => `-${s} (--${l})`)].join(' ') || '(none)';
  let page = def, given = null, ws;
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    if (a === '--') { for (const p of args.slice(i + 1)) plain(p); break; }
    // -j4 / -j 4 / -w game: a one-letter spelling stands for its long option
    if (/^-[A-Za-z]/.test(a) && !a.startsWith('--')) {
      const long = shorts[a[1]];
      if (!long && passthrough) { rest.push(a); continue; }
      if (!long) throw new Error(`unknown option ${a}${a.length === 2 ? '' : ` (a one-letter option takes one dash and one letter)`}; options: ${list()}`);
      a = a.length > 2 ? `--${long}=${a.slice(2)}` : `--${long}`;
    }
    if (!a.startsWith('--')) { plain(a); continue; }
    const eq = a.indexOf('='), k = a.slice(2, eq < 0 ? undefined : eq);
    if (!known.includes(k)) {
      // passthrough: the dev bridge takes -w / --page / --json here and hands the rest to the command it names, which reads its own options
      if (passthrough) { rest.push(args[i]); continue; }
      const near = closest(k, known);
      throw new Error(`unknown option --${k}${near ? `; did you mean --${near}?` : ''} (options: ${list()})`);
    }
    if (flags.includes(k)) { if (eq >= 0) throw new Error(`--${k} is a switch and takes no value`); opt[k] = true; continue; }
    const v = eq >= 0 ? a.slice(eq + 1) : args[i + 1];
    if (v === undefined || v === '' || (eq < 0 && v.startsWith('--'))) throw new Error(`--${k} needs a value`);
    if (eq < 0) i++;
    if (k === 'workspace') { if (ws !== undefined) throw new Error(`-w / --workspace given twice ("${ws}" and "${v}"): one workspace per run`); ws = v; }
    else if (k in opt && lists.includes(k)) opt[k] += `,${v}`;
    else if (k in opt) throw new Error(`--${k} given twice ("${opt[k]}" and "${v}"): it takes one value`);
    else opt[k] = v;
  }
  function plain(a) {
    if (positional) { rest.push(a); return; }
    if (def === null) throw new Error(`unexpected argument "${a}": this command takes only options (${list()})`);
    if (given !== null) throw new Error(`one page argument only: got "${given}" and "${a}" (options start with --)`);
    given = a; page = pagePath(a);
  }
  for (const [a, b, why] of conflicts) if (a in opt && b in opt) throw new Error(`--${a} does nothing with --${b}: ${why}; drop one of them`);
  return { page, pageArg: given, opt, rest, ...(ws !== undefined ? { workspace: ws } : {}) };
}

/** A whole number option (`--jobs 4`, `--frames 60`): undefined when not given; throws naming the option when it is not one >= min */
export function intOption(opt, name, min = 1) {
  if (opt[name] === undefined) return undefined;
  const n = Number(opt[name]);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name}: "${opt[name]}" is not a whole number of ${min} or more`);
  return n;
}

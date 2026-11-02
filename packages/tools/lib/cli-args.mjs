// Option parsing shared by the CLI tools that take a page path and --options (shot, capture, gallery; the bridge's --page uses pagePath):
// one place decides what a page argument is and which options exist, so an unknown option fails instead of being stored and ignored.
import { existsSync } from 'node:fs';
import { closest } from './text.mjs';

/**
 * A page path as typed. Git Bash (MSYS) rewrites an argument that starts with "/" into a path under the Git install ("/" -> "C:/Git/",
 * "/styletest.html" -> "C:/Program Files/Git/styletest.html"), and the tool then asked the browser for "http://127.0.0.1:5173C:/Git/".
 * A page path is never a drive path, so the rewrite is undone: the Git root is the folder holding usr/bin/msys-2.0.dll, the rest is the page.
 * @param {string} arg @param {{ exists?: (p: string) => boolean }} [io] @returns {string}
 */
export function pagePath(arg, { exists = existsSync } = {}) {
  if (!/^[A-Za-z]:[\\/]/.test(arg)) return arg;
  const q = arg.indexOf('?'), path = (q < 0 ? arg : arg.slice(0, q)).replace(/\\/g, '/'), query = q < 0 ? '' : arg.slice(q);
  for (let d = path.replace(/\/+$/, ''); d.includes('/'); d = d.slice(0, d.lastIndexOf('/'))) {
    if (exists(d + '/usr/bin/msys-2.0.dll')) return (path.slice(d.length) || '/') + query;
  }
  throw new Error(`"${arg}" is a Windows path, not a page path (Git Bash rewrites an argument that starts with "/"). ` +
    'Write the page without the slash (`shot styletest`, `shot "?time=18:00"`), set MSYS_NO_PATHCONV=1, or run the command from PowerShell');
}

/**
 * argv (after pickWorkspace took -w out) -> { page, opt }. flags: switches, never take a value (so `--look /page` keeps /page as the page);
 * values: options that take one (`--out x` or `--out=x`). page: the default page, or null when the command takes no page argument.
 * conflicts: [a, b, why] pairs where b switches a off (shot: --ref with --no-look), so a given a would silently do nothing.
 * Throws on an unknown option (naming the closest known one), a missing value, a page argument where none is taken, a second page argument
 * (it used to replace the first), or a conflicting pair.
 * @param {string[]} args @param {{ flags?: string[], values?: string[], page?: string | null, conflicts?: [string, string, string][] }} spec
 */
export function parseOptions(args, { flags = [], values = [], page: def = '/', conflicts = [] } = {}) {
  const opt = {}, known = [...flags, ...values];
  let page = def, given = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      if (def === null) throw new Error(`unexpected argument "${a}": this command takes no page, only options (${known.map(o => '--' + o).join(' ')})`);
      if (given !== null) throw new Error(`one page argument only: got "${given}" and "${a}" (options start with --)`);
      given = a; page = pagePath(a); continue;
    }
    const eq = a.indexOf('='), k = a.slice(2, eq < 0 ? undefined : eq);
    if (!known.includes(k)) {
      const near = closest(k, known);
      throw new Error(`unknown option --${k}${near ? `; did you mean --${near}?` : ''} (options: ${known.map(o => '--' + o).join(' ')})`);
    }
    if (flags.includes(k)) { if (eq >= 0) throw new Error(`--${k} is a switch and takes no value`); opt[k] = true; continue; }
    const v = eq >= 0 ? a.slice(eq + 1) : args[i + 1];
    if (v === undefined || v === '' || (eq < 0 && v.startsWith('--'))) throw new Error(`--${k} needs a value`);
    opt[k] = v; if (eq < 0) i++;
  }
  for (const [a, b, why] of conflicts) if (a in opt && b in opt) throw new Error(`--${a} does nothing with --${b}: ${why}; drop one of them`);
  return { page, opt };
}

/** parseOptions for a script's top level: prints `✗ <reason>` and exits 1 instead of a stack trace */
export function cliOptions(args, spec) {
  try { return parseOptions(args, spec); } catch (e) { console.error('✗ ' + e.message); process.exit(1); }
}

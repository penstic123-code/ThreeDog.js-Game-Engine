// Text helpers for the game map generator (used by packages/tools/gamemap.mjs): table cells, truncation, row caps. The source helpers
// (summary, bracket pairing, argument splitting) come from lib/text.mjs.
import { join } from 'node:path';
import { read, uniq, balanced, balancedAll, splitTop, noComments } from '../lib/text.mjs';
import { ENGINE } from '../paths.mjs';
export { read, uniq, summary, balanced, balancedAll, splitTop, noComments } from '../lib/text.mjs';

export const MAX_ROWS = 12;
export const cell = s => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
export const cut = (s, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// If a list is too long, truncate it and say so
export const capped = (rows, file) => rows.length > MAX_ROWS ? [...rows.slice(0, MAX_ROWS), `- …${rows.length - MAX_ROWS} more, see ${file}`] : rows;

/** Module names in openWorld's return list: part('collision') entries and direct calls; the camera is a variable (cam), so it is not listed */
const presetParts = body => [...(balanced(body, 'return [') || '').matchAll(/part\('(\w+)'\)|(\w+)\(/g)].map(x => x[1] ?? x[2]).filter(x => !['part', 'filter',
  'on'].includes(x));
/** The modules an openWorld(args) call installs: the preset's list without the ones args turn off */
export const openWorldModules = args => {
  const src = read(join(ENGINE, 'index.js')), off = [...args.matchAll(/(\w+): false/g)].map(x => x[1]);
  return uniq(presetParts(src.slice(src.indexOf('export function openWorld(')))).filter(x => !off.includes(x));
};
/** The module functions a game's code installs: each engine.use argument, openWorld opened into its parts. The game map and threedog how both read this list */
export const installedCalls = code => uniq(balancedAll(noComments(code), 'engine.use(').flatMap(u => splitTop(u.body)).flatMap(arg => {
  const fn = arg.match(/^(\w+)\(/)?.[1];
  if (fn !== 'openWorld') return fn ? [fn] : [];
  return ['openWorld', ...openWorldModules(arg)];
}));

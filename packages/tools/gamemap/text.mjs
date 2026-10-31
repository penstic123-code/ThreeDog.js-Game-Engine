// Text helpers for the game map generator (used by packages/tools/gamemap.mjs): table cells, truncation, row caps. The source helpers
// (summary, bracket pairing, argument splitting, walk) come from lib/text.mjs.
import { walk as walkAll } from '../lib/text.mjs';
export { read, uniq, summary, balanced, balancedAll, splitTop } from '../lib/text.mjs';

export const MAX_ROWS = 12;
// Things in a game folder that are not game code: tests and the vite config (plus the shared SKIP_DIRS)
export const walk = d => walkAll(d, { exts: /\.js$/, skip: ['tests', 'vite.config.js'] });
export const cell = s => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
export const cut = (s, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const noComments = t => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
// If a list is too long, truncate it and say so
export const capped = (rows, file) => rows.length > MAX_ROWS ? [...rows.slice(0, MAX_ROWS), `- …${rows.length - MAX_ROWS} more, see ${file}`] : rows;

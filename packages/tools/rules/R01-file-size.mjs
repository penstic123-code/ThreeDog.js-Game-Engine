// R1 file size: a file that is too big costs the AI a lot of context to read, and usually means mixed responsibilities.
// Criteria (any one → warning): over 400 lines; over 16KB (UTF-8 bytes); more than 10 lines longer than 160 characters (stops code from being crammed into long lines to dodge the line limit).
// Game code (games/*, the new-game templates; in a game installed from npm, the game folders), .js .mjs .html: over 600 lines or 24KB is an error
//       (split the file by system); 400-600 lines or 16-24KB stays a warning. Engine thresholds are unchanged.
// Scope: .js .mjs .d.ts .html under packages/engine/ (source, types, styles, examples, tests, the root index.js index.d.ts and pages), packages/tools/, games/,
//       plus the hand-written .md under packages/engine/docs/ (directory list in paths.mjs).
import { walk, read, rel, GENERATED, reE, P } from './_lib.mjs';

const MAX_LINES = 400, MAX_BYTES = 16 * 1024, LONG = 160, MAX_LONG = 10;
const GAME_MAX_LINES = 600, GAME_MAX_BYTES = 24 * 1024;   // game code: above these it is an error
const GAME_EXTS = ['.js', '.mjs', '.html'];
const isGame = f => P.under(f, P.GAMES_REL) || P.under(f, `${P.TOOLS_REL}/templates`) || P.MODE === 'game';
// Exempt from line and byte limits only (long lines are still checked): [path regex, reason]
const ALLOW_SIZE = [
  [reE('(index\\.d\\.ts|types\\/[^/]+\\.d\\.ts)$'), 'API declarations (d.ts): the AI reads the generated packages/engine/docs/api/<module>.md (one module per page), not the d.ts itself; ' +
    'grouped by domain (core / world / gameplay / physics) so types can reference each other and npm run types can check them all; splitting into small files only adds imports without saving context'],
  [reE('docs\\/AI\\.md$'), 'the AI index: one row per task; R22 caps its size at 20KB (an index grows with the engine, the recipes it points to stay small)'],
];
// Allowlist (path regex + reason)
const ALLOW = [
  [reE('tests\\/fixtures\\/'), 'test fixtures (generated or binary data)'],
  [reE('tests\\/specs(\\.mjs|\\/)'), 'test lists are stacked by feature; their size does not hurt engine readability'],
  ...GENERATED.map(r => [r, 'generated docs, not edited by hand']),
];

export default {
  id: 'R1', title: 'File size', game: true,
  run() {
    const out = [];
    const files = P.MODE === 'game' ? [...new Set(P.gameDirs().flatMap(d => walk(rel(d) || '.', GAME_EXTS)))] : [P.INDEX_JS_REL, P.INDEX_DTS_REL, ...[P.TYPES_REL, ...P.SOURCE_DIRS_REL].flatMap(d => walk(d, ['.js', '.mjs', '.d.ts', '.html'])), ...walk(P.DOCS_REL, ['.md'])];
    for (const f of files) {
      if (ALLOW.some(([r]) => r.test(f))) continue;
      const text = read(f), L = text.split('\n');
      const bytes = Buffer.byteLength(text), long = L.filter(l => l.length > LONG).length;
      const why = [];
      const sizeOk = ALLOW_SIZE.some(([r]) => r.test(f));
      if (isGame(f) && GAME_EXTS.some(x => f.endsWith(x)) && (L.length > GAME_MAX_LINES || bytes > GAME_MAX_BYTES)) {
        const big = [L.length > GAME_MAX_LINES && `${L.length} lines (limit ${GAME_MAX_LINES})`, bytes > GAME_MAX_BYTES && `${(bytes / 1024).toFixed(1)}KB (limit 24KB)`].filter(Boolean);
        out.push({ level: 'error', file: f, line: 0, msg: `game file too large: ${big.join(', ')}`, fix: 'split this file by system (one system per file: combat.js, ui.js, saves.js…; content data in content/), and import them from main.js' });
        continue;
      }
      if (!sizeOk && L.length > MAX_LINES) why.push(`${L.length} lines (limit ${MAX_LINES})`);
      if (!sizeOk && bytes > MAX_BYTES) why.push(`${(bytes / 1024).toFixed(1)}KB (limit 16KB)`);
      if (long > MAX_LONG) why.push(`${long} lines over ${LONG} characters (limit ${MAX_LONG} lines)`);
      if (why.length) out.push({ level: 'warn', file: f, line: 0, msg: `file too large: ${why.join(', ')}`, fix: 'split by responsibility (one thing per file); break long lines up instead of cramming logic into one line' });
    }
    return out;
  },
};

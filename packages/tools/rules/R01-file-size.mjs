// R1 file size: a file that is too big costs the AI a lot of context to read, and usually means mixed responsibilities.
// Criteria (any one → warning): over 400 lines; over 16KB (UTF-8 bytes); more than 10 lines longer than 160 characters (stops code from being crammed into long lines to dodge the line limit).
// Scope: .js .mjs .d.ts .html under packages/engine/ (source, types, styles, examples, tests, the root index.js index.d.ts and pages), packages/tools/, games/,
//       plus the hand-written .md under packages/engine/docs/ (directory list in paths.mjs).
import { walk, read, GENERATED, reE, P } from './_lib.mjs';

const MAX_LINES = 400, MAX_BYTES = 16 * 1024, LONG = 160, MAX_LONG = 10;
// Exempt from line and byte limits only (long lines are still checked): [path regex, reason]
const ALLOW_SIZE = [
  [reE('(index\\.d\\.ts|types\\/[^/]+\\.d\\.ts)$'), 'API declarations (d.ts): the AI reads the generated packages/engine/docs/api/<module>.md (one module per page), not the d.ts itself; ' +
    'grouped by domain (core / world / gameplay / physics) so types can reference each other and npm run types can check them all; splitting into small files only adds imports without saving context'],
];
// Allowlist (path regex + reason)
const ALLOW = [
  [reE('tests\\/fixtures\\/'), 'test fixtures (generated or binary data)'],
  [reE('tests\\/specs(\\.mjs|\\/)'), 'test lists are stacked by feature; their size does not hurt engine readability'],
  ...GENERATED.map(r => [r, 'generated docs, not edited by hand']),
];

export default {
  id: 'R1', title: 'File size',
  run() {
    const out = [];
    const files = [P.INDEX_JS_REL, P.INDEX_DTS_REL, ...[P.TYPES_REL, ...P.SOURCE_DIRS_REL].flatMap(d => walk(d, ['.js', '.mjs', '.d.ts', '.html'])), ...walk(P.DOCS_REL, ['.md'])];
    for (const f of files) {
      if (ALLOW.some(([r]) => r.test(f))) continue;
      const text = read(f), L = text.split('\n');
      const bytes = Buffer.byteLength(text), long = L.filter(l => l.length > LONG).length;
      const why = [];
      const sizeOk = ALLOW_SIZE.some(([r]) => r.test(f));
      if (!sizeOk && L.length > MAX_LINES) why.push(`${L.length} lines (limit ${MAX_LINES})`);
      if (!sizeOk && bytes > MAX_BYTES) why.push(`${(bytes / 1024).toFixed(1)}KB (limit 16KB)`);
      if (long > MAX_LONG) why.push(`${long} lines over ${LONG} characters (limit ${MAX_LONG} lines)`);
      if (why.length) out.push({ level: 'warn', file: f, line: 0, msg: `file too large: ${why.join(', ')}`, fix: 'split by responsibility (one thing per file); break long lines up instead of cramming logic into one line' });
    }
    return out;
  },
};

// The public surface an AI meets may only grow on purpose: the count from `threedog api-count` must stay within MARGIN of the total recorded in
// docs/testing/api-count.md. Growing past it fails until the record is updated (new numbers and why), so every bigger API is a decision.
// Shrinking never fails (lower the record when you delete). Offline: reads the type declarations and sources only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../paths.mjs';
import { apiCount, GROUPS } from '../api-count.mjs';

export const name = 'api count: the public surface stays within the margin of the total recorded in docs/testing/api-count.md';

/** How many items may be added before the record must be updated (a few new options or methods; a new module is bigger and gets recorded) */
export const MARGIN = 30;
const RECORD = 'docs/testing/api-count.md';

export async function run({ check }) {
  const r = await apiCount();
  const doc = readFileSync(join(ROOT, RECORD), 'utf8'), recorded = Number(/<!-- api-count total: (\d+) -->/.exec(doc)?.[1]);
  const line = GROUPS.map(g => `${g} ${r.groups[g].total}`).join(' · ');
  check(`${RECORD} records a total (<!-- api-count total: N -->)`, recorded > 0, doc.slice(0, 200));
  check('every group has items (a group read as 0 means the reader broke, not that the API shrank)', GROUPS.every(g => r.groups[g].total > 0), line);
  check(`[guard] total ${r.total} (recorded ${recorded}, unused ${r.unusedTotal}) is at most recorded + ${MARGIN}; over it: update ${RECORD} with the new numbers and why`,
    r.total <= recorded + MARGIN, line);
}

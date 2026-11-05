// A spec that gains a screenshot leaves the GPU without asking: the runner must say so, and the way out must exist.
// Why: a real-time flight test went from passing to "timed out" on software rendering; nothing tied the timeout to the screenshot (14 minutes lost).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../paths.mjs';
import { needsSoftware, softwareWhy } from '../lib/specs.mjs';

export const name = 'test runner: a spec moved to software rendering by a pixel read is told why and how to stay on the GPU';

export async function run({ check }) {
  const shot = { async run({ page }) { await page.screenshot(); } };
  const why = softwareWhy(shot) ?? '';
  check('[guard] a screenshot in run() moves the spec, and the reason names the read and software: false', needsSoftware(shot) && /page\.screenshot/.test(why) && /software: false/.test(why), why);
  check('[guard] software: false keeps a screenshot on the GPU, with nothing to explain', !needsSoftware({ ...shot, software: false }) && softwareWhy({ ...shot, software: false }) === null);
  check('a spec that asked for software, or reads no pixels, gets no note', softwareWhy({ ...shot, software: true }) === null && softwareWhy({ async run() {} }) === null);
  const src = readFileSync(join(TOOLS, 'run.mjs'), 'utf8');
  check('[guard] the runner says it before the run and again on a timeout', (src.match(/softwareWhy\(/g) ?? []).length === 2 && /timed out.*softwareWhy\(spec\)/.test(src), 'run.mjs');
}

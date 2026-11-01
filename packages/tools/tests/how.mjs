// threedog how "<task>": keyword search over AI.md rows and recipe headings (how.mjs), offline, no browser.
// Why a unit test: the ranking must be deterministic and must not match inside other words ("rain" in "terrain"), or the top hit sends an AI to the wrong recipe.
import { join } from 'node:path';
import { ENGINE } from '../paths.mjs';
import { search, queryTokens } from '../how.mjs';

export const name = 'how: offline doc search is deterministic, matches word starts only, maps Chinese task words to the docs\' English';

export async function run({ check }) {
  const docs = join(ENGINE, 'docs');
  const rain = search(docs, 'rain'), again = search(docs, 'rain');
  check('"rain" finds the weather recipe first and never terrain', /weather/.test(rain[0]?.line ?? '') && !rain.some(h => /28-terrain/.test(h.line)), JSON.stringify(rain.map(h => h.line)));
  check('same query twice gives the same list', JSON.stringify(rain) === JSON.stringify(again));
  check('a hit names a recipe path or an AI.md row, at most 5', rain.length <= 5 && rain.every(h => /recipes\/|AI\.md/.test(h.line)));
  check('Chinese words add English tokens (下雨 -> rain, weather)', queryTokens('下雨').extra.includes('rain') && search(docs, '下雨').length > 0);
  check('nonsense gives no hit', search(docs, 'qqzzxx').length === 0);
}

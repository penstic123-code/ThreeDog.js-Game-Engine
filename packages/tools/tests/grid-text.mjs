// Every failure code the grid module returns has player text grid.<code> in both default languages, registered on install.
// 为什么：recipe 让游戏写 engine.t('grid.' + r.code)，但引擎没有这些键，一次试玩里玩家看到的是 [unknown-name]。新加一个失败码而没加文字，这里会红。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';

export const name = 'grid text: every built-in grid failure code has grid.<code> text (zh-CN, en), registered by grids() install';

export async function run({ check }) {
  const dir = join(ENGINE, 'modules', 'grid');
  const src = readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'strings.js').map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
  // literal codes: { code: 'x' }, code = 'x', failure('x'), and the plain strings a can() returns (return 'x', cond ? 'x' : ...)
  const codes = new Set([...src.matchAll(/code(?::| =) '([a-zA-Z]+)'|failure\('([a-zA-Z]+)'\)|return '([a-zA-Z]+)'|\? '([a-zA-Z]+)' :/g)].map(m => m.slice(1).find(Boolean)));
  codes.delete('not');   // 'not' + Field: a layer rule's code (notTilled), named by the game, so its text is the game's
  const { STRINGS } = await import(pathToFileURL(join(dir, 'strings.js')).href);
  check('the scan found the built-in codes', ['outOfBounds', 'occupied', 'noGrid', 'notPlaced', 'noTarget'].every(c => codes.has(c)), [...codes].join(', '));
  for (const lang of ['zh-CN', 'en']) {
    const missing = [...codes].filter(c => !STRINGS[lang]?.['grid.' + c]);
    check(`${lang}: grid.<code> text for every code`, !missing.length, missing.join(', '));
  }
  check('grids() install registers the table (one place, not per helper)', /e\.i18n\.add\(TEXT\)/.test(readFileSync(join(dir, 'index.js'), 'utf8')) && !/i18n\.add/.test(readFileSync(join(dir, 'preview.js'), 'utf8')));
}

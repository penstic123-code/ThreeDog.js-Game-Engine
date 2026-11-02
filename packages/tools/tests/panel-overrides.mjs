// The dev panel's export format (panel/overrides.js, pure functions): colors print as 0xrrggbb, numbers at 3 decimals, keys quoted when needed.
import { literal, putAt, hexOf, numOf } from '../panel/overrides.js';

export const name = 'panel overrides: the exported style literal (0xrrggbb colors, 3-decimal numbers, quoted keys) evaluates as JS';

export async function run({ check }) {
  const o = {}; putAt(o, ['palette', 'pine'], 0xa07a2e); putAt(o, ['exposure'], 1.23456); putAt(o, ['ui', 'accent'], '#7fd3ff'); putAt(o, ['sky', 'environment'], null); putAt(o, ['a-b', 'c'], 1);
  const src = literal(o, new Set(['palette.pine']));
  check('color 0xa07a2e, number 1.235, quoted string, null, a hyphenated key quoted', src.includes('pine: 0xa07a2e,') && src.includes('exposure: 1.235,') && src.includes('accent: "#7fd3ff",') && src.includes('environment: null,') && src.includes('"a-b": {'), src);
  check('evaluates as JS', new Function('return ' + src)().palette.pine === 0xa07a2e, src);
  check('hexOf / numOf invert each other, an rgba string passes through', numOf(hexOf(0x95c45e)) === 0x95c45e && numOf('rgba(1,2,3,.5)') === 'rgba(1,2,3,.5)');
}

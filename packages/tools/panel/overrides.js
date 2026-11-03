// What the style workbench exports: the values the user changed, as a plain object literal to paste into `style: [myStyle, { ... }]`.
// Pure functions (no DOM, no engine) so a test can run them on their own.

/** Set a value at a path of keys inside a nested plain object, creating the objects on the way */
export function putAt(obj, path, value) {
  let o = obj;
  for (const k of path.slice(0, -1)) o = o[k] ??= {};
  o[path.at(-1)] = value;
}

/** '#rrggbb' <-> 0xrrggbb (the pack's color form); other strings (rgba(...)) pass through */
export const hexOf = n => '#' + n.toString(16).padStart(6, '0');
export const numOf = s => (/^#[0-9a-f]{6}$/i.test(s) ? parseInt(s.slice(1), 16) : s);

/**
 * Object literal source of the changes. A number under a key listed in `colors` (dotted paths such as 'palette.pine') prints as 0xrrggbb,
 * other numbers as they are rounded to 3 decimals, strings quoted.
 * @param {Record<string, any>} obj @param {Set<string>} [colors] @param {string} [prefix] @param {number} [depth]
 */
export function literal(obj, colors = new Set(), prefix = '', depth = 0) {
  const pad = '  '.repeat(depth + 1), keys = Object.keys(obj);
  if (!keys.length) return '{}';
  const rows = keys.map(k => {
    const v = obj[k], path = prefix ? `${prefix}.${k}` : k, name = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
    let src;
    if (v === null) src = 'null';
    else if (typeof v === 'object') src = literal(v, colors, path, depth + 1);
    else if (typeof v === 'number') src = colors.has(path) ? '0x' + v.toString(16).padStart(6, '0') : String(+v.toFixed(3));
    else src = JSON.stringify(v);
    return `${pad}${name}: ${src},`;
  });
  return `{\n${rows.join('\n')}\n${'  '.repeat(depth)}}`;
}

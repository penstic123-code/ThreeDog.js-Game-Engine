// File name and place of a `threedog shot` picture (shot.mjs): page, query and options joined with '_', only [\w,.-] kept.
// Never starts with '-' (or '.'): a name like "-grain-0_view-ref.png" reads as an option to every CLI it is handed to (style compare, rm, git),
// which is how a page with only query parameters (/?grain=0&view=ref) used to come out. The page part is 'main' when the path is just '/'.
import { join, resolve } from 'node:path';

/** @param {string} url page path with optional query @param {Record<string, any>} opt shot options @param {number} wait @returns {string} */
export function shotName(url, opt, wait) {
  const [path, query = ''] = url.split('?');
  const page = path.replace(/^\/+/, '').replace(/\.html$/, '') || 'main';
  return [page, query, opt.time && 't' + String(opt.time).replace(':', ''), opt.weather, opt.pos && 'pos' + opt.pos, opt.view && 'view-' + opt.view, 'w' + wait]
    .filter(Boolean).join('_').replace(/[^\w,.-]+/g, '-').replace(/^[-.]+/, '') || 'main';
}

/**
 * Where a shot is written. --out with a bare file name goes into <workspace>/.threedog/shots/ like a generated name (why: `--out day.png` used to
 * land in the game root and nearly got committed); a path with a directory (./x.png, out/x.png, absolute) is kept as given, against the current directory.
 * @param {string} dir workspace @param {string | undefined} out the --out value (.png added if missing) @param {string} generated shotName(...) @param {string} [stamp] --keep suffix
 */
export function shotFile(dir, out, generated, stamp = '') {
  if (!out) return join(dir, '.threedog', 'shots', `${generated}${stamp}.png`);
  const f = String(out).replace(/(\.png)?$/i, stamp + '.png');
  return /[\\/]/.test(f) ? resolve(f) : join(dir, '.threedog', 'shots', f);
}

/**
 * The --size value of shot / capture as [width, height] (default 960x540). Why it throws: '1280X720' or '1280' split into NaN, and the browser
 * then failed on the viewport with a message that named neither the option nor the form.
 * @param {string | undefined} size @returns {[number, number]}
 */
export function viewSize(size) {
  const m = /^(\d+)[xX](\d+)$/.exec(String(size ?? '960x540').trim());
  if (!m || !(+m[1] > 0 && +m[2] > 0)) throw new Error(`--size ${size}: give WxH in pixels, e.g. 1280x720`);
  return [+m[1], +m[2]];
}

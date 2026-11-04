// Tools that measure pictures, for matching a reference while writing a game's picture/ code: threedog picture palette|compare
//   threedog picture palette <image> [--n 8] [--average] [--region x,y,w,h] [--ignore-ui] [--crop out.png]
//       dominant colors and light / saturation summary of a reference picture (a helper, not a decision); the output says what area was measured
//   threedog picture compare <reference> <screenshot> [--region x,y,w,h] [--json]   brightness / saturation / contrast / detail / color differences (an aid to the eye, not a score)
import { pathToFileURL } from 'node:url';
import { parseOptions } from './lib/cli-args.mjs';

const PALETTE_USAGE = 'Usage: threedog picture palette <image> [--n 8] [--average] [--region x,y,w,h] [--ignore-ui] [--crop out.png] [--json] (a path starting with - goes after --)';
const COMPARE_USAGE = 'Usage: threedog picture compare <reference> <screenshot> [--region x,y,w,h] [--ref-region x,y,w,h] [--shot-region x,y,w,h] [--out side.png] [--json]';
const USAGE = `${PALETTE_USAGE}\n${COMPARE_USAGE}`;

/** `picture palette` as text (the CLI prints it, the MCP tool returns it). Throws an Error with a readable message on bad input. */
export async function paletteText(image, { n = 8, average, ignoreUi, region, crop, json } = {}) {
  const { paletteOf } = await import('./picture/palette.mjs'), { parseRegion } = await import('./picture/pixels.mjs');
  n = Number(n);
  if (!Number.isInteger(n) || n < 2 || n > 32) throw new Error('--n must be a whole number from 2 to 32');
  const r = await paletteOf(image, n, { average, ignoreUi, region: region && parseRegion(region), crop });
  // --json is for scripts: the JSON alone, so the output parses; the summary and basis are inside it (summary, basis.text)
  if (json) return JSON.stringify(r, null, 2);
  const pc = x => (x * 100).toFixed(1).padStart(5) + '%';
  return [`${r.summary}`, `measured: ${r.basis.text}`, ...(r.average ? [`average ${r.average.hex} (hue ${r.average.hue}, saturation ${r.average.saturation}, lightness ${r.average.lightness})`] : []),
    ...r.colors.map(c => `  ${c.hex} ${pc(c.share)}  ${c.name}  hue ${c.hue} sat ${c.saturation} light ${c.lightness}${c.roles?.length ? `  roles: ${c.roles.join(', ')}` : ''}`),
    '(--json for every field)'].join('\n');
}

/**
 * Arguments after `picture <sub>` (CLI and the bridge / MCP commands share this): flags, valued options, positional paths, parsed by the one
 * strict parser (an unknown option throws naming the closest one). Everything after a bare `--` is positional, so a file name that starts
 * with '-' still works: picture compare -- -ref.png -shot.png
 */
export function pictureArgs(args) {
  const { opt, rest } = parseOptions(args, { positional: true, flags: ['json', 'average', 'ignore-ui'], values: ['n', 'region', 'ref-region', 'shot-region', 'crop', 'out'] });
  return { flag: n => opt[n.slice(2)] === true, val: n => opt[n.slice(2)], pos: rest };
}

/** `picture compare` as text; regions are "x,y,w,h" strings */
export async function compareText(reference, screenshot, { region, refRegion, shotRegion, out, json } = {}) {
  const { compareImages, formatCompare } = await import('./picture/compare.mjs'), { parseRegion } = await import('./picture/pixels.mjs');
  const reg = v => v && parseRegion(v);
  const r = await compareImages(reference, screenshot, { region: reg(region), refRegion: reg(refRegion), shotRegion: reg(shotRegion), out });
  return json ? JSON.stringify(r, null, 2) : formatCompare(r);
}

export async function main([sub, ...rest]) {
  let flag, val, pos;
  try { ({ flag, val, pos } = pictureArgs(rest)); } catch (e) { console.error(`✗ ${e.message}`); return 1; }
  const arg = pos[0];
  try {
    if (sub === 'palette') {
      if (!arg) { console.error(PALETTE_USAGE); return 1; }
      console.log(await paletteText(arg, { n: val('--n'), average: flag('--average'), ignoreUi: flag('--ignore-ui'), region: val('--region'), crop: val('--crop'), json: flag('--json') }));
      return 0;
    }
    if (sub === 'compare') {
      if (pos.length < 2) { console.error(COMPARE_USAGE); return 1; }
      console.log(await compareText(pos[0], pos[1], { region: val('--region'), refRegion: val('--ref-region'), shotRegion: val('--shot-region'), out: val('--out'), json: flag('--json') }));
      return 0;
    }
  } catch (e) { console.error(`✗ ${e.message}`); return 1; }
  console.log(USAGE);
  return sub ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(await main(process.argv.slice(2)));

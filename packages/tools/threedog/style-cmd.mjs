// style-palette / style-compare as bridge-layer commands (dispatch.mjs EXTRA), so the MCP server runs the same code as `threedog style palette|compare`.
// They read picture files only: no game, no dev server. Relative paths are taken from the game folder (the MCP server's cwd may be elsewhere).
import { resolve } from 'node:path';
import { paletteText, compareText } from '../style.mjs';

const VALUED = ['--n', '--region', '--ref-region', '--shot-region', '--crop'];

/** args like the CLI after `style palette|compare`; → { ok, text } (never throws: a bad picture or region is a ✗ line) */
export async function styleCommand(dir, cmd, args) {
  const val = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; }, flag = n => args.includes(n);
  const pos = args.filter((a, i) => !a.startsWith('-') && !VALUED.includes(args[i - 1])).map(p => resolve(dir, p));
  try {
    if (cmd === 'style-palette') {
      if (!pos[0]) throw new Error('Usage: style-palette <image> [--n 8] [--average] [--region x,y,w,h] [--ignore-ui] [--crop out.png]');
      const crop = val('--crop');
      return { ok: true, text: '✓ ' + await paletteText(pos[0], { n: val('--n'), average: flag('--average'), ignoreUi: flag('--ignore-ui'), region: val('--region'),
        crop: crop && resolve(dir, crop), json: flag('--json') }) };
    }
    if (pos.length < 2) throw new Error('Usage: style-compare <reference> <screenshot> [--region x,y,w,h] [--ref-region x,y,w,h] [--shot-region x,y,w,h] [--json]');
    return { ok: true, text: '✓ ' + await compareText(pos[0], pos[1], { region: val('--region'), refRegion: val('--ref-region'), shotRegion: val('--shot-region'), json: flag('--json') }) };
  } catch (e) { return { ok: false, text: '✗ ' + e.message }; }
}

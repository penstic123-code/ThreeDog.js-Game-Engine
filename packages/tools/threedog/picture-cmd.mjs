// picture-palette / picture-compare as bridge-layer commands (command-table.mjs EXTRA), so the MCP server runs the same code as `threedog picture palette|compare`.
// They read picture files only: no game, no dev server. Relative paths are taken from the game folder (the MCP server's cwd may be elsewhere).
import { resolve } from 'node:path';
import { paletteText, compareText, pictureArgs } from '../picture.mjs';

/** args like the CLI after `picture palette|compare`; → { ok, text } (never throws: a bad picture or region is a ✗ line) */
export async function pictureCommand(dir, cmd, args) {
  let a;
  try { a = pictureArgs(args); } catch (e) { return { ok: false, kind: 'command-error', text: '✗ ' + e.message }; }
  const { val, flag } = a, pos = a.pos.map(p => resolve(dir, p));
  const mark = flag('--json') ? '' : '✓ ';   // --json stays parseable: no status mark in front
  try {
    if (cmd === 'picture-palette') {
      if (!pos[0]) throw new Error('Usage: picture-palette <image> [--n 8] [--average] [--region x,y,w,h] [--ignore-ui] [--crop out.png]');
      const crop = val('--crop');
      return { ok: true, text: mark + await paletteText(pos[0], { n: val('--n'), average: flag('--average'), ignoreUi: flag('--ignore-ui'), region: val('--region'),
        crop: crop && resolve(dir, crop), json: flag('--json') }) };
    }
    if (pos.length < 2) throw new Error('Usage: picture-compare <reference> <screenshot> [--region x,y,w,h] [--ref-region x,y,w,h] [--shot-region x,y,w,h] [--out side.png] [--json]');
    return { ok: true, text: mark + await compareText(pos[0], pos[1], { region: val('--region'), refRegion: val('--ref-region'), shotRegion: val('--shot-region'), out: val('--out') && resolve(dir, val('--out')), json: flag('--json') }) };
  } catch (e) { return { ok: false, kind: 'command-error', text: '✗ ' + e.message }; }
}

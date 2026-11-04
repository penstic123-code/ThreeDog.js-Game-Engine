// threedog art board: every art resource of one game on one page, to see what the game uses and to talk to the AI about it.
//   threedog art board [-w game] [--out file.html] [--json] [--live] [--lib dir]
//     (default out: <game>/.threedog/art-board/index.html; --json prints the same data instead of writing a page; --lib: the library to compare with,
//      default as in `threedog lib`; --live also asks the running game, through the dev bridge, what it has really loaded: needs `npm run dev`)
// Status of each item and what the scan cannot follow: art-board-scan.mjs. The same run-time list inside a running game: `?panel=1`, folder "art" (panel/art.js).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { parseOptions } from './lib/cli-args.mjs';
import { libraryDir, gameOf } from './lib.mjs';
import { scanArt } from './art-board-scan.mjs';
import { boardPage } from './art-board-page.mjs';
import { loadedArt } from './panel/art.js';

/** The running game's own list, through the bridge. The function goes as text and reads window.engine there */
async function askRunningGame(game) {
  const { bridgeDriver } = await import('./threedog/connect.mjs');
  return bridgeDriver(game).evaluate(`() => (${loadedArt.toString()})(window.engine)`);
}

/** @param {string[]} argv arguments after `art board` @returns {Promise<number>} exit code */
export async function boardCli(argv, cwd = process.cwd()) {
  const { opt, workspace } = parseOptions(argv, { workspace: true, flags: ['json', 'live'], values: ['out', 'lib'] });
  const game = await gameOf(workspace, cwd);
  const live = opt.live ? await askRunningGame(game) : null;
  const data = await scanArt(game, { lib: libraryDir({ lib: opt.lib }), live });
  if (opt.json) { console.log(JSON.stringify(data, null, 2)); return 0; }
  const out = resolve(cwd, opt.out ?? join(game, '.threedog', 'art-board', 'index.html')), s = data.summary;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, boardPage(data, out));
  console.log(`wrote ${out}: open it in a browser
${s.total} items (${Object.entries(s.counts).map(([k, n]) => `${n} ${k}`).join(', ')}): ${s.missing.length} missing, ${s.unused.length} unused, ${s.notTraced.length} not traced`);
  for (const p of data.problems) console.log('! ' + p);
  return 0;
}

// Dev server keeps GAMEMAP.md current (vite/vite-threedog-map.js), no browser.
// Why: a stale GAMEMAP made `npm run check` fail until `threedog map` was run by hand. The fix refreshes the map while editing; check stays a pure
// comparison (a check that rewrote the file would pass on a stale commit). The guard: a watched game-file change must trigger a run, the map's own
// write and cache folders must not (they would loop), and runs never overlap.
// Run: threedog test "dev server refreshes"
import { EventEmitter } from 'node:events';
import threedogMap, { affectsMap } from '../vite/vite-threedog-map.js';

export const name = 'dev server refreshes GAMEMAP: a game file change triggers one debounced run; the map itself, caches and other folders do not';

export async function run({ check }) {
  const root = 'C:/g/farm';
  const at = rel => root + '/' + rel;
  check('content, main and html files affect the map', affectsMap(at('content/npcs.js'), root) && affectsMap(at('main.js'), root) && affectsMap(at('index.html'), root));
  check('GAMEMAP.md itself, .threedog, dist, node_modules and files outside the game do not',
    !affectsMap(at('GAMEMAP.md'), root) && !affectsMap(at('.threedog/errors.log'), root) && !affectsMap(at('dist/a.js'), root)
    && !affectsMap(at('node_modules/x/i.js'), root) && !affectsMap('C:/g/farm2/main.js', root) && !affectsMap(at('art.png'), root));

  const runs = [];
  let active = 0, overlap = false;
  const plugin = threedogMap({ force: true, delay: 20, run: async r => { runs.push(r); overlap ||= ++active > 1; await new Promise(res => setTimeout(res, 60)); active--; } });
  const watcher = new EventEmitter();
  plugin.configResolved({ root });
  plugin.configureServer({ watcher, httpServer: null });
  await new Promise(r => setTimeout(r, 200));
  check('one run at server start', runs.length === 1, String(runs.length));
  watcher.emit('change', at('content/npcs.js')); watcher.emit('change', at('content/props.js')); watcher.emit('add', at('content/quests.js'));
  watcher.emit('change', at('GAMEMAP.md')); watcher.emit('change', at('.threedog/x.json'));
  await new Promise(r => setTimeout(r, 250));
  check('a burst of game edits is one debounced run (the map file and caches ignored)', runs.length === 2, String(runs.length));
  watcher.emit('change', at('main.js'));
  await new Promise(r => setTimeout(r, 30));
  watcher.emit('change', at('main.js'));
  await new Promise(r => setTimeout(r, 300));
  check('an edit during a run schedules a further run, and runs never overlap', runs.length >= 3 && !overlap, `${runs.length} ${overlap}`);
}

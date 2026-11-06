// R20 one pathfinding core: in engine source (same files as R19), a Recast `.computePath(` or `.findStraightPath(` outside modules/nav/navPath.js, an import of './astar.js'
//   outside modules/characters/index.js / pathJob.js, and NPC movement code (modules/characters/npcSim.js, behaviors.js, NPC.js) calling the synchronous
//   `characters.findPath(` → error.
// Detection: regex over the whole file text (comments included), reported on the first matching line. Known limits: an astar import written with another
//   relative path (e.g. '../characters/astar.js') is not seen; a search reached through another name is not seen.
// Why: two A* / Recast copies drift apart, and the threads 0 / threads 2 bit-identical guarantee holds only for the one shared core; synchronous findPath
//   in NPC movement stalls the main thread instead of going through the worker lane.
// Fix: call engine.characters.findPath / findPathAsync; NPC movement uses findPathAsync.
import { read, P } from './_lib.mjs';
import { engineSource } from './R19-threads-bypass.mjs';

const M = P.MODULES_REL;
const CHECKS = [
  { re: /\.(computePath|findStraightPath)\(/, ok: f => f === `${M}/nav/navPath.js`, msg: 'Recast path search outside modules/nav/navPath.js', fix: 'query the navmesh through engine.characters.findPath / findPathAsync' },
  { re: /from '\.\/astar\.js'/, ok: f => [`${M}/characters/index.js`, `${M}/characters/pathJob.js`].includes(f), msg: 'imports astar.js', fix: 'use engine.characters.findPath / findPathAsync' },
  { re: /characters\.findPath\(/, ok: f => ![`${M}/characters/npcSim.js`, `${M}/characters/behaviors.js`, `${M}/characters/NPC.js`].includes(f), msg: 'NPC movement calls the synchronous findPath', fix: 'use engine.characters.findPathAsync' },
];

export default {
  id: 'R20', title: 'One pathfinding core, NPCs path asynchronously',
  run() {
    const out = [];
    for (const f of engineSource()) {
      let src;
      try { src = read(f); } catch { continue; }
      for (const c of CHECKS) {
        if (c.ok(f)) continue;
        const m = c.re.exec(src);
        if (m) out.push({ level: 'error', file: f, line: src.slice(0, m.index).split('\n').length, msg: c.msg, fix: c.fix });
      }
    }
    return out;
  },
};

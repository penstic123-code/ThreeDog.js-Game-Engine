// R19 workers only through engine.threads: in engine source (packages/engine: index.js, core, modules, render, ui, styles, examples, vite.config.js;
//   not tests / docs / public), `new Worker(` outside a lane factory and `.postMessage(` outside core/Threads.js / core/threadServe.js → error.
// Detection: line-based regex on raw lines, lines starting with // or * skipped. A Worker is accepted only when written as `create: () => new Worker(`
//   on the same line (the lane factory passed to engine.threads.lane). Known limits: a Worker built in a helper and returned to create is flagged
//   (inline it into create); a postMessage reached through another name (e.g. const send = w.postMessage) is not seen.
// Why: workers outside the pool bypass threads: false, the main-thread fallback and the commits rule (results that change gameplay take effect on a fixed tick),
//   so threads on / off would no longer give identical results.
// Fix: use engine.threads.lane({ create: () => new Worker(...), local }) or world.simulate(kind, { worker: true }); send messages through the lane (lane.run).
import { walk, lines, P } from './_lib.mjs';

const POOL = new Set([`${P.CORE_REL}/Threads.js`, `${P.CORE_REL}/threadServe.js`]);
export const engineSource = (exts = ['.js']) => [
  P.INDEX_JS_REL, `${P.ENGINE_REL}/vite.config.js`,
  ...[...P.ENGINE_CODE_DIRS_REL, P.STYLES_REL, ...P.ADDONS_REL, P.EXAMPLES_REL].flatMap(d => walk(d, exts)),
].filter(f => exts.some(e => f.endsWith(e)));

export default {
  id: 'R19', title: 'Workers only through engine.threads',
  run() {
    const out = [];
    for (const f of engineSource()) {
      let L;
      try { L = lines(f); } catch { continue; }   // vite.config.js may be absent
      L.forEach((l, i) => {
        if (/^\s*(\/\/|\*)/.test(l)) return;
        if (/new Worker\(/.test(l) && !/create: \(\) => new Worker\(/.test(l))
          out.push({ level: 'error', file: f, line: i + 1, msg: 'new Worker outside an engine.threads lane', fix: 'create workers only in engine.threads.lane({ create: () => new Worker(...), local }) or use world.simulate(kind, { worker: true })' });
        if (/\.postMessage\(/.test(l) && !POOL.has(f))
          out.push({ level: 'error', file: f, line: i + 1, msg: 'postMessage outside core/Threads.js', fix: 'send work through a lane (lane.run); only the pool talks to workers directly' });
      });
    }
    return out;
  },
};

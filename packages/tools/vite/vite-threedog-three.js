// The page's three.js for code that runs in a page with no import of its own: the picture probe (picture/probe.mjs) and in-page test code read
// globalThis.__threedogThree. On the dev server and in the test bundle only, never in a production build. Why a private name on the page and nothing on the
// engine: engine.THREE or window.THREE here would let a game work in dev and break in production; a game's route is import { THREE } from 'threedog'.
// Why three and not threedog: a page may load code ahead of the engine's files on purpose (tests/lifetime-before), and three has no effect on that order.
/** @returns {import('vite').Plugin} */
export default function threedogThree() {
  return {
    name: 'threedog-three',
    apply: (_, env) => env.command === 'serve' || !!process.env.THREEDOG_TEST,
    // order 'pre': the tag must be in the html before Vite processes its module scripts, or the bare import stays unresolved
    transformIndexHtml: { order: 'pre', handler: () => [{ tag: 'script', attrs: { type: 'module' }, children: `import * as THREE from 'three'; globalThis.__threedogThree = THREE;`, injectTo: 'head-prepend' }] },
  };
}

// The dev panel's build plumbing (@threedog/tools/panel, the style workbench + tune folders):
//   · 'virtual:threedog/tweakpane' is the game's own tweakpane (an optional dev package: npm i -D tweakpane), or `export const Pane = null`
//     when it is not installed, so the panel says so in the page instead of failing the import
//   · a production build replaces '@threedog/tools/panel' with a stub that only warns, so no shipped bundle contains the panel or tweakpane,
//     even when a game imports it without an import.meta.env.DEV guard. Test builds (THREEDOG_TEST) keep the real panel: tests open it.
import { join } from 'node:path';

const TWEAKPANE = 'virtual:threedog/tweakpane', NO_TWEAKPANE = '\0threedog:no-tweakpane', PANEL = '@threedog/tools/panel', STUB = '\0threedog:panel-stub';

/** @returns {import('vite').Plugin} */
export default function threedogPanel() {
  let root = process.cwd(), stub = false;
  return {
    name: 'threedog-panel',
    enforce: 'pre',
    configResolved(c) { root = c.root; stub = c.command === 'build' && !process.env.THREEDOG_TEST; },
    async resolveId(id) {
      if (id === PANEL && stub) return STUB;
      if (id !== TWEAKPANE) return null;
      return (await this.resolve('tweakpane', join(root, 'index.html'), { skipSelf: true }))?.id ?? NO_TWEAKPANE;   // resolved from the game, not from tools
    },
    load(id) {
      if (id === NO_TWEAKPANE) return 'export const Pane = null;';
      if (id === STUB) return "export async function openPanel() { console.warn('@threedog/tools/panel is a dev tool: not in a production build'); return false; }";
      return null;
    },
  };
}

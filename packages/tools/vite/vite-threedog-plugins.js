// The plugins folder (docs/plans/2026-11-03-slot-map.md section 6): a page whose folder has plugins/ gets every file in it imported before
// main.js runs, so the engine plugs them at start() with no registration line in main.js (engine.plugins, core/engine/plugins.js).
// How: transformIndexHtml adds one inline module script at the top of <head> that imports a generated module; that module imports each
// plugins/*.js and puts { files, config } on globalThis.__threedogPlugins, which engine.start() reads. Module scripts run in document order,
// so it has run before main.js calls createEngine / start.
// Why a generated module and not import.meta.glob inside the engine: the engine package must also run without Vite (node tools, tests,
// other bundlers), and the folder is the game's, next to its index.html, not the engine's.
// Order: file names sorted; plugins/plugins.json { "order": [...], "off": [...] } is passed as is (the engine checks it names real files).
// A file added or removed under plugins/ reloads the page in dev (the list of imports changed).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const PREFIX = 'virtual:threedog-plugins', RESOLVED = '\0threedog-plugins:';
const IS_PLUGIN = /^[^._].*\.(m?js|ts)$/;   // a leading _ or . keeps a helper file next to the plugins without plugging it
const slash = p => p.replace(/\\/g, '/');

export default function threedogPlugins() {
  let root = process.cwd();
  return {
    name: 'threedog-plugins',
    configResolved(c) { root = c.root; },
    // order 'pre': the tag must be in the html before Vite processes its module scripts, or the build leaves the import unresolved
    transformIndexHtml: { order: 'pre', handler(html, ctx) {
      const dir = resolve(dirname(ctx.filename), 'plugins');
      if (!existsSync(dir)) return html;
      return [{ tag: 'script', attrs: { type: 'module' }, children: `import '${PREFIX}?dir=${encodeURIComponent(slash(relative(root, dir)))}';`, injectTo: 'head-prepend' }];
    } },
    resolveId(id) {
      if (id.startsWith(PREFIX + '?dir=')) return RESOLVED + resolve(root, decodeURIComponent(id.slice(PREFIX.length + 5)));
      return null;
    },
    load(id) {
      if (!id.startsWith(RESOLVED)) return null;
      const dir = id.slice(RESOLVED.length);
      const files = existsSync(dir) ? readdirSync(dir).filter(f => IS_PLUGIN.test(f)).sort() : [];
      const cfgPath = resolve(dir, 'plugins.json');
      let config = {};
      if (existsSync(cfgPath)) {
        this.addWatchFile(cfgPath);
        try { config = JSON.parse(readFileSync(cfgPath, 'utf8')); }
        catch (err) { throw new Error(`plugins/plugins.json: ${err.message} (expected { "order": ["10-a"], "off": ["20-b"] })`); }
      }
      const imports = files.map((f, i) => `import * as p${i} from ${JSON.stringify(slash(resolve(dir, f)))};`);
      const map = files.map((f, i) => `${JSON.stringify('./plugins/' + f)}: p${i}`).join(', ');
      return `${imports.join('\n')}\nglobalThis.__threedogPlugins = { files: { ${map} }, config: ${JSON.stringify(config)} };\n`;
    },
    configureServer(server) {
      // a plugin file added or removed changes the generated import list: drop it and reload (an edited file hot-updates like any module)
      const changed = file => {
        const f = slash(file);
        if (!/\/plugins\/[^/]+$/.test(f)) return;
        for (const m of server.moduleGraph.idToModuleMap.values()) if (m.id?.startsWith(RESOLVED)) server.moduleGraph.invalidateModule(m);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', changed);
      server.watcher.on('unlink', changed);
    },
  };
}

// R21 model / texture loading only through core/assetLoad.js: in engine source (same files as R19, .js and .mjs) and games/, a direct three.js loader
//   (new GLTFLoader / TextureLoader / KTX2Loader / DRACOLoader / FBXLoader / OBJLoader / ImageBitmapLoader) or a .loadAsync( / .parseAsync( call → error;
//   so is a font added by hand (new FontFace / document.fonts.add): a font is an asset-pack entry (manifest fonts) that style.ui.fonts names.
// Detection: line-based regex on raw lines, lines starting with // or * skipped. Allowed files: core/assetLoad.js (the one download / decode entry),
//   core/Assets.js (only creates the loader instances), core/Baked.js (its parseAsync is GLTFExporter: export, not load). Known limits: a loader reached
//   through another name (const L = THREE.GLTFLoader) is not seen.
// Why: loads that skip assets._fetch are not recorded as tasks, so engine.loading (loading screen, describe "waiting for ...") cannot see them.
// Fix: load through engine.assets (model / texture / manifest); add new formats in core/assetLoad.js.
import { walk, lines, P } from './_lib.mjs';
import { engineSource } from './R19-threads-bypass.mjs';

const ALLOWED = new Set(['assetLoad.js', 'Assets.js', 'Baked.js'].map(f => `${P.CORE_REL}/${f}`));
const BYPASS = /new (GLTFLoader|TextureLoader|KTX2Loader|DRACOLoader|FBXLoader|OBJLoader|ImageBitmapLoader|FontFace)\b|\.(loadAsync|parseAsync)\(|document\.fonts\.add\(/;

export default {
  id: 'R21', title: 'Asset loading only through core/assetLoad.js',
  run() {
    const out = [];
    const exts = ['.js', '.mjs'];
    const games = walk(P.GAMES_REL, exts).filter(f => !/\/(tests|docs)\//.test(f));
    for (const f of [...engineSource(exts), ...games]) {
      if (ALLOWED.has(f)) continue;
      let L;
      try { L = lines(f); } catch { continue; }
      L.forEach((l, i) => {
        if (BYPASS.test(l) && !/^\s*(\/\/|\*)/.test(l))
          out.push({ level: 'error', file: f, line: i + 1, msg: `loads an asset around engine.assets: ${l.trim().slice(0, 80)}`, fix: 'load through engine.assets (model / texture / font / manifest) so engine.loading sees it; a font goes in manifest({ fonts }) and style.ui.fonts names it; new formats go in core/assetLoad.js' });
      });
    }
    return out;
  },
};

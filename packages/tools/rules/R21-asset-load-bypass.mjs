// R21 model / texture loading through engine.assets.
//   Engine source (same files as R19, .js and .mjs): a direct three.js loader (new GLTFLoader / TextureLoader / KTX2Loader / DRACOLoader /
//   FBXLoader / OBJLoader / ImageBitmapLoader), a .loadAsync( / .parseAsync( call or a font added by hand (new FontFace / document.fonts.add) → error.
//   Game code is not scanned: a loader there is plain three.js.
// Detection: line-based regex on raw lines, lines starting with // or * skipped. Allowed engine files: core/assets/assetLoad.js (the one download / decode
//   entry), core/assets/Assets.js (only creates the loader instances), core/assets/Baked.js (its parseAsync is GLTFExporter: export, not load). Known limits: a
//   loader reached through another name (const L = THREE.GLTFLoader) is not seen.
// Why: loads that skip assets._fetch are not recorded as tasks, so engine.loading (loading screen, describe "waiting for ...") cannot see them,
//   and the asset has no manifest name a style or a model() call can use.
// Fix: load through engine.assets (model / texture / manifest); add new formats in core/assets/assetLoad.js.
import { lines, P } from './_lib.mjs';
import { engineSource } from './R19-threads-bypass.mjs';

const ALLOWED = new Set(['assetLoad.js', 'Assets.js', 'Baked.js'].map(f => `${P.CORE_REL}/assets/${f}`));
const ENGINE_BYPASS = /new (GLTFLoader|TextureLoader|KTX2Loader|DRACOLoader|FBXLoader|OBJLoader|ImageBitmapLoader|FontFace)\b|\.(loadAsync|parseAsync)\(|document\.fonts\.add\(/;
const comment = l => /^\s*(\/\/|\*)/.test(l);

export default {
  id: 'R21', title: 'Asset loading through engine.assets',
  run() {
    const out = [];
    for (const f of engineSource(['.js', '.mjs'])) {
      if (ALLOWED.has(f)) continue;
      let L;
      try { L = lines(f); } catch { continue; }
      L.forEach((l, i) => {
        if (ENGINE_BYPASS.test(l) && !comment(l))
          out.push({ level: 'error', file: f, line: i + 1, msg: `loads an asset around engine.assets: ${l.trim().slice(0, 80)}`, fix: 'load through engine.assets (model / texture / font / manifest) so engine.loading sees it; a font goes in manifest({ fonts }) and style.ui.fonts names it; new formats go in core/assets/assetLoad.js' });
      });
    }
    return out;
  },
};

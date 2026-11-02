// R21 model / texture loading through engine.assets.
//   Engine source (same files as R19, .js and .mjs): a direct three.js loader (new GLTFLoader / TextureLoader / KTX2Loader / DRACOLoader /
//   FBXLoader / OBJLoader / ImageBitmapLoader), a .loadAsync( / .parseAsync( call or a font added by hand (new FontFace / document.fonts.add) → error.
//   Games (games/*): only the loaders whose format the asset manifest already handles (glTF / Draco, png / jpg / ktx2 / hdr textures, fonts) →
//   warning, not error: loading by hand works, it just loses names, the loading screen and describe "waiting for ...". Formats the manifest cannot
//   load (EXRLoader, RGBELoader, FontLoader typeface fonts, FBXLoader, OBJLoader, ...) and exporters (GLTFExporter.parseAsync) are plain three.js
//   and are not flagged; neither is a bare .loadAsync( in a game (the loader's `new` line says what it is).
// Detection: line-based regex on raw lines, lines starting with // or * skipped. Allowed engine files: core/assetLoad.js (the one download / decode
//   entry), core/Assets.js (only creates the loader instances), core/Baked.js (its parseAsync is GLTFExporter: export, not load). Known limits: a
//   loader reached through another name (const L = THREE.GLTFLoader) is not seen.
// Why: loads that skip assets._fetch are not recorded as tasks, so engine.loading (loading screen, describe "waiting for ...") cannot see them,
//   and the asset has no manifest name a style or a model() call can use.
// Fix: load through engine.assets (model / texture / manifest); add new formats in core/assetLoad.js.
import { walk, lines, P } from './_lib.mjs';
import { engineSource } from './R19-threads-bypass.mjs';

const ALLOWED = new Set(['assetLoad.js', 'Assets.js', 'Baked.js'].map(f => `${P.CORE_REL}/${f}`));
const ENGINE_BYPASS = /new (GLTFLoader|TextureLoader|KTX2Loader|DRACOLoader|FBXLoader|OBJLoader|ImageBitmapLoader|FontFace)\b|\.(loadAsync|parseAsync)\(|document\.fonts\.add\(/;
const GAME_BYPASS = /new (GLTFLoader|TextureLoader|KTX2Loader|DRACOLoader|HDRLoader|ImageBitmapLoader|FontFace)\b|document\.fonts\.add\(/;
const comment = l => /^\s*(\/\/|\*)/.test(l);

export default {
  id: 'R21', title: 'Asset loading through engine.assets',
  run() {
    const out = [];
    const exts = ['.js', '.mjs'];
    for (const f of engineSource(exts)) {
      if (ALLOWED.has(f)) continue;
      let L;
      try { L = lines(f); } catch { continue; }
      L.forEach((l, i) => {
        if (ENGINE_BYPASS.test(l) && !comment(l))
          out.push({ level: 'error', file: f, line: i + 1, msg: `loads an asset around engine.assets: ${l.trim().slice(0, 80)}`, fix: 'load through engine.assets (model / texture / font / manifest) so engine.loading sees it; a font goes in manifest({ fonts }) and style.ui.fonts names it; new formats go in core/assetLoad.js' });
      });
    }
    for (const f of walk(P.GAMES_REL, exts).filter(f => !/\/(tests|docs)\//.test(f))) {
      let L;
      try { L = lines(f); } catch { continue; }
      L.forEach((l, i) => {
        if (GAME_BYPASS.test(l) && !comment(l))
          out.push({ level: 'warn', file: f, line: i + 1, msg: `loads by hand a format the asset manifest handles: ${l.trim().slice(0, 80)}`,
            fix: 'works, but the asset gets no name and the loading screen / describe cannot see it: engine.assets.manifest({ models | textures | fonts }) then engine.assets.model(name) / texture(name). Keep the loader if you need its raw result (recipes/54-three-idioms.md)' });
      });
    }
    return out;
  },
};

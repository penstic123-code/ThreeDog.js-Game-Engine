// R34 style packs hold looks only (packages/engine/docs/recipes/09-style-pack.md): in packages/styles/** (game mode: node_modules/@threedog/style-*),
//   · error: a world-shape generator, i.e. a function named height / groundType / terrainPreset / riverAt or an export named BIOMES /
//     terrainStrings. Where the hills, rivers and biomes are is gameplay: it goes in an add-on package (@threedog/terrain-noise) or the game;
//   · error: a font written as a file (fontFaces: [{ url }], fontCSS: 'https://...'): fonts are asset-pack entries, style.ui.fonts names them.
// Detection: line-based regex, lines starting with // or * skipped (so comments may explain the rule). Known limits: a generator under
//   another name (const shape = (x, z, n) => ...) is not seen; the runtime check for fonts (ui/theme.js) still catches the font case.
// Why: swapping the look must never move a river or change which file a menu loads; a style that carries world shape or files cannot be
//   mixed freely with other parts (style: [lowpoly, mine]).
import { walk, lines, P } from './_lib.mjs';

const SHAPE = /\bfunction\s+(height|groundType|terrainPreset|riverAt)\s*\(|\bexport\s+(const|let|var)\s+(BIOMES|terrainStrings)\b|\b(terrainPreset|riverAt)\b.*\bfrom\s+['"]\.\//;
const FONT_FILE = /\b(fontFaces|fontCSS)\s*:/;

export default {
  id: 'R34', title: 'Style packs hold looks only (no world shape, no font files)', game: true,
  run() {
    const out = [];
    for (const f of walk(P.STYLES_REL, ['.js', '.mjs']).filter(f => P.MODE === 'monorepo' || /\/style-[^/]+\//.test(f))) {
      lines(f).forEach((l, i) => {
        if (/^\s*(\/\/|\*)/.test(l)) return;
        if (SHAPE.test(l)) out.push({ level: 'error', file: f, line: i + 1, msg: `a style pack carries world-shape logic: ${l.trim().slice(0, 80)}`,
          fix: "move the generator to its own package (like @threedog/terrain-noise) or the game; the style keeps only the colors of its ground types (terrain.colors / biomeColors)" });
        if (FONT_FILE.test(l)) out.push({ level: 'error', file: f, line: i + 1, msg: `a style pack writes a font file: ${l.trim().slice(0, 80)}`,
          fix: "register the file in an asset pack (manifest({ fonts: { pixel: 'pixel.woff2' } })) and name it in style.ui: { fonts: ['pixel'] }" });
      });
    }
    return out;
  },
};

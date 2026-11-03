// R39 engine fallback colors are neutral gray (warning): when no style sets a color, the engine draws in gray, so an unstyled game looks
// unfinished rather than styled by accident; real colors belong in the style. Flags a 0xRRGGBB literal in engine source (index.js, core,
// modules, render, ui) whose channels differ by more than 0x30. The debug panel is exempt (dev colors). A color that has to be one (a
// debug overlay, a data value) is confirmed with a line comment `// R39: <reason>`, which also clears the warning.
import { lines, codeOnly, engineFiles, reE } from './_lib.mjs';

const ALLOW = [[reE('modules\\/debug\\/'), 'the debug panel is a dev tool']];
const isGrey = hex => { const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255; return Math.max(r, g, b) - Math.min(r, g, b) <= 0x30; };

export default {
  id: 'R39', title: 'Engine fallback colors are neutral gray (real colors belong in the style)',
  run() {
    const out = [];
    for (const f of engineFiles()) {
      if (ALLOW.some(([r]) => r.test(f))) continue;
      lines(f).forEach((raw, i) => {
        if (/^\s*(\*|\/\*|\/\/)/.test(raw) || /\/\/\s*R39:/.test(raw)) return;
        for (const m of codeOnly(raw).matchAll(/0x([0-9a-fA-F]{6})\b/g)) if (!isGrey(parseInt(m[1], 16)))
          out.push({ level: 'warn', file: f, line: i + 1, msg: `non-gray fallback color 0x${m[1]}`,
            fix: 'make the fallback gray and let the style set the color; if the color is meant (a debug overlay, data), add `// R39: <reason>` on the line' });
      });
    }
    return out;
  },
};

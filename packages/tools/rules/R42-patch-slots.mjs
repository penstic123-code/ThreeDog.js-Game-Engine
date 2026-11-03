// R42 engine shader patches go through the slot table (render/slots.js; docs/plans/done/2026-11-02-look-architecture.md §4e).
// Why: the slot table is a single table, and the WebGPU route only needed its node column; if the engine's own patches wrote anchors like `begin_vertex:` directly, a backend switch would miss one place,
// and the table in the docs would drift from the code. So both are checked:
//   1. engine code (core / modules / render / ui / examples, not render/slots.js or render/patches.js) never uses a slot's three.js chunk
//      name as an object key (the raw-anchor form `glsl: { fragment: { color_fragment: ... } }`); write `slot: 'color'` instead.
//      Games are not scanned: the raw-anchor form is their documented exit.
//   2. recipe 43's slot table (between <!-- slots:begin --> and <!-- slots:end -->) is exactly slotTable() from render/slots.js.
// Known limits: a key built at run time (glsl[stage][anchor] = ...) is not seen.
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { walk, lines, read, codeOnly, abs, P } from './_lib.mjs';

const ALLOW = [`${P.ENGINE_REL}/render/slots.js`, `${P.ENGINE_REL}/render/patches.js`];
const RECIPE = `${P.ENGINE_REL}/docs/recipes/43-shader-patches-surface-looks.md`;

export default {
  id: 'R42', title: 'Engine shader patches name slots (render/slots.js), recipe 43 lists the same table',
  async run() {
    const out = [], slotsFile = `${P.ENGINE_REL}/render/slots.js`;
    if (!existsSync(abs(slotsFile))) return out;   // a game in its own repo: no engine source here
    const { SLOTS, slotTable } = await import(pathToFileURL(abs(slotsFile)).href);
    const byAnchor = new Map(Object.entries(SLOTS).map(([n, s]) => [s.anchor, n]));
    const re = new RegExp(`\\b(${[...byAnchor.keys()].join('|')})\\s*:`, 'g');
    for (const dir of [...P.ENGINE_CODE_DIRS_REL, `${P.ENGINE_REL}/examples`]) for (const f of walk(dir)) {
      if (ALLOW.includes(f)) continue;
      lines(f).forEach((raw, i) => {
        if (/^\s*(\*|\/\/)/.test(raw)) return;   // jsdoc and comment lines (codeOnly keeps a comment after an unclosed apostrophe)
        for (const m of codeOnly(raw).matchAll(re))
          out.push({ level: 'error', file: f, line: i + 1, msg: `engine patch uses the raw anchor '${m[1]}'`,
            fix: `write slot: '${byAnchor.get(m[1])}' (render/slots.js) instead of glsl: { vertex|fragment: { ${m[1]}: ... } }` });
      });
    }
    if (existsSync(abs(RECIPE))) {
      const text = read(RECIPE).replace(/\r\n/g, '\n'), m = /<!-- slots:begin[^\n]*-->\n([\s\S]*?)\n<!-- slots:end -->/.exec(text);
      if (!m) out.push({ level: 'error', file: RECIPE, line: 1, msg: 'recipe 43 has no generated slot table', fix: 'put slotTable() from render/slots.js between <!-- slots:begin --> and <!-- slots:end -->' });
      else if (m[1].trim() !== slotTable().trim()) out.push({ level: 'error', file: RECIPE, line: text.slice(0, m.index).split('\n').length,
        msg: 'recipe 43 slot table differs from render/slots.js', fix: "regenerate it: node -e \"import('./packages/engine/render/slots.js').then(m => console.log(m.slotTable()))\"" });
    }
    return out;
  },
};

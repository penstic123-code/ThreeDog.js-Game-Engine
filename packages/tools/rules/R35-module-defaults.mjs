// R35 engine code keeps no style table: a module's default picture is its own plain material (render/neutral.js neutralMaterial, exposed as
//   engine.<module>.material), never asked for from a table behind it.
// Why: a default that sits in a table the game cannot see is the first thing that surprises it, and a module that asks a table for its picture can
//   never be swapped with plain three.js. Which colors those defaults use is R39's job.
// Criteria: engine code (index.js, core, modules, render, ui), two kinds of finding, each with its own level in LEVEL:
//   table  reads engine.style (also e.style, eng.style, with ?.) or calls makeMaterial(...) / defineLookPart(...)
//   layer  reads engine.look (same spellings)
//   A one-line `const { style } = engine` counts as a read. Detection: per line, comments and strings skipped, so an error text may still name the
//   old entry. Known limit: a destructuring spread over several lines is not seen.
// Level: an error; the old layer is gone, so a hit is a new one.
import { lines, codeOnly, engineFiles } from './_lib.mjs';

export const LEVEL = { table: 'error', layer: 'error' };
const WHO = String.raw`(?:engine|eng|e)`;
const reads = prop => [new RegExp(String.raw`\b${WHO}\??\.${prop}\b`), new RegExp(String.raw`\{[^}]*\b${prop}\b[^}]*\}\s*=\s*(?:this\.)?${WHO}\b`)];
const KINDS = [
  ['table', [...reads('style'), /\b(?:makeMaterial|defineLookPart)\s*\(/]],
  ['layer', reads('look')],
];

/** Findings of one file's lines (exported for the rule test) */
export function tableReaches(file, rows, level = LEVEL) {
  const out = [];
  rows.forEach((raw, i) => {
    if (/^\s*\*/.test(raw)) return;
    const code = codeOnly(raw);
    for (const [kind, res] of KINDS) {
      const m = res.map(r => r.exec(code)).find(Boolean);
      if (m) out.push({ level: level[kind], kind, file, line: i + 1, msg: `reaches the removed style table: ${m[0].replace(/\s*\($/, '')}`,
        fix: 'make the picture here: neutralMaterial(what, params) from render/neutral.js, exposed as engine.<module>.material; values become module options' });
    }
  });
  return out;
}

export default {
  id: 'R35', title: 'Engine code keeps no style table (a module makes its own neutral picture)',
  run() { return engineFiles().flatMap(f => tableReaches(f, lines(f))); },
};

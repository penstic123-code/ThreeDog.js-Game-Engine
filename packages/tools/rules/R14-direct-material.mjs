// R14 no material made directly in engine code (error): engine source (index.js, core, modules, render, ui) makes its own materials with
// neutralMaterial(what, params) from render/neutral.js, so every one is marked engine-made and starts neutral gray. A `new THREE.Mesh*Material`
// elsewhere would skip both, and a colored default there is a picture the game never chose.
// Games, examples and their picture/ folders are not scanned: `new THREE.*Material` there is plain three.js and always fine.
// A line that mentions debug is a warning instead (a dev-only helper may need a plain material; confirm it). Exempt: the two helpers that exist to
// create materials, and the debug panel module, each listed below with its reason.
import { lines, codeOnly, engineFiles, reE } from './_lib.mjs';

const DIRECT = /new THREE\.Mesh(Lambert|Phong|Standard|Physical|Toon|Basic)Material/;
// [path regex, reason]
const ALLOW = [
  [reE('render\\/neutral\\.js$'), 'neutralMaterial is the one allowed place: every other engine file calls it'],
  [reE('modules\\/debug\\/'), 'the debug panel is a dev tool, never part of a game\'s picture'],
];

export default {
  id: 'R14', title: 'No material made directly in engine code (use neutralMaterial)',
  run() {
    const out = [];
    for (const f of engineFiles()) {
      if (ALLOW.some(([r]) => r.test(f))) continue;
      lines(f).forEach((raw, i) => {
        if (/^\s*(\*|\/\*|\/\/)/.test(raw) || !DIRECT.test(codeOnly(raw))) return;
        if (/debug|Debug/.test(raw)) out.push({ level: 'warn', file: f, line: i + 1, msg: 'creates a material directly (debug use, please confirm)', fix: 'if it is debug-only, keep it; otherwise use neutralMaterial(what, params) from render/neutral.js' });
        else out.push({ level: 'error', file: f, line: i + 1, msg: 'creates a material directly', fix: 'use neutralMaterial(what, params) from render/neutral.js, exposed as engine.<module>.material' });
      });
    }
    return out;
  },
};

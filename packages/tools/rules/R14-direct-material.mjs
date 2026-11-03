// R14 no material made directly in engine code (error): engine source (index.js, core, modules, render, ui) builds its materials with
// makeMaterial('purpose', {...}), so the style decides the engine's own look. A `new THREE.Mesh*Material` there would ignore every style.
// Games, examples and their style/ folders are not scanned: `new THREE.*Material` there is plain three.js and always fine (R40 hints when a
// hand-set color keeps a game model from following the style).
// A line that mentions debug is a warning instead (a dev-only helper may need a plain material; confirm it). Exempt: the material factory itself
// and the debug panel module, each listed below with its reason.
import { lines, codeOnly, engineFiles, reE } from './_lib.mjs';

const DIRECT = /new THREE\.Mesh(Lambert|Phong|Standard|Physical|Toon|Basic)Material/;
// [path regex, reason]
const ALLOW = [
  [reE('render\\/materials\\.js$'), 'the material factory: makeMaterial itself creates the materials'],
  [reE('modules\\/debug\\/'), 'the debug panel is a dev tool, never part of a game\'s look'],
];

export default {
  id: 'R14', title: 'No material made directly in engine code (use makeMaterial)',
  run() {
    const out = [];
    for (const f of engineFiles()) {
      if (ALLOW.some(([r]) => r.test(f))) continue;
      lines(f).forEach((raw, i) => {
        if (/^\s*(\*|\/\*|\/\/)/.test(raw) || !DIRECT.test(codeOnly(raw))) return;
        if (/debug|Debug/.test(raw)) out.push({ level: 'warn', file: f, line: i + 1, msg: 'creates a material directly (debug use, please confirm)', fix: 'if it is debug-only, keep it; otherwise use makeMaterial(\'purpose\', {...})' });
        else out.push({ level: 'error', file: f, line: i + 1, msg: 'creates a material directly', fix: 'use makeMaterial(\'purpose\', {...}) so the style decides the look' });
      });
    }
    return out;
  },
};

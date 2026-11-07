// R66 camera.fov has one writer in the engine: core/scene/view.js. A rig, a menu or a cutscene asks through setFov (the base view) or holdFov (what a holder shows).
// Why: the audit found three writers of the lens, each remembering a value of its own to put back, so a slider moved during a shot was lost and overlapping shots
// ended half way (docs/testing/review/2026-11-07-1.0-audit/vertical-output.md, I1 and I2). The hold's record only works if nothing goes around it.
// Detection: error on code (not comments or strings) under core, modules, render and ui that assigns .fov on anything but `this` (a rig's own option field).
// Known limits: Object.assign(camera, { fov }) and destructured writes are not seen. Games are not scanned: a game's own fov is its right, and the engine yields to it.
import { walk, lines, codeOnly, P } from './_lib.mjs';

const RE = /([\w$.\]\)]+)\.fov\s*(?:[-+*/])?=(?!=)/g;
const OWNER = `${P.CORE_REL}/scene/view.js`;

export default {
  id: 'R66', title: 'camera.fov is written only by core/scene/view.js',
  run() {
    const out = [];
    for (const dir of P.ENGINE_CODE_DIRS_REL) for (const f of walk(dir)) {
      if (f === OWNER) continue;
      lines(f).forEach((raw, i) => {
        if (/^\s*\*/.test(raw)) return;
        for (const m of codeOnly(raw).matchAll(RE)) if (m[1] !== 'this') out.push({ level: 'error', file: f, line: i + 1, msg: `a write of the lens outside core/scene/view.js (${m[0].trim()})`,
          fix: 'setFov(engine, v) for the base view, holdFov(engine, v) for what a holder of the camera shows (core/scene/view.js)' });
      });
    }
    return out;
  },
};

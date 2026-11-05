// R24 package boundaries hold after npm install: the tools and the engine tests reach each other only by package name.
// Detection:
//   · error: a file in packages/tools imports the engine by a relative path (../engine/…, ../../engine/…); installed from npm the engine sits in
//     node_modules/threedog, so such an import crashes (use 'threedog' or 'threedog/<export>')
//   · error: an engine test imports the tools by a relative path (../../../tools/…; use '@threedog/tools/<export>')
//   · warn: input._keyDown / _keyUp outside core/input/Input.js (the public entry is engine.input.simulate)
// Known limits: only static import / export … from and import('…') with a string literal are read.
import { walk, read, P } from './_lib.mjs';

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

export default {
  id: 'R24', title: 'Package boundaries: no relative imports across packages, no private input calls',
  run() {
    const out = [];
    const scan = (files, bad, msg, fix) => { for (const f of files) read(f).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(IMPORT)) if (bad.test(m[1])) out.push({ level: 'error', file: f, line: i + 1, msg: `${msg}: '${m[1]}'`, fix });
    }); };
    scan(walk(P.TOOLS_REL, ['.mjs', '.js']), /^(\.\.\/)+engine\//, 'tools import the engine by a relative path', "import from 'threedog' (or a subpath it exports), or keep a small helper in packages/tools/lib");
    scan(walk(P.ENGINE_TESTS_REL, ['.mjs', '.js']), /^(\.\.\/)+tools\//, 'an engine test imports the tools by a relative path', "import from '@threedog/tools/<export>'");
    // core/input/Input.js and its split parts (inputPad, inputPointer, inputTouch) are the owner
    // engine tests may exercise Input's internals; games, examples, modules and tools may not
    for (const f of [...walk(P.ENGINE_REL, ['.js', '.mjs']), ...walk(P.TOOLS_REL, ['.js', '.mjs'])].filter(f => !/core\/input\/\w+\.js$/.test(f) && !P.under(f, P.ENGINE_TESTS_REL))) read(f).split('\n').forEach((line, i) => {
      if (/\._key(Down|Up)\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) out.push({ level: 'warn', file: f, line: i + 1, msg: 'calls the private input._keyDown / _keyUp', fix: 'use engine.input.simulate(action, down)' });
    });
    return out;
  },
};

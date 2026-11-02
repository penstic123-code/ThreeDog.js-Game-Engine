// content-check reads asset names from the game's real asset pack objects (no browser): throwaway game folders in the OS temp dir go through checkGame.
// Guards (cannot be bypassed): a name registered only in main.js source text is NOT counted (the old regex scan is gone, so static check and
// runtime share one source: <game>/assets.js); a model content names but no pack registers is an error; content naming models with no
// assets.js is an error that says how to add one; an assets.js that cannot load is reported, not ignored; a canvas drawn at module top
// (recipe 05 code textures) loads under the no-op DOM stand-ins, other browser-only module-top work fails with the fix in the message.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkGame } from '../content-check.mjs';

export const name = 'content-check: asset names come from the assets.js pack objects, not from scanning main.js';

const PROPS = "export default [{ id: 'a', model: 'crate', x: 0, z: 0 }, { id: 'b', model: ['flower', 3], x: 1, z: 0 }, { id: 'c', model: 'ghost', x: 2, z: 0 }];\n";
// main.js mentions ghost in a manifest call: the old regex scan would have accepted it, the pack objects do not register it
const MAIN = "engine.assets.manifest(packs);\n// engine.assets.manifest({ models: { ghost: '/models/ghost.glb' } })\n";

async function game(files) {
  const dir = mkdtempSync(join(tmpdir(), 'threedog-assets-'));
  mkdirSync(join(dir, 'content'));
  for (const [f, src] of Object.entries(files)) writeFileSync(join(dir, f), src);
  try { return await checkGame(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

export async function run({ check }) {
  // a generator made in code (function value) and a file both count, from a list of packs
  const ok = await game({ 'main.js': MAIN, 'content/props.js': PROPS,
    'assets.js': "export default [{ name: 'a', models: { crate: () => null } }, { name: 'b', models: { flower: '/models/flower.glb' }, sounds: { ding: () => 0.1 } }];\n" });
  const okAll = [...ok.errors, ...ok.warnings].join('\n');
  check('names from the assets.js objects pass: a generator (crate) and a file ([flower, 3])', !/"crate"|"flower"/.test(okAll), okAll);
  check('[guard] a model only written in main.js source text is not registered: ghost is an error', ok.errors.some(e => /model "ghost" .* is in no asset pack of assets\.js/.test(e)), okAll);

  const none = await game({ 'main.js': MAIN, 'content/props.js': PROPS });
  const noneAll = none.errors.join('\n');
  check('[guard] content naming models with no assets.js is an error saying how to add one', /no assets\.js: export the asset packs main\.js registers/.test(noneAll), noneAll);

  // module-top drawing, as recipe 05's code textures are naturally written: a shared canvas drawn outside the generator (no three import: the
  // temp folder cannot resolve packages; the canvas calls are what used to throw)
  const CANVAS = "const c = document.createElement('canvas'); c.width = c.height = 64;\n"
    + "const g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, c.width, c.height);\n"
    + "const img = g.getImageData(0, 0, 64, 64); for (let i = 0; i < img.data.length; i++) img.data[i] = 1;\n"
    + "if (c.width !== 64) throw new Error('written sizes read back');\n"
    + "export default [{ name: 'a', models: { crate: () => c, flower: () => null, ghost: () => null } }];\n";
  const canvas = await game({ 'main.js': MAIN, 'content/props.js': PROPS, 'assets.js': CANVAS });
  check('[guard] a canvas drawn at module top of assets.js loads in the check (no "document is not defined")', !canvas.errors.length, canvas.errors.join('\n'));
  check('the DOM stand-ins are removed after the import', typeof globalThis.document === 'undefined');
  const font = await game({ 'main.js': MAIN, 'content/props.js': PROPS, 'assets.js': "new FontFace('x', 'url(x)');\nexport default [];\n" });
  check('[guard] other browser-only module-top work fails with the fix named (move it into the generator / a texture function)',
    font.errors.some(e => /FontFace is not defined.*move it into the generator/.test(e)), font.errors.join('\n'));

  const broken = await game({ 'main.js': MAIN, 'content/props.js': PROPS, 'assets.js': "import nothing from './missing.js';\nexport default [nothing];\n" });
  check('[guard] an assets.js that cannot be imported is reported (names are not silently empty)', broken.errors.some(e => /assets\.js: the file cannot be loaded/.test(e)), broken.errors.join('\n'));
}

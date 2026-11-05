// threedog tune write (tune.mjs): dev panel values -> one reviewable code block, dry run shows the diff, a second write merges into the block.
// Also the patch side of shader hot reload (replacePatchCode): the text inside a patch is swapped and the patch gets a new cacheKey.
import * as THREE from 'three';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as tuneMain, parseTuneBlock, planTune, tuneBlock } from '../tune.mjs';
import { ENGINE } from '../paths.mjs';

const { patchMaterial, replacePatchCode, materialPatchSlots } = await import(pathToFileURL(join(ENGINE, 'render/patches.js')).href);

export const name = 'tune write: panel values become one marked block (dry-run diff, merged on rewrite); hot reload swaps patch code with a new cacheKey';

export async function run({ check }) {
  const ok = (cond, msg, detail) => check(msg, cond, detail);
  const t = { values: { 'engine.renderer.toneMappingExposure': 1.25, 'engine.water.material.color': '#3388aa', 'engine.uniforms.uWind.value': 0.39999999999999997 }, css: { accent: '#7fd3ff' },
    materials: { rock: { roughness: 0.8, color: '#887766' } } };
  const src = 'const engine = await createEngine({});\nengine.start();\n';
  const a = planTune(src, t);
  ok(!a.replaced && a.after.startsWith(src.trim()) && /\/\/ threedog:tune begin[\s\S]*\/\/ threedog:tune end\n$/.test(a.after), 'first write appends one marked block, the file before it unchanged');
  ok(a.after.includes('engine.renderer.toneMappingExposure = 1.25;') && a.after.includes('engine.water.material.color.set(0x3388aa);') && a.after.includes('rock: { roughness: 0.8, color: 0x887766 }')
    && a.after.includes('engine.uniforms.uWind.value = 0.4;') && a.after.includes(`engine.uiRoot.style.setProperty('--threedog-accent', "#7fd3ff");`), 'numbers, colors, UI colors and materials each written as plain three.js', a.after);
  ok(/^@@ line \d+ \(appended\) @@/.test(a.diff) && a.diff.split('\n').slice(1).every(l => l.startsWith('+ ')), 'dry run diff: only added lines');
  const b = planTune(a.after, { values: { 'engine.renderer.toneMappingExposure': 0.9 } });
  ok(b.replaced && b.after.split('threedog:tune begin').length === 2 && b.after.includes('toneMappingExposure = 0.9') && !b.after.includes('toneMappingExposure = 1.25'), 'a second write changes the value in place, still one block (never two)');
  ok(b.diff.includes('- engine.renderer.toneMappingExposure = 1.25;') && b.diff.includes('+ engine.renderer.toneMappingExposure = 0.9;'), 'its diff shows old lines - and new +');
  ok(tuneBlock({}).split('\n').length === 2, 'nothing tuned: an empty block');

  // [guard] the new value must be the one that runs: a line the block could not read comes after the values, so it would win and the tool would still say "Written"
  const EXP = 'engine.renderer.toneMappingExposure', now = { values: { [EXP]: 1.5 } }, lastSet = text => text.split(/\r?\n/).filter(l => l.startsWith(EXP)).at(-1);
  const commented = a.after.replace(`${EXP} = 1.25;`, `${EXP} = 1.25;   // keep it soft`);
  ok(lastSet(planTune(commented, now).after) === `${EXP} = 1.5;`, '[guard] a value with a hand comment: the panel value is the last one set', planTune(commented, now).after);
  const crlf = a.after.replaceAll('\n', '\r\n'), c1 = planTune(crlf, now).after;
  ok(lastSet(c1) === `${EXP} = 1.5;` && c1.split(`${EXP} =`).length === 2, '[guard] a file with Windows line endings: the old lines go, the panel value is the one set', c1);
  ok(!/[^\r]\n/.test(c1) && c1.split('engine.water.material.color.set').length === 2 && c1.split('const tuned').length === 2, 'such a file keeps its line endings, and nothing piles up on a rewrite', c1);
  const cssNote = a.after.replace(`"#7fd3ff");`, `"#7fd3ff");   // brand`), colorNote = a.after.replace('.set(0x3388aa);', '.set(0x3388aa);   // sea');
  ok(!planTune(cssNote, { css: { accent: '#000000' } }).after.includes('#7fd3ff') && !planTune(colorNote, { values: { 'engine.water.material.color': '#000000' } }).after.includes('3388aa'), '[guard] the same for a UI color and a color with a comment');
  ok(planTune(commented, { values: { 'engine.scene.fog.far': 9 } }).after.includes('// keep it soft'), 'a commented line the panel did not change stays as the author left it');

  // [guard] code in a material literal is the author's: it stays whole, and the panel's values for that material go after it
  const coded = a.after.replace('rock: { roughness: 0.8,', 'rock: { side: THREE.DoubleSide, roughness: 0.8,'), c2 = planTune(coded, { materials: { rock: { roughness: 0.2 } } }).after;
  ok(c2.includes('side: THREE.DoubleSide') && c2.indexOf('side: THREE.DoubleSide') < c2.indexOf('roughness: 0.2') && c2.split('engine.scene.traverse').length === 3, '[guard] a hand-written side: THREE.DoubleSide survives a write', c2);

  // tune write with no file: it names the values that need one, instead of printing the usage line
  const dir = mkdtempSync(join(tmpdir(), 'tune-')), here = process.cwd(), errs = [], err = console.error;
  mkdirSync(join(dir, '.threedog')); writeFileSync(join(dir, '.threedog', 'tune.json'), JSON.stringify({ values: { 'engine.scene.fog.far': 90 } }));
  process.chdir(dir); console.error = m => errs.push(m);
  const code = await tuneMain(['write']);
  console.error = err; process.chdir(here); rmSync(dir, { recursive: true });
  ok(code === 1 && /needs a file/.test(errs[0]) && errs[0].includes('engine.scene.fog.far') && !/^Usage/.test(errs[0]), 'tune write without a file says which values need one', errs[0]);

  const old = '// threedog:begin file=fx/tint.glsl\ndiffuseColor.rgb *= 0.5;\n// threedog:end';
  const m1 = new THREE.MeshStandardMaterial(), m2 = new THREE.MeshStandardMaterial();
  for (const m of [m1, m2]) patchMaterial(m, [{ name: 'dh-tint', slot: 'color', cacheKey: 1, glsl: old }]);
  const key0 = m1.customProgramCacheKey();
  const out = replacePatchCode([m1, m2, new THREE.MeshBasicMaterial()], old, old.replace('0.5', '0.8'));
  ok(out.length === 2 && m1.customProgramCacheKey() !== key0, 'both materials with the patch change, and their program key changes (no stale program)');
  ok(materialPatchSlots(m1)[0]?.name === 'dh-tint' && materialPatchSlots(m1)[0].slots.includes('color'), 'inspect lists the patch with its slot');
}

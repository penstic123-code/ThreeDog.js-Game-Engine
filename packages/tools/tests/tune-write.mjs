// threedog tune write (tune.mjs): dev panel values -> one reviewable code block, dry run shows the diff, a second write replaces the block.
// Also the patch side of shader hot reload (replacePatchCode): the text inside a patch is swapped and the patch gets a new cacheKey.
import * as THREE from 'three';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { planTune, tuneBlock } from '../tune.mjs';
import { ENGINE } from '../paths.mjs';

const { patchMaterial, replacePatchCode, materialPatchSlots } = await import(pathToFileURL(join(ENGINE, 'render/patches.js')).href);

export const name = 'tune write: panel values become one marked block (dry-run diff, replaced on rewrite); hot reload swaps patch code with a new cacheKey';

export async function run({ check }) {
  const ok = (cond, msg, detail) => check(msg, cond, detail);
  const t = { look: { tone: { exposure: 1.25 }, lights: { 'sun.color': '#ffeedd' } }, materials: { rock: { roughness: 0.8, color: '#887766' } }, uniforms: { uWind: 0.4 }, style: { water: { color: 0x3388aa } } };
  const src = 'const engine = await createEngine({});\nengine.start();\n';
  const a = planTune(src, t);
  ok(!a.replaced && a.after.startsWith(src.trim()) && /\/\/ threedog:tune begin[\s\S]*\/\/ threedog:tune end\n$/.test(a.after), 'first write appends one marked block, the file before it unchanged');
  ok(a.after.includes('engine.look.tone.set({ exposure: 1.25 });') && a.after.includes('"sun.color": 0xffeedd') && a.after.includes('rock: { roughness: 0.8, color: 0x887766 }')
    && a.after.includes('engine.uniforms.uWind.value = 0.4;') && a.after.includes('export const tunedStyle'), 'look / materials / uniforms / style each written as plain calls', a.after);
  ok(/^@@ line \d+ \(appended\) @@/.test(a.diff) && a.diff.split('\n').slice(1).every(l => l.startsWith('+ ')), 'dry run diff: only added lines');
  const b = planTune(a.after, { look: { tone: { exposure: 0.9 } } });
  ok(b.replaced && b.after.split('threedog:tune begin').length === 2 && b.after.includes('exposure: 0.9') && !b.after.includes('exposure: 1.25'), 'a second write replaces the block (never two)');
  ok(b.diff.includes('- engine.look.tone.set({ exposure: 1.25 });') && b.diff.includes('+ engine.look.tone.set({ exposure: 0.9 });'), 'its diff shows old lines - and new +');
  ok(tuneBlock({}).split('\n').length === 2, 'nothing tuned: an empty block');

  const old = '// threedog:begin file=fx/tint.glsl\ndiffuseColor.rgb *= 0.5;\n// threedog:end';
  const m1 = new THREE.MeshStandardMaterial(), m2 = new THREE.MeshStandardMaterial();
  for (const m of [m1, m2]) patchMaterial(m, [{ name: 'dh-tint', slot: 'color', cacheKey: 1, glsl: old }]);
  const key0 = m1.customProgramCacheKey();
  const out = replacePatchCode([m1, m2, new THREE.MeshBasicMaterial()], old, old.replace('0.5', '0.8'));
  ok(out.length === 2 && m1.customProgramCacheKey() !== key0, 'both materials with the patch change, and their program key changes (no stale program)');
  ok(materialPatchSlots(m1)[0]?.name === 'dh-tint' && materialPatchSlots(m1)[0].slots.includes('color'), 'inspect lists the patch with its slot');
}

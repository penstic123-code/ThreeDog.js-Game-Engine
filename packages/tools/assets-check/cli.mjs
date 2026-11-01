// threedog assets check [glb or folder] [--json] [--strict] [-w game]
// Reads each glb statically: the level manifest (spawn / col_ / trigger_ / template ...), material and color-space suspicions, model statistics.
// Default target: art/models of the workspace. Exit 1 on errors (--strict: on warnings too). --json prints one machine-readable object instead of text.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { loadGame } from '../content-check/load.mjs';
import { readModel, hasReader, NO_READER } from './read.mjs';
import { levelManifest, checkAgainstContent, missingTriggers, summarize } from './level.mjs';
import { reviewMaterials } from './materials.mjs';
import { modelStats, statsLines } from './stats.mjs';

/** Check one model file: { file, level, materials, stats } (level = the manifest incl. its issues) */
export async function checkModel(file, content) {
  const { doc, core } = await readModel(file);
  return { file, level: checkAgainstContent(levelManifest(doc, file), content), materials: reviewMaterials(doc, core), stats: modelStats(doc, core) };
}

export async function runCheck(dir, args) {
  const json = args.includes('--json'), strict = args.includes('--strict');
  const target = resolve(args.find(a => !a.startsWith('-')) ?? join(dir, 'art/models'));
  if (!hasReader()) { console.error('✗ ' + NO_READER); return 1; }
  if (!existsSync(target)) { console.log(`${target} does not exist. Pass a .glb file or a folder, or put exports into art/models/.`); return 0; }
  const files = statSync(target).isDirectory() ? readdirSync(target).filter(f => /\.(glb|gltf)$/i.test(f)).map(f => join(target, f)) : [target];
  const content = existsSync(join(dir, 'content')) ? (await loadGame(dir)).data : undefined;
  const results = [];
  for (const f of files) {
    try { results.push(await checkModel(f, content)); } catch (e) { results.push({ file: f, error: e.message }); }
  }
  const levels = results.filter(r => r.level).map(r => r.level), gone = content && statSync(target).isDirectory() ? missingTriggers(content, levels) : [];
  const errors = results.filter(r => r.error).length + levels.flatMap(l => l.issues).filter(i => i.severity === 'error').length + gone.length;
  const warnings = levels.flatMap(l => l.issues).filter(i => i.severity === 'warn').length + results.flatMap(r => r.materials || []).filter(i => i.severity === 'warn').length;
  if (json) console.log(JSON.stringify({ target, models: results, missingContentTriggers: gone, errors, warnings }, null, 2));
  else {
    for (const r of results) {
      console.log(`\n${relative(process.cwd(), r.file) || r.file}`);
      if (r.error) { console.log(`  ✗ cannot read: ${r.error}`); continue; }
      console.log(`  level       ${summarize(r.level)}`);
      for (const l of statsLines(r.stats, '  ')) console.log(l);
      for (const i of r.level.issues) console.log(`  ${i.severity === 'error' ? '✗' : '!'} ${i.msg}`);
      for (const i of r.materials) console.log(`  ${i.severity === 'warn' ? '!' : '·'} ${i.where}: ${i.msg}`);
    }
    for (const tag of gone) console.log(`\n✗ content/triggers.js: trigger zone ${tag} is fromLevel, but no checked model has a node trigger_${tag}`);
    console.log(`\nAsset check: ${files.length} models, ${errors} errors, ${warnings} warnings`);
  }
  return errors || (strict && warnings) ? 1 : 0;
}

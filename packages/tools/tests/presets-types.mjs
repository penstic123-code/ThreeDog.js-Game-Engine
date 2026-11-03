// presets.bindings: every key map the runtime has (packages/engine/presets.js) is declared in index.d.ts, and the other way round.
// Why: presets.keys.gridRotate once existed at runtime and in recipe 29 but not in the types, so a game copying the recipe failed `threedog types`.
// Offline: imports presets.js and reads index.d.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';

export const name = 'presets types: every presets.bindings map at runtime is declared in index.d.ts (and no declared one is missing)';

export async function run({ check }) {
  const { presets } = await import(pathToFileURL(join(ENGINE, 'presets.js')).href);
  const dts = readFileSync(join(ENGINE, 'index.d.ts'), 'utf8');
  const block = /readonly bindings: \{ readonly \[K in ([^\]]*)\]/.exec(dts)?.[1] ?? '';
  const declared = [...block.matchAll(/'(\w+)'/g)].map(m => m[1]).sort(), real = Object.keys(presets.bindings).sort();
  check('the presets.bindings type is found', declared.length > 0);
  check('runtime presets.bindings and the declared ones are the same names', declared.join() === real.join(), `runtime ${real.join(', ')} | declared ${declared.join(', ')}`);
}

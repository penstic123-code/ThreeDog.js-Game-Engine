// Style pack tools for making a look from a reference picture: threedog style check|palette
//   threedog style check [pack|folder|file] [--json] [--assets file]   check the merged final style (what style: [a, b, {...}] becomes):
//       unknown fields (did-you-mean), world-state fields, missing palette keys, color formats, post-effect conflicts, material roles / types,
//       asset names; plus R34's text checks for the same pack. Static only: it cannot prove a pack holds no gameplay logic.
//   threedog style palette <image> [--n 8]                              dominant colors and light / saturation summary of a reference picture (a helper, not a decision)
// New pack from a clean template: npm run new-style name (new-style.mjs).
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { rel } from './paths.mjs';
import { loadSchema } from './style/schema.mjs';
import { checkStyle, paletteRefs } from './style/check.mjs';
import { resolveEntry, sourcesOf, loadStyle, assetNames } from './style/load.mjs';

const USAGE = 'Usage: threedog style check [pack|folder|file] [--json] [--assets file] · threedog style palette <image> [--n 8]';

/** Findings of one pack: { entry, findings, errors, warnings } */
export async function styleCheck(target, { assets: extra } = {}) {
  const entry = resolveEntry(target), { style, mod, closest, purposes } = await loadStyle(entry), sources = sourcesOf(entry);
  const names = assetNames(mod);
  if (extra) { const m = await import(pathToFileURL(resolveEntry(extra)).href); for (const [k, v] of Object.entries(assetNames(m))) for (const n of v) names[k].add(n); }
  const refs = new Map();
  for (const s of sources) for (const [k, line] of paletteRefs(s.text)) if (!refs.has(k)) refs.set(k, `${rel(s.file).split('/').pop()}:${line}`);
  const findings = checkStyle(style, { schema: loadSchema(), closest, purposes, assets: names, paletteRefs: refs });
  // R34 already checks the text of packs (world-shape generators, world fields written as literals, font files): reuse it for this pack only
  const dir = rel(dirname(entry)), r34 = (await import('./rules/R34-style-looks-only.mjs')).default;
  for (const x of r34.run().filter(x => x.file.startsWith(dir + '/'))) findings.push({ level: x.level, path: `${x.file}:${x.line}`, msg: `[R34] ${x.msg}`, fix: x.fix });
  const errors = findings.filter(x => x.level === 'error').length;
  return { entry: rel(entry), findings, errors, warnings: findings.length - errors };
}

function printCheck(r) {
  for (const x of r.findings) console.log(`${x.level === 'error' ? '✗' : '!'} ${x.path}: ${x.msg}${x.fix ? `\n    fix: ${x.fix}` : ''}`);
  console.log(`${r.errors ? '✗' : '✓'} ${r.entry}: ${r.errors} error(s), ${r.warnings} warning(s). Static checks only: whether the pack holds gameplay logic is not proven here (R34 looks for the usual patterns by text).`);
}

export async function main([sub, ...rest]) {
  const flag = n => rest.includes(n), val = n => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  const skip = new Set([val('--assets'), val('--n')].filter(Boolean));
  const arg = rest.find(a => !a.startsWith('-') && !skip.has(a));
  try {
    if (sub === 'check') {
      const r = await styleCheck(arg ?? '.', { assets: val('--assets') });
      if (flag('--json')) console.log(JSON.stringify({ ok: r.errors === 0, ...r }, null, 2)); else printCheck(r);
      return r.errors ? 1 : 0;
    }
    if (sub === 'palette') {
      if (!arg) { console.error('Usage: threedog style palette <image path> [--n 8]'); return 1; }
      const { paletteOf } = await import('./style/palette.mjs');
      const n = Number(val('--n') ?? 8);
      if (!Number.isInteger(n) || n < 2 || n > 32) { console.error('--n must be a whole number from 2 to 32'); return 1; }
      const r = await paletteOf(arg, n);
      console.log(JSON.stringify(r, null, 2));
      if (!flag('--json')) console.log(r.summary);
      return 0;
    }
  } catch (e) { console.error(`✗ ${e.message}`); return 1; }
  console.log(USAGE);
  return sub ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(await main(process.argv.slice(2)));

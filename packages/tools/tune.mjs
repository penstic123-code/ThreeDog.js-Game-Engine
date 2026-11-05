// threedog tune: write values tuned in the dev panel back into code, dry run first.
//   threedog tune show [-w game]                    what the panel saved (.threedog/tune.json, written by the panel's "write back" button)
//   threedog tune write <file> [-w game]            print the change as a diff (nothing is written); with -w the file is relative to the game folder
//   threedog tune write <file> --apply [-w game]    write it
// The change is one marked block of plain calls, appended at the end of the file the first time. A later write merges: the panel only holds what changed since the
// page loaded, so the block's own lines are read back and the new values go over them. To drop a value, delete its line.
//   // threedog:tune begin ... // threedog:tune end
// It holds three.js writes (engine.renderer.toneMappingExposure = 1.2; engine.water.material.color.set(0x3388aa);), UI colors as CSS variables on
// engine.uiRoot, and material values as material.setValues({...}) by material name. Review it, then keep it or move each value where it belongs (the
// game's picture code, the material's definition); the block is a starting point, not a second source of truth.
// Model generator params (the panel's models folder) are not put in the block: each becomes the `default` in that model's params schema where it
// is registered (assets.js or an art module, found under the game folder), so the generator keeps one source (planModelParams).
// Plain equivalent: copy the numbers from the panel by hand.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { parseAst } from 'vite';
import { writeAtomic } from './lib/atomic.mjs';
import { walk } from './lib/text.mjs';
import { literalValue } from './lib/ast-value.mjs';
import { parseOptions } from './lib/cli-args.mjs';
import { command } from './paths.mjs';
import { fileURLToPath } from 'node:url';

const BEGIN = '// threedog:tune begin', END = '// threedog:tune end';
const lit = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? '0x' + v.slice(1).toLowerCase() : JSON.stringify(v);
const obj = o => '{ ' + Object.entries(o).map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${v && typeof v === 'object' ? obj(v) : lit(v)}`).join(', ') + ' }';
const some = o => o && Object.keys(o).length > 0;

/**
 * The block text for saved tune values
 * @param {{ values?: Record<string, number | string>, css?: Record<string, string>, materials?: Record<string, Record<string, any>> }} t values: code path -> number or
 *   '#rrggbb' (a THREE.Color, written with .set); css: name after --threedog- -> color
 * @returns {string}
 */
export function tuneBlock(t) {
  const out = [`${BEGIN} (dev panel values written by \`threedog tune write\`; review, keep or move each value where it belongs)`];
  for (const [path, v] of Object.entries(t.values || {})) out.push(typeof v === 'string' ? `${path}.set(${lit(v)});` : `${path} = ${+v.toPrecision(6)};`);   // a slider step leaves 0.36999999999999994
  for (const [k, v] of Object.entries(t.css || {})) out.push(`engine.uiRoot.style.setProperty('--threedog-${k}', ${JSON.stringify(v)});`);
  out.push(...(t.kept || []));
  if (some(t.materials)) {
    out.push(`{ const tuned = ${obj(t.materials)};   // material name -> values (three.js Material.setValues)`,
      // the cast: a game's main.js is type-checked, and Object3D has no .material
      '  engine.scene.traverse((/** @type {any} */ o) => { for (const m of [].concat(o.material ?? [])) if (tuned[m.name]) m.setValues(tuned[m.name]); }); }');
  }
  out.push(END);
  return out.join('\n');
}

/** A material literal of the block back to values: '#rrggbb' for what was written as 0x, so the next write prints it the same. undefined: a hand edit put code in it */
function materialsOf(text) {
  try { return literalValue(parseAst(`(${text})`).body[0].expression, n => /^0x[0-9a-f]{6}$/i.test(n.raw ?? '') ? '#' + n.raw.slice(2) : n.value); } catch { return undefined; }
}

/**
 * Read a written block back into tune values. A line this cannot read (a hand edit) stays in `kept` and is written again as it is; so does a materials
 * line with code in it (side: THREE.DoubleSide), whole, because values read out of it would lose that field.
 * @param {string} block @returns {{ values: Record<string, any>, css: Record<string, string>, materials: Record<string, any>, kept: string[] }}
 */
export function parseTuneBlock(block) {
  const t = { values: {}, css: {}, materials: {}, kept: [] }, lines = block.split(/\r?\n/).slice(1, -1);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; let m;
    if ((m = /^(.+?)\.set\(0x([0-9a-f]{6})\);$/i.exec(l))) t.values[m[1]] = '#' + m[2];
    else if ((m = /^([\w$.[\]'"]+) = (-?[\d.]+(?:e[-+]?\d+)?);$/i.exec(l))) t.values[m[1]] = +m[2];
    else if ((m = /^engine\.uiRoot\.style\.setProperty\('--threedog-(.+?)', (".*")\);$/.exec(l))) t.css[m[1]] = JSON.parse(m[2]);
    else if ((m = /^\{ const tuned = (\{.*\});   \/\/ /.exec(l)) && (m = materialsOf(m[1]))) { t.materials = m; i++; }   // the next line is the traverse that goes with it
    else t.kept.push(l);
  }
  return t;
}

/** What a hand-edited line of the block sets, in the keys of the tune values: `a.b = 1;   // note` and `a.b.set(0xff0000); // note` both set value a.b */
function setBy(line) {
  const css = /^\s*engine\.uiRoot\.style\.setProperty\('--threedog-(.+?)'/.exec(line);
  if (css) return { css: css[1] };
  const value = /^\s*([\w$.[\]'"]+?)(?:\.set\(|\s*=(?!=))/.exec(line);
  return value ? { value: value[1] } : {};
}

/** New values over the block's: per value, and per field inside a material. A kept line runs after the values, so one that sets a value the panel just changed must go or the old value wins */
function mergeTune(old, t) {
  const materials = { ...old.materials };
  for (const [k, v] of Object.entries(t.materials || {})) materials[k] = { ...materials[k], ...v };
  return { values: { ...old.values, ...t.values }, css: { ...old.css, ...t.css }, materials,
    kept: old.kept.filter(l => { const { css, value } = setBy(l); return !(css in (t.css ?? {})) && !(value in (t.values ?? {})); }) };
}
const countTune = t => Object.keys(t.values).length + Object.keys(t.css).length + Object.values(t.materials).reduce((a, m) => a + Object.keys(m).length, 0);

/**
 * Plan writing tune values into a file's text: { after, diff, replaced, keptValues } (diff: the old block's lines as -, the new block's as +;
 * keptValues: how many values of the old block the panel did not touch)
 * @param {string} text the file now @param {any} t tune values
 */
export function planTune(text, t) {
  const i = text.indexOf(BEGIN), j = i >= 0 ? text.indexOf(END, i) : -1;
  const old = i >= 0 && j > i ? text.slice(i, j + END.length) : null;
  const before = old ? parseTuneBlock(old) : null, merged = before ? mergeTune(before, t) : t, block = tuneBlock(merged);
  const keptValues = before ? countTune(merged) - countTune(mergeTune({ values: {}, css: {}, materials: {}, kept: [] }, t)) : 0;
  const eol = text.includes('\r\n') ? '\r\n' : '\n', written = block.replaceAll('\n', eol);   // a file keeps its own line endings
  const after = old ? text.slice(0, i) + written + text.slice(j + END.length) : text.replace(/\s*$/, '') + eol + eol + written + eol;
  const line = old ? text.slice(0, i).split('\n').length : text.replace(/\s*$/, '').split('\n').length + 2;
  const diff = [`@@ line ${line}${old ? ' (merges into the earlier tune block)' : ' (appended)'} @@`, ...(old ? old.split('\n').map(l => '- ' + l) : []), ...block.split('\n').map(l => '+ ' + l)].join('\n');
  return { after, diff, replaced: !!old, keptValues };
}

/**
 * Model generator params tuned in the panel (models: { tree: { height: 4 } }) go back to where the model is registered: the `default` of that
 * field in its params schema (`tree: { build, params: { height: { type: 'number', default: 4 } } }` in assets.js or an art module), not into the
 * tune block, because the registration is the one source the generator reads. Returns { after, diff, done: [names] } for one file's text.
 * @param {string} text @param {Record<string, Record<string, any>>} models
 */
export function planModelParams(text, models) {
  const edits = [], done = new Set(), diff = [];
  const keyOf = p => p?.key?.type === 'Identifier' ? p.key.name : p?.key?.type === 'Literal' ? String(p.key.value) : null;
  const visit = (name, obj) => {
    if (obj?.type !== 'ObjectExpression' || !models[name]) return;
    const params = obj.properties.find(p => keyOf(p) === 'params')?.value;
    if (params?.type !== 'ObjectExpression') return;
    for (const [k, v] of Object.entries(models[name])) {
      const field = params.properties.find(p => keyOf(p) === k);
      if (!field) continue;
      const val = field.value, l = lit(v);
      if (val.type === 'ObjectExpression') {
        const d = val.properties.find(p => keyOf(p) === 'default');
        if (d) edits.push([d.value.start, d.value.end, l]);
        else if (val.properties.length) { const at = val.properties.at(-1).end; edits.push([at, at, `, default: ${l}`]); }
        else edits.push([val.start + 1, val.start + 1, ` default: ${l} `]);
      } else if (val.type === 'Literal' && typeof val.value === 'string') {
        edits.push([val.start, val.end, `{ type: ${JSON.stringify(val.value.replace(/\?$/, ''))}, default: ${l} }`]);
      } else continue;
      diff.push(`@@ line ${text.slice(0, val.start).split('\n').length} @@ ${name}.params.${k}`, `- ${text.slice(val.start, val.end)}`);
      done.add(name);
    }
  };
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n.type === 'Property') visit(keyOf(n), n.value);
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier') visit(n.id.name, n.init);
    for (const k in n) if (k !== 'parent' && n[k] && typeof n[k] === 'object') walk(n[k]);
  })(parseAst(text));
  let after = text;
  for (const [s, e, t] of edits.sort((a, b) => b[0] - a[0])) after = after.slice(0, s) + t + after.slice(e);
  return { after, diff: diff.join('\n'), done: [...done] };
}

/** .js files of a game workspace that may register models (node_modules, build output and caches left out) */
const sourceFiles = root => walk(root, { skip: ['public', 'tests'], unscoped: true });

/** Write tuned model params back into the files registering them (dry run unless apply); returns names not found */
function writeModels(root, models, apply) {
  const left = new Set(Object.keys(models));
  for (const f of sourceFiles(root)) {
    const text = readFileSync(f, 'utf8');
    if (![...left].some(n => text.includes(n)) || !text.includes('params')) continue;
    let plan; try { plan = planModelParams(text, Object.fromEntries([...left].map(n => [n, models[n]]))); } catch { continue; }   // not parseable as a module: skip
    if (!plan.done.length) continue;
    console.log(`${relative(process.cwd(), f)}:\n${plan.diff}\n+ (${plan.done.join(', ')}: the panel values become the schema defaults)`);
    if (apply) writeAtomic(f, plan.after);
    for (const n of plan.done) left.delete(n);
  }
  return [...left];
}

/** .threedog/tune.json next to the file (its folder or a parent), else in the current directory (here: false with -w, which named another game) */
function tuneFile(from, here = true) {
  for (let d = resolve(from); ; d = dirname(d)) {
    const f = join(d, '.threedog', 'tune.json');
    if (existsSync(f)) return f;
    if (dirname(d) === d) break;
  }
  const f = join(process.cwd(), '.threedog', 'tune.json');
  return here && existsSync(f) ? f : null;
}

export async function main([sub, ...args]) {
  // one strict parse: --apply anywhere, at most one file
  // -w: the same workspace rule as every other command; without it the file's own folder finds tune.json, so a run from inside a game keeps working
  let p, root = process.cwd();
  try {
    p = parseOptions(args, { positional: true, flags: ['apply'], workspace: true });
    if (p.workspace !== undefined) root = command(['-w', p.workspace]).dir;
  } catch (e) { console.error('✗ ' + e.message); return 1; }
  if (p.rest.length > 1) { console.error(`✗ one file only, got ${p.rest.join(' ')}`); return 1; }
  const file = p.rest[0], apply = !!p.opt.apply, path = file ? resolve(root, file) : null;
  const src = tuneFile(path ? dirname(path) : root, p.workspace === undefined);
  if (!src) { console.error('No .threedog/tune.json yet: open the page with the dev panel (?panel=1), change values, press "write back", then run this again'); return 1; }
  const t = JSON.parse(readFileSync(src, 'utf8'));
  if (sub === 'show') { console.log(tuneBlock(t)); if (some(t.models)) console.log('// model params (written to their registration): ' + JSON.stringify(t.models)); return 0; }
  if (sub === 'write' && some(t.models)) {
    const root = dirname(dirname(src)), left = writeModels(root, t.models, apply);
    if (left.length) console.log(`Model params not written (no \`params: { ... }\` registration found under ${relative(process.cwd(), root) || '.'}): ${left.join(', ')}`);
    if (!some(t.values) && !some(t.css) && !some(t.materials)) {
      console.log(apply ? '\nWritten.' : '\nDry run: nothing written. Write it: threedog tune write --apply');
      return 0;
    }
  }
  if (sub !== 'write') { console.error('Usage: threedog tune show · threedog tune write [file] [--apply] [-w game] (dry run without --apply; file: where three.js, UI color and material values go, model params go to their registration)'); return 1; }
  // the usage shows the file as optional because model params need none; say so when these values do need one, and what would have gone in it
  if (!file) { console.error(`✗ tune write needs a file for these values: ${[...Object.keys(t.values ?? {}), ...Object.keys(t.css ?? {}).map(k => '--threedog-' + k), ...Object.keys(t.materials ?? {}).map(k => 'material ' + k)].join(', ')}. Name where they go, usually the game's entry: threedog tune write main.js`); return 1; }
  if (!existsSync(path)) { console.error(`${file} does not exist`); return 1; }
  const { after, diff, keptValues } = planTune(readFileSync(path, 'utf8'), t);
  console.log(diff);
  if (keptValues) console.log(`\nKept ${keptValues} value(s) of the earlier block that the panel did not change. To drop one, delete its line.`);
  if (!apply) { console.log(`\nDry run: nothing written. Write it: threedog tune write ${file} --apply`); return 0; }
  writeAtomic(path, after);   // the shared temp file + rename (lib/atomic.mjs): a half-written main.js would break the dev page
  console.log(`\nWritten to ${file}.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));

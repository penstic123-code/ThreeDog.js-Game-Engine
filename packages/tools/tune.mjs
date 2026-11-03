// threedog tune: write values tuned in the dev panel back into code, dry run first.
//   threedog tune show                    what the panel saved (.threedog/tune.json, written by the panel's "write back" button)
//   threedog tune write <file>            print the change as a diff (nothing is written)
//   threedog tune write <file> --apply    write it
// The change is one marked block of plain calls, replaced on the next write and appended at the end of the file the first time:
//   // threedog:tune begin ... // threedog:tune end
// It holds look values as engine.look.<part>.set({...}), material values as material.setValues({...}) by material name, engine.uniforms values, and
// style fields (values read at startup) as a `tunedStyle` literal to pass as an extra style part. Review it, then keep it or move each value where
// it belongs (the style, the material's definition); the block is a starting point, not a second source of truth.
// Model generator params (the panel's models folder) are not put in the block: each becomes the `default` in that model's params schema where it
// is registered (assets.js or an art module, found under the game folder), so the generator keeps one source (planModelParams).
// Plain equivalent: copy the numbers from the panel by hand.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { parseAst } from 'vite';
import { writeAtomic } from './lib/atomic.mjs';
import { parseOptions } from './lib/cli-args.mjs';
import { fileURLToPath } from 'node:url';

const BEGIN = '// threedog:tune begin', END = '// threedog:tune end';
const lit = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? '0x' + v.slice(1).toLowerCase() : JSON.stringify(v);
const obj = o => '{ ' + Object.entries(o).map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${v && typeof v === 'object' ? obj(v) : lit(v)}`).join(', ') + ' }';
const some = o => o && Object.keys(o).length > 0;

/**
 * The block text for saved tune values
 * @param {{ look?: Record<string, Record<string, any>>, materials?: Record<string, Record<string, any>>, uniforms?: Record<string, number>, style?: Record<string, any> }} t
 * @returns {string}
 */
export function tuneBlock(t) {
  const out = [`${BEGIN} (dev panel values written by \`threedog tune write\`; review, keep or move each value where it belongs)`];
  for (const [part, v] of Object.entries(t.look || {})) if (some(v)) out.push(`engine.look.${part}.set(${obj(v)});`);
  if (some(t.materials)) {
    out.push(`{ const tuned = ${obj(t.materials)};   // material name -> values (three.js Material.setValues)`,
      '  engine.scene.traverse(o => { for (const m of [].concat(o.material ?? [])) if (tuned[m.name]) m.setValues(tuned[m.name]); }); }');
  }
  for (const [k, v] of Object.entries(t.uniforms || {})) out.push(`engine.uniforms.${k}.value = ${lit(v)};`);
  if (some(t.style)) out.push(`// style fields read at startup: pass as an extra style part, createEngine({ style: [pack, tunedStyle] })`, `export const tunedStyle = ${obj(t.style)};`);
  out.push(END);
  return out.join('\n');
}

/**
 * Plan writing tune values into a file's text: { after, diff, replaced } (diff: the old block's lines as -, the new block's as +)
 * @param {string} text the file now @param {any} t tune values
 */
export function planTune(text, t) {
  const block = tuneBlock(t), i = text.indexOf(BEGIN), j = i >= 0 ? text.indexOf(END, i) : -1;
  const old = i >= 0 && j > i ? text.slice(i, j + END.length) : null;
  const after = old ? text.slice(0, i) + block + text.slice(j + END.length) : text.replace(/\s*$/, '') + '\n\n' + block + '\n';
  const line = old ? text.slice(0, i).split('\n').length : text.replace(/\s*$/, '').split('\n').length + 2;
  const diff = [`@@ line ${line}${old ? ' (replaces the earlier tune block)' : ' (appended)'} @@`, ...(old ? old.split('\n').map(l => '- ' + l) : []), ...block.split('\n').map(l => '+ ' + l)].join('\n');
  return { after, diff, replaced: !!old };
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
function sourceFiles(root) {
  const out = [], skip = new Set(['node_modules', 'dist', 'public', '.threedog', '.git', 'tests']);
  (function w(d) { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) { if (!skip.has(f.name)) w(p); } else if (/\.m?js$/.test(f.name)) out.push(p); } })(root);
  return out;
}

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

/** .threedog/tune.json next to the file (its folder or a parent), else in the current directory */
function tuneFile(from) {
  for (let d = resolve(from); ; d = dirname(d)) {
    const f = join(d, '.threedog', 'tune.json');
    if (existsSync(f)) return f;
    if (dirname(d) === d) break;
  }
  const f = join(process.cwd(), '.threedog', 'tune.json');
  return existsSync(f) ? f : null;
}

export async function main([sub, ...args]) {
  // one strict parse: --apply anywhere, at most one file
  let p;
  try { p = parseOptions(args, { positional: true, flags: ['apply'] }); } catch (e) { console.error('✗ ' + e.message); return 1; }
  if (p.rest.length > 1) { console.error(`✗ one file only, got ${p.rest.join(' ')}`); return 1; }
  const file = p.rest[0], apply = !!p.opt.apply;
  const src = tuneFile(file ? dirname(resolve(file)) : process.cwd());
  if (!src) { console.error('No .threedog/tune.json yet: open the page with the dev panel (?panel=1), change values, press "write back", then run this again'); return 1; }
  const t = JSON.parse(readFileSync(src, 'utf8'));
  if (sub === 'show') { console.log(tuneBlock(t)); if (some(t.models)) console.log('// model params (written to their registration): ' + JSON.stringify(t.models)); return 0; }
  if (sub === 'write' && some(t.models)) {
    const root = dirname(dirname(src)), left = writeModels(root, t.models, apply);
    if (left.length) console.log(`Model params not written (no \`params: { ... }\` registration found under ${relative(process.cwd(), root) || '.'}): ${left.join(', ')}`);
    const { models: _m, ...restT } = t;
    if (!file && !some(restT.look) && !some(restT.materials) && !some(restT.uniforms) && !some(restT.style)) {
      console.log(apply ? '\nWritten.' : '\nDry run: nothing written. Write it: threedog tune write --apply');
      return 0;
    }
  }
  if (sub !== 'write' || !file) { console.error('Usage: threedog tune show · threedog tune write [file] [--apply] (dry run without --apply; file: where look / material / uniform values go, model params go to their registration)'); return 1; }
  const path = resolve(file);
  if (!existsSync(path)) { console.error(`${file} does not exist`); return 1; }
  const { after, diff } = planTune(readFileSync(path, 'utf8'), t);
  console.log(diff);
  if (!apply) { console.log(`\nDry run: nothing written. Write it: threedog tune write ${file} --apply`); return 0; }
  writeAtomic(path, after);   // the shared temp file + rename (lib/atomic.mjs): a half-written main.js would break the dev page
  console.log(`\nWritten to ${file}.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));

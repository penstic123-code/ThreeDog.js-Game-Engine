// R16 module dependency graph → error: dependencies between modules must be written in the module definition, so the AI and GAMEMAP can see "what else must be installed with it, and what is lost if it is missing".
// Collected: requires and optional of the module definitions (object literals with name and label / install) in packages/engine/modules/<folder>/;
//   plus code that reaches other modules through e.xxx. / e.xxx?. (e, engine, this.engine, this.e). Several modules in one folder count together (gameplay holds dialogue, inventory…).
// Criteria (all errors):
//   1. Accessing another module with neither requires nor optional written → add it to requires if it is always needed; if things run without it, add it to optional and guard with ?. or if (e.xxx).
//   2. requires names a module that does not exist.
//   3. requires forms a cycle (a needs b, b needs a, neither can be installed).
//   4. A file in modules/<A>/ imports a file from modules/<B>/ (B ≠ A; static or dynamic import(), the path resolved, so '../../modules/B/x.js' counts) although no module of B is in A's requires / optional: a hidden code dependency
//      GAMEMAP cannot see. Move a helper several modules share to core/ (core/scene/screenToGround.js), declare the dependency, or list the file in SHARED.
// Two more checks at runtime: use() errors if requires are not installed first, and before / after cycles error; start() hints when an optional written as { module: 'what is lost if missing' } is absent (core/engine/modules.js).
import { ts, parse, visit, walk, read, codeOnly, strValue, importSpecs, moduleTarget, P } from './_lib.mjs';

// Allowlist: [folder, accessed module, reason]
const ALLOW = [];
// Module files other module folders may import without a dependency: [file under modules/, reason]. Keep it short: shared code belongs in core/.
const SHARED = [];
const ACCESS = /\b(?:e|engine|this\.engine|this\.e)\.(\w+)(\?)?\./g;

/** Module definitions in one file: { name, requires, optional, line } */
function moduleDefs(file) {
  const sf = parse(file), out = [];
  visit(sf, n => {
    if (!ts.isObjectLiteralExpression(n)) return;
    const prop = k => n.properties.find(p => ts.isPropertyAssignment(p) && (p.name.text ?? p.name.getText()) === k);
    const keys = n.properties.map(p => p.name?.text ?? p.name?.getText());
    const name = prop('name') && strValue(prop('name').initializer);
    if (!name || !(keys.includes('label') || keys.includes('install'))) return;
    const list = p => {
      const v = p?.initializer; if (!v) return [];
      if (ts.isArrayLiteralExpression(v)) return v.elements.map(strValue).filter(Boolean);
      if (ts.isObjectLiteralExpression(v)) return v.properties.map(x => x.name?.text ?? x.name?.getText()).filter(Boolean);
      return [];
    };
    out.push({ name, requires: list(prop('requires')), optional: list(prop('optional')), line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
  });
  return out;
}

export default {
  id: 'R16', title: 'Module dependency graph (requires / optional complete, no cycles)',
  run() {
    const out = [], folders = new Map();   // folder → { files, defs }
    for (const f of walk(P.MODULES_REL)) {
      const folder = f.slice(P.MODULES_REL.length + 1).split('/')[0];
      if (!folders.has(folder)) folders.set(folder, { files: [], defs: [] });
      const g = folders.get(folder);
      g.files.push(f);
      for (const d of moduleDefs(f)) g.defs.push({ ...d, file: f });
    }
    const all = [...folders.values()].flatMap(g => g.defs), names = new Set(all.map(d => d.name));
    // 2, 3: requires names exist, no cycles
    const req = new Map(all.map(d => [d.name, d.requires]));
    for (const d of all) for (const r of d.requires) if (!names.has(r))
      out.push({ level: 'error', file: d.file, line: d.line, msg: `requires of module "${d.name}" names a module that does not exist: "${r}"`, fix: `available module names: ${[...names].join(', ')}` });
    const state = new Map();
    const dfs = (n, path) => {
      if (state.get(n) === 2) return;
      if (state.get(n) === 1) { const d = all.find(x => x.name === n); out.push({ level: 'error', file: d.file, line: d.line, msg: `requires form a cycle: ${[...path.slice(path.indexOf(n)), n].join(' → ')}`, fix: 'make one of them optional (accessed with ?.), or split the shared part into its own module' }); return; }
      state.set(n, 1);
      for (const r of req.get(n) || []) if (names.has(r)) dfs(r, [...path, n]);
      state.set(n, 2);
    };
    for (const n of names) dfs(n, []);
    // 4: importing another module folder's file needs a declared dependency on that folder's module(s)
    for (const [folder, g] of folders) {
      const declared = new Set(g.defs.flatMap(d => [...d.requires, ...d.optional]));
      for (const f of g.files) read(f).split('\n').forEach((raw, i) => {
        for (const spec of importSpecs(raw)) {
          const t = moduleTarget(f, spec);
          if (!t || t.folder === folder || !folders.has(t.folder) || SHARED.some(([file]) => file === t.path)) continue;
          const theirs = folders.get(t.folder).defs.map(d => d.name);
          if (theirs.some(n => declared.has(n))) continue;
          out.push({ level: 'error', file: f, line: i + 1, msg: `folder ${folder} imports ${t.path} but declares no dependency on module ${theirs.join(' / ') || t.folder}`,
            fix: `move the shared code to core/ (like core/scene/screenToGround.js), add '${theirs[0] ?? t.folder}' to requires / optional, or list '${t.path}' in SHARED with a reason` });
        }
      });
    }
    // 1: accessing another module must be written in requires / optional
    for (const [folder, g] of folders) {
      const own = new Set(g.defs.map(d => d.name));
      const declared = new Set(g.defs.flatMap(d => [...d.requires, ...d.optional]));
      const seen = new Set();
      for (const f of g.files) read(f).split('\n').forEach((raw, i) => {
        for (const m of codeOnly(raw).matchAll(ACCESS)) {
          const dep = m[1];
          if (!names.has(dep) || own.has(dep) || declared.has(dep) || seen.has(dep)) continue;
          if (ALLOW.some(([fo, d]) => fo === folder && d === dep)) continue;
          seen.add(dep);
          const def = g.defs[0];
          out.push({ level: 'error', file: f, line: i + 1, msg: `folder ${folder} accesses module "${dep}" (${m[0]}), but ${def ? `module "${def.name}" ` : ''}has neither requires nor optional for it`,
            fix: `add it to requires: ['${dep}'] if it is always needed; if things run without it, add it to optional (as { ${dep}: 'what is lost if missing' } when it changes gameplay results) and guard with ?. or if (e.${dep})` });
        }
      });
    }
    return out;
  },
};

// R7 naming consistency (parses d.ts, warnings)
// A. Members named ready must all have the same shape: either all true/false properties, or all functions.
//    Mixed, `if (engine.level.ready)` is always true for a function, which the AI easily gets wrong. The minority is listed one by one.
// B. Methods whose names start with add / attach / spawn / marker / register (including exported functions in index.d.ts), when they return "something to cancel with",
//    must use one cancel convention:
//      off    returns a cancel function () => void (often written as Off in the d.ts)
//      handle returns a handle with remove()
//      stop   returns an object with stop()
//    Which one wins: the `Cancel convention:` line under `## Interface conventions` in .claude/rules/api-design.md.
//    If that file, section or line is missing, or the line names none of the three, the rule reports an error (it never skips silently).
//    Methods returning void / this / numbers (not something to cancel with) are not checked here.
// C. Members named list / get / has are methods (engine.npcs.list() and engine.entities.list.length must not both exist). Error.
// D. Methods named tick / update / apply on public types are module plumbing the module calls itself: they must be @internal (or _x), so an
//    AI does not call weather.apply() to "apply weather". Module definitions (hooks) and ALLOW are exempt. Error.
// E. Shape-based cancel check: any method (whatever its name, e.g. grids.preview) returning an object with stop() or cancel() but no remove()
//    breaks the handle convention. Media / promise types where stop() is the natural verb are on ALLOW_STOP. Warning.
// G. No Engine member named after a three.js class (raycaster, loader, mixer, composer: engine.rays is not a THREE.Raycaster) or after a verb that
//    names other APIs (load: saves.load, session.load, level.load...). Error.
// H. Every [file, name] in STABILITY.experimental (paths.mjs) has @experimental in the JSDoc right above its declaration. Error.
// Limitation: B only looks at the shape of the return type; it cannot know about methods that "return void but should be removable" (such as spawnPickup, which has no way to delete).
import { ts, dtsProgram, dtsFiles, abs, rel, read, P } from './_lib.mjs';

const PREFIX = /^(add|attach|spawn|marker|register)/;
// Allowlist: ['Type.member', reason]
const ALLOW = [
  ['Saves.apply', 'applies save data the game holds (an import, a test fixture); a game-facing verb, not a per-frame hook'],
  ['CameraRigBase.update', 'a custom camera rig implements update; the game writes it, the engine calls it'],
];
const COLLECTION = new Set(['list', 'get', 'has']);   // count / find are also common data fields (ItemEntry.count), so they are left out
const PLUMBING = new Set(['tick', 'update', 'apply']);
const ENGINE_BANNED = new Map([['raycaster', 'engine.rays'], ['loader', 'engine.assets'], ['mixer', 'engine.assets.animate'], ['composer', 'engine.post'], ['load', 'engine.stream (sources) or saves / session / content load']]);
const HOOK_OWNERS = /^(ModuleDef|Module\w*Def|\w*Hooks|UIPart|Animator)$/;   // hooks the game implements (module definitions, UI parts) and user-driven objects (Animator, like AnimationMixer)
// Return types where stop() / cancel() is the right verb: ['TypeName', reason]
const ALLOW_STOP = [['SoundHandle', 'media: a playing sound stops'], ['TweenPromise', 'a promise is cancelled'], ['MusicHandle', 'media: music stops']];
const NAMES = { off: 'returns a cancel function off()', handle: 'returns a handle with .remove()', stop: 'returns { stop() }' };
export const CONVENTION_FILE = '.claude/rules/api-design.md';
const SECTION = /^## Interface conventions\s*$/m;

/** Parse the cancel convention out of the doc text; returns { kind } or { error } (exported for the rule tests) */
export function conventionFromText(text) {
  const sec = text.split(/\n(?=#+ )/).find(s => SECTION.test(s));
  if (!sec) return { error: `no "## Interface conventions" section in ${CONVENTION_FILE}` };
  const m = sec.match(/^(?:[-*][ \t]+)?Cancel convention:[ \t]*([^\n]*)/m);
  if (!m) return { error: `no line starting with "Cancel convention:" under "## Interface conventions" in ${CONVENTION_FILE}` };
  if (/remove\(\)|handle/.test(m[1])) return { kind: 'handle' };
  if (/\boff\(\)|cancel function/.test(m[1])) return { kind: 'off' };
  if (/stop\(\)/.test(m[1])) return { kind: 'stop' };
  return { error: `the "Cancel convention:" line in ${CONVENTION_FILE} names none of: remove() / handle, off() / cancel function, stop()` };
}

function conventionFromDoc() {
  let text;
  try { text = read(CONVENTION_FILE); } catch { return { error: `${CONVENTION_FILE} not found (it holds the "## Interface conventions" section with the Cancel convention line)` }; }
  return conventionFromText(text);
}

export default {
  id: 'R7', title: 'Naming consistency (ready, cancel convention)',
  run() {
    const program = dtsProgram(), checker = program.getTypeChecker();
    const readies = [], cancels = [], shape = [];
    const isInternalDoc = m => ts.getJSDocTags(m).some(t => t.tagName.text === 'internal');
    const at = d => { const sf = d.getSourceFile(); return { file: rel(sf.fileName), line: sf.getLineAndCharacterOfPosition(d.getStart()).line + 1 }; };
    const isFn = t => checker.getSignaturesOfType(checker.getNonNullableType(t), ts.SignatureKind.Call).length > 0;
    function cancelKind(t) {
      t = checker.getNonNullableType(t);
      if (t.isUnion()) { const ks = [...new Set(t.types.map(cancelKind).filter(Boolean))]; return ks.length === 1 ? ks[0] : null; }
      if (isFn(t) && !checker.getPropertiesOfType(t).length) return 'off';
      if (isFn(t)) return 'off';
      for (const [k, m] of [['handle', 'remove'], ['stop', 'stop']]) { const p = checker.getPropertyOfType(t, m); if (p && isFn(checker.getTypeOfSymbol(p))) return k; }
      return null;
    }
    for (const f of dtsFiles()) {
      const sf = program.getSourceFile(abs(f));
      if (!sf) continue;
      const owners = [];
      ts.forEachChild(sf, s => { if ((ts.isInterfaceDeclaration(s) || ts.isClassDeclaration(s)) && s.name) owners.push(s); });
      for (const o of owners) for (const m of o.members) {
        if (!m.name) continue;
        const name = m.name.getText(), who = `${o.name.text}.${name}`;
        if (ALLOW.some(([w]) => w === who)) continue;
        const sym = m.symbol;
        if (name === 'ready') {
          const t = checker.getTypeOfSymbol(sym);
          const kind = ts.isMethodSignature(m) || ts.isMethodDeclaration(m) || isFn(t) ? 'function' : (t.flags & ts.TypeFlags.BooleanLike || /^boolean$/.test(checker.typeToString(t)) ? 'true/false' : checker.typeToString(t));
          readies.push({ who, kind, ...at(m) });
        }
        const isMethod = ts.isMethodSignature(m) || ts.isMethodDeclaration(m);
        // G
        if (o.name.text === 'Engine' && ENGINE_BANNED.has(name))
          shape.push({ level: 'error', ...at(m), msg: `Engine.${name} reads like a three.js class or a verb used by other APIs`, fix: `use ${ENGINE_BANNED.get(name)} instead` });
        // C
        if (COLLECTION.has(name) && !isMethod && !isFn(checker.getTypeOfSymbol(sym)))
          shape.push({ level: 'error', ...at(m), msg: `${who} is a property; list / get / has / count / find are methods everywhere else`, fix: `make it ${name}()` });
        // D
        if (PLUMBING.has(name) && isMethod && !isInternalDoc(m) && !HOOK_OWNERS.test(o.name.text))
          shape.push({ level: 'error', ...at(m), msg: `${who}() is module plumbing on a public type`, fix: 'tag it @internal (or rename it _x) and call it from the module hook only' });
        // E
        if (isMethod) {
          const sig = checker.getSignatureFromDeclaration(m), ret = sig && checker.getNonNullableType(sig.getReturnType());
          const has = n => { const p = ret && checker.getPropertyOfType(ret, n); return p && isFn(checker.getTypeOfSymbol(p)); };
          const tn = ret?.getSymbol()?.name ?? '';
          const selfRet = m.type && (ts.isThisTypeNode(m.type) || m.type.getText() === o.name.text);   // returning this is chaining (music.addTracks), not a handle
          if (ret && !selfRet && !ret.isUnion() && (has('stop') || has('cancel')) && !has('remove') && !ALLOW_STOP.some(([t]) => t === tn) && !/Promise/.test(checker.typeToString(ret)))
            shape.push({ level: 'warn', ...at(m), msg: `${who}() returns ${has('stop') ? 'stop()' : 'cancel()'} without remove()`, fix: 'return a handle with remove() (the cancel convention), or add the type to ALLOW_STOP with a reason' });
        }
        const chain = m.type && (ts.isThisTypeNode(m.type) || m.type.getText() === o.name.text);   // returning this is chaining, not cancelling
        if (PREFIX.test(name) && !chain && (ts.isMethodSignature(m) || ts.isMethodDeclaration(m))) {
          const sig = checker.getSignatureFromDeclaration(m);
          const k = sig && cancelKind(sig.getReturnType());
          if (k) cancels.push({ who, kind: k, ...at(m) });
        }
      }
      ts.forEachChild(sf, s => {
        if (ts.isFunctionDeclaration(s) && s.name && PREFIX.test(s.name.text)) {
          const sig = checker.getSignatureFromDeclaration(s), k = sig && cancelKind(sig.getReturnType());
          if (k) cancels.push({ who: s.name.text, kind: k, ...at(s) });
        }
      });
    }
    const out = [...new Map(shape.map(x => [x.msg, x])).values()];
    // H
    for (const [file, name] of P.STABILITY.experimental) {
      let lines; try { lines = read(file).split('\n'); } catch { out.push({ level: 'error', file, line: 0, msg: `STABILITY lists ${file}, which does not exist`, fix: 'fix the entry in packages/tools/paths.mjs' }); continue; }
      const decl = new RegExp(String.raw`^\s*(export\s+)?((async\s+)?(function|class|interface)\s+${name}\b|(async\s+)?${name}\s*\(|${name}\??:)`);
      const hits = lines.flatMap((l, i) => decl.test(l) ? [i] : []), at = hits[0] ?? -1;
      const tagged = d => { for (let i = d - 1; i >= 0 && i >= d - 30; i--) { if (lines[i].includes('@experimental')) return true; if (!/^\s*(\/\*\*|\*)/.test(lines[i])) return false; } return false; };
      const ok = hits.some(tagged);   // any declaration of that name (a file may declare it twice, e.g. a handle's enable() and the class's)
      if (!ok) out.push({ level: 'error', file, line: at + 1, msg: at < 0 ? `STABILITY lists ${name}, not declared in ${file}` : `${name} is listed as experimental but its JSDoc has no @experimental`,
        fix: 'add @experimental to the JSDoc right above it (or remove it from STABILITY.experimental in packages/tools/paths.mjs)' });
    }
    // A
    const kinds = [...new Set(readies.map(r => r.kind))];
    if (kinds.length > 1) {
      const count = k => readies.filter(r => r.kind === k).length;
      const major = kinds.sort((a, b) => count(b) - count(a))[0];
      for (const r of readies.filter(r => r.kind !== major))
        out.push({ level: 'warn', file: r.file, line: r.line, msg: `${r.who} is ${r.kind}, while ${readies.filter(x => x.kind === major).map(x => x.who).join(', ')} are ${major}`,
          fix: `make ready one shape (most are ${major}); if you cannot, rename it (e.g. isReady() / loaded) so if (x.ready) cannot be written wrong` });
    }
    // B (overloads of a same-named method count once)
    const seen = new Map();
    for (const c of cancels) { const k = `${c.who}|${c.kind}`; if (!seen.has(k)) seen.set(k, c); }
    const list = [...seen.values()];
    const doc = conventionFromDoc();
    if (doc.error) {
      out.push({ level: 'error', file: CONVENTION_FILE, line: 0, msg: doc.error, fix: 'add under "## Interface conventions" a line such as "Cancel convention: returns a handle with remove()"' });
      return out;
    }
    const rule = doc.kind;
    for (const c of list.filter(c => c.kind !== rule))
      out.push({ level: 'warn', file: c.file, line: c.line, msg: `${c.who} ${NAMES[c.kind]}, which differs from the convention "${NAMES[rule]}"`,
        fix: `change it to ${NAMES[rule]}` });
    out.note = `cancel convention "${NAMES[rule]}" comes from ${CONVENTION_FILE}`;
    return out;
  },
};

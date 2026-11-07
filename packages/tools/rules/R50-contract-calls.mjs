// R50 calls on a contract-backed module stay inside its contract (error): engine code outside a module calls engine.<slot>.<member> only when
// <member> is in that slot's contract (modules/**/contract.js or *.contract.js: api or fields). Why: the contract check (@threedog/tools/contract) is
// the yes / no answer to "can I replace this module with my own"; a call it does not list passes the check and then crashes the game with the
// replacement installed (net called inventory.contents() and content called inventory.renameIds() while the contract had neither: review C #1).
// Scanned: core/, modules/, render/, ui/, index.js, minus the module's own files (the file whose module definition is named or provides the slot,
// the same-folder files it imports, and same-folder files that import it without defining another module: the camera variants on camera/common.js).
// Matched: `e | engine | this.engine | this.e` . <slot> . <member>, and a local holding the slot (const inv = e.inventory; const { inventory: inv } = e; inv.contents()).
// Not flagged: `_` members (R25), an optional call `e.dialogue.bubbles?.(...)` (the caller already copes with a module without it).
// A live character is no slot, yet a replacement gives it all the same (characters/character.contract.js), so it is followed too, `_` members included (R25 sees only e.<slot>):
// engine.player, control.characterOf(id), a local holding one, and a function that hands one back (world._character, Interactions' walkerOf).
// Limits, the most a text scan can do: a character passed in as a parameter or kept in a field is not followed, and a local is matched by name through its whole file.
import { metadata } from 'threedog/metadata';
import { walk, read, codeOnly, engineFiles, resolveImport, P } from './_lib.mjs';

const ENG = String.raw`(?:e|engine|this\.engine|this\.e)\??\.`;
const isContract = f => /(^|[/.])contract\.js$/.test(f);
const folderOf = f => f.slice(P.MODULES_REL.length + 1).split('/')[0];
const defines = (text, slot) => new RegExp(String.raw`\bname:\s*'${slot}'|provides:\s*\[[^\]]*'${slot}'`).test(text);
const definesAny = text => /\bname:\s*'\w+'[^\n]*\b(install|label)\b|\bprovides:\s*\[/.test(text);
// a right-hand side that ends in the receiver: not a member of it, and not an argument of a call (`const near = closest(e.player, 3)`)
const endsHere = String.raw`(?!\??\.)(?=\s*(?:[;,:\n]|$|\?\?|\|\|))`;
export const declared = (text, source) => [...text.matchAll(new RegExp(String.raw`(?:\b(?:const|let)\s+|,\s*)(\w+)\s*=\s*((?:(?!,\s*\w+\s*=[^=>])[^;\n])*?)${source}${endsHere}`, 'gm'))]
  .filter(m => m[2].split('(').length === m[2].split(')').length).map(m => m[1]);
/** Locals destructured from the engine: const { inventory: inv, audio } = e */
const destructured = (text, slot) => [...text.matchAll(/\b(?:const|let)\s*\{([^}]*)\}\s*=\s*(?:\w+\.)*(?:e|engine)\b(?!\.)/g)]
  .flatMap(m => m[1].split(',').map(p => p.trim().split(/\s*:\s*/))).filter(([k]) => k === slot).map(([k, v]) => v ?? k);
const LOOKUP = String.raw`\bcharacterOf\([^()]*\)`, PLAYER = String.raw`\b${ENG}player\b`;
/** Functions that hand a live character back: the line that names one and returns */
export const handsBack = text => [...text.matchAll(/^\s*(?:const\s+)?(\w+)\s*(?:=\s*)?\([^()\n]*\)\s*(?:=>\s*)?\{[^\n]*\breturn\b[^\n]*$/gm)].filter(m => /\bcharacterOf\(/.test(m[0])).map(m => m[1]);
const sameFolderImports = f => [...read(f).matchAll(/\bfrom\s+['"](\.\/[^'"]+)['"]/g)].map(m => resolveImport(f, m[1])).filter(Boolean);

/** The module's own files: definers, what they import in their folder (transitively), same-folder files importing a definer that define nothing else */
function ownFiles(slot, moduleFiles) {
  const definers = moduleFiles.filter(f => !isContract(f) && defines(read(f), slot)), own = new Set(definers), todo = [...definers];
  while (todo.length) for (const g of sameFolderImports(todo.pop())) if (!own.has(g)) { own.add(g); todo.push(g); }
  for (const f of moduleFiles) if (!own.has(f) && !definesAny(read(f)) && sameFolderImports(f).some(g => definers.includes(g))) own.add(f);
  return own;
}

export default {
  id: 'R50', title: 'Calls on a contract-backed module are in its contract',
  run() {
    const out = [], moduleFiles = walk(P.MODULES_REL);
    const contracts = Object.entries(metadata.contracts).filter(([, c]) => c.kind !== 'object').map(([slot, c]) => ({ file: c.file, slot, ok: new Set([...c.api, ...c.fields]), own: ownFiles(slot, moduleFiles) }));
    for (const f of engineFiles()) {
      if (isContract(f)) continue;
      const text = read(f).split('\n').map(codeOnly);
      for (const c of contracts) {
        if (c.own.has(f)) continue;
        const aliases = [...declared(text.join('\n'), String.raw`\b${ENG}${c.slot}\b`), ...destructured(text.join('\n'), c.slot)];
        const heads = [`\\b${ENG}${c.slot}`, ...aliases.map(a => `\\b${a}`)].join('|');
        const re = new RegExp(String.raw`(?:${heads})\??\.([A-Za-z]\w*)(\?\.\()?`, 'g');
        text.forEach((line, i) => {
          for (const m of line.matchAll(re)) {
            if (m[2] || c.ok.has(m[1])) continue;
            out.push({ level: 'error', file: f, line: i + 1, msg: `${f.startsWith(P.MODULES_REL) ? `module folder ${folderOf(f)}` : 'engine code'} calls ${c.slot}.${m[1]}, which ${c.file} does not list`,
              fix: `add '${m[1]}' to the contract's api (or fields) and to every implementation it runs in tools test "contracts" (the fakes too); or call it optionally (${c.slot}.${m[1]}?.(...)) when the caller copes without it` });
          }
        });
      }
    }
    // a live character: every file but the characters folder's own
    const live = metadata.contracts.character, ok = new Set([...live.api, ...live.fields]), own = ownFiles('characters', moduleFiles), scanned = engineFiles().filter(f => !isContract(f) && !own.has(f));
    const wrappers = [...new Set(scanned.flatMap(f => handsBack(read(f).split('\n').map(codeOnly).join('\n'))))];
    const sources = [LOOKUP, PLAYER, ...wrappers.map(w => String.raw`\b${w}\([^()]*\)`)].join('|');
    for (const f of scanned) {
      const text = read(f).split('\n').map(codeOnly), aliases = declared(text.join('\n'), `(?:${sources})`);
      const re = new RegExp(String.raw`(?:${[sources, ...aliases.map(a => `\\b${a}`)].join('|')})\??\.(\w+)(\?\.\()?`, 'g');
      text.forEach((line, i) => {
        for (const m of line.matchAll(re)) {
          if (m[2] || ok.has(m[1])) continue;
          out.push({ level: 'error', file: f, line: i + 1, msg: `${f.startsWith(P.MODULES_REL) ? `module folder ${folderOf(f)}` : 'engine code'} reads ${m[0]} on a live character, which ${live.file} does not list`,
            fix: `add '${m[1]}' to that contract's api (or fields), with a name that has no \`_\`; or call it optionally when the caller copes without it` });
        }
      });
    }
    out.note = `${contracts.length} contracts: ${contracts.map(c => c.slot).join(', ')}`;
    return out;
  },
};

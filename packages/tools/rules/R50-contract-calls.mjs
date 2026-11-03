// R50 calls on a contract-backed module stay inside its contract (error): engine code outside a module calls engine.<slot>.<member> only when
// <member> is in that slot's contract (modules/**/contract.js or *.contract.js: api or fields). Why: the contract check (@threedog/tools/contract) is
// the yes / no answer to "can I replace this module with my own"; a call it does not list passes the check and then crashes the game with the
// replacement installed (net called inventory.contents() and content called inventory.renameIds() while the contract had neither: review C #1).
// Scanned: core/, modules/, render/, ui/, index.js, minus the module's own files (the file whose module definition is named or provides the slot,
// the same-folder files it imports, and same-folder files that import it without defining another module: the camera variants on camera/common.js).
// Matched: `e | engine | this.engine | this.e` . <slot> . <member>, and a local holding the slot (const inv = e.inventory; inv.contents()).
// Not flagged: `_` members (R25), an optional call `e.dialogue.bubbles?.(...)` (the caller already copes with a module without it).
import { pathToFileURL } from 'node:url';
import { walk, read, codeOnly, engineFiles, resolveImport, abs, P } from './_lib.mjs';

const ENG = String.raw`(?:e|engine|this\.engine|this\.e)\??\.`;
const isContract = f => /(^|[/.])contract\.js$/.test(f);
const folderOf = f => f.slice(P.MODULES_REL.length + 1).split('/')[0];
const defines = (text, slot) => new RegExp(String.raw`\bname:\s*'${slot}'|provides:\s*\[[^\]]*'${slot}'`).test(text);
const definesAny = text => /\bname:\s*'\w+'[^\n]*\b(install|label)\b|\bprovides:\s*\[/.test(text);
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
  async run() {
    const out = [], moduleFiles = walk(P.MODULES_REL), contracts = [];
    for (const f of moduleFiles.filter(isContract)) {
      const c = (await import(pathToFileURL(abs(f)).href)).default;
      if (c.kind !== 'object') contracts.push({ file: f, slot: c.name, ok: new Set([...c.api, ...(c.fields ?? [])]), own: ownFiles(c.name, moduleFiles) });
    }
    for (const f of engineFiles()) {
      if (isContract(f)) continue;
      const text = read(f).split('\n').map(codeOnly);
      for (const c of contracts) {
        if (c.own.has(f)) continue;
        const aliases = [...text.join('\n').matchAll(new RegExp(String.raw`\b(?:const|let)\s+(\w+)\s*=\s*${ENG}${c.slot}\s*(?=[;,)\n]|$)`, 'gm'))].map(m => m[1]);
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
    out.note = `${contracts.length} contracts: ${contracts.map(c => c.slot).join(', ')}`;
    return out;
  },
};

// R57 every engine module says how engine.skip advances it (error). Read from the metadata, so a module is checked by what its definition really holds, a computed one too.
// Why static: engine.catalog reports a gap only for the modules a game installs, and only a module with a fixed or skip hook; here every module must answer.
// approx and step promise work a hook does, so they need one. checkSkip proves a kind at run time; this rule only proves it was declared.
import { metadata } from 'threedog/metadata';

/** @param {Record<string, any>} modules @returns {{ file: string, msg: string }[]} */
export function problems(modules) {
  const out = [];
  for (const [name, m] of Object.entries(modules)) {
    if (!metadata.skipKinds.includes(m.time.kind)) out.push({ file: m.file, msg: `module ${name} has no valid skipKind (${m.time.kind ?? 'none written'})` });
    else if (['approx', 'step'].includes(m.time.kind) && !m.time.hooks.includes('skip')) out.push({ file: m.file, msg: `module ${name} says skipKind '${m.time.kind}' but has no skip hook` });
  }
  return out;
}

export default {
  id: 'R57', title: 'Every engine module declares its skip kind',
  run() {
    return problems(metadata.modules).map(p => ({ level: /** @type {const} */ ('error'), file: p.file, line: 1, msg: p.msg, fix: `add skipKind: ${metadata.skipKinds.map(k => `'${k}'`).join(' | ')} to the definition, then npm run map` }));
  },
};

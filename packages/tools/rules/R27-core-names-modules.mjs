// Detection: R27 core names no concrete module. Core (packages/engine/core) is what every game has; it must not know the shape of a particular module
// (timeline.runs, rigid.bodies...): a module rename or refactor would break core silently, because ?. turns a broken access into "absent".
// Flags code (not comments or strings) in core that reads e.<module> / engine.<module> / this.<module> for a module name defined in packages/engine/modules
// (the names come from the module definitions: name: '...', label: ...). Core reaches modules through hooks instead: describe, counts, skip, isReady,
// events such as session:end, and the ground interface (ground.viewRange).
// Known limits: only those receiver names; a module reached through another variable (const m = engine.modules.get(...)) is not seen. Allowlist below, each with its reason.
import { walk, lines, codeOnly, P } from './_lib.mjs';

// [core file, module, reason]
const ALLOW = [
  ['actor.js', 'world', 'world is the record store: an actor id is a world record, and actorPosition falls back to it'],
  ['Inspect.js', 'world', 'inspect / explain look up actor ids in the record store'],
  ['thingOps.js', 'world', 'engine.thing / thing.set / thing.remove share one id space with world records: a record id is answered and changed by world'],
  ['things.js', 'world', 'claimId keeps one id space across engine.add objects and world records, checked from both doors'],
  ['sceneMethods.js', 'world', 'engine.add refuses (dev) an object that is a world model: world places it every frame, two systems would manage it'],
  ['opsCheck.js', 'world', "ops args typed 'id' must name an existing world record"],
  ['skip.js', 'sky', 'engine.skip({ to: "06:00" }) reads the sky clock it skips to and its next clock mark'],
  ['skip.js', 'flow', 'a fading skip goes through flow.transition when flow is installed, so it queues with other transitions'],
];

/** Module names from the module definitions in packages/engine/modules */
function moduleNames() {
  const names = new Set();
  for (const f of walk(P.MODULES_REL)) for (const m of lines(f).join('\n').matchAll(/\bname: '(\w+)', label:/g)) names.add(m[1]);
  return names;
}

export default {
  id: 'R27', title: 'Core names no concrete module (reach modules through hooks and events)',
  run() {
    const out = [], names = moduleNames();
    const re = /\b(?:e|engine|this)\.(\w+)\b/g;
    for (const f of walk(P.CORE_REL)) {
      const base = f.slice(P.CORE_REL.length + 1);
      lines(f).forEach((raw, i) => {
        const code = codeOnly(raw);
        if (/^\s*\*/.test(raw)) return;   // JSDoc body line
        for (const m of code.matchAll(re)) {
          if (!names.has(m[1]) || ALLOW.some(([file, mod]) => file === base && mod === m[1])) continue;
          out.push({ level: 'error', file: f, line: i + 1, msg: `core reads the ${m[1]} module directly (${m[0]})`,
            fix: 'let the module do it through a hook (describe, counts, skip, isReady) or an event (session:end, engine:ready); if core truly needs it, add [file, module, reason] to ALLOW in R27' });
        }
      });
    }
    out.note = `module names: ${names.size}; allowlist: ${ALLOW.length}`;
    return out;
  },
};

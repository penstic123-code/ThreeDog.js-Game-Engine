// R25 cross-module private access → error: a module reads or writes another module's (or the engine's) underscore members.
// Why: `_x` members are internal and carry no type; another folder that uses one breaks silently when it is renamed. What a module genuinely shares
// gets a small documented method (collision.walkableAt, nav.revision, world.buildingId, character.syncRecord...); `_` stays for use inside its own folder.
// Detection: in packages/engine/modules/<A>/**, `e | engine | this.engine | this.e` followed by `._name` (an engine private), or by `.<module>._name`
// where <module> is installed by another folder or is a core service (ops, saves, world...). Lines are matched as text with strings and comments removed.
// Limits: an alias (const W = e.world; W._x) and members reached through a returned object are not followed. The allowlist names what other passes still own.
import { walk, read, codeOnly, P } from './_lib.mjs';

// [folder, member, reason]; folder '*' = any folder
const ALLOW = [
  ['rigid', 'control._resolve', 'ragdoll takes a character id: control is the one place that finds a character by id'],
  ['rigid', 'assets._animators', 'ragdoll holds the animator of a bare model: the only record of it, and a public getter would be one more name for one caller'],
  ['characters', 'collision._blocked', 'the simple mover skips blockedAt when no blocked ground exists (a per-step shortcut); characters is being changed by another pass: give collision a hasBlocked getter then'],
  ['debug', '_cpuMs', 'the panel adds up the cost of every frame; engine.inspect.perf() walks the materials and is too heavy to call each frame'],
  ['world', '_things', 'adds its record store with engine._things.addSource at install: the one door core offers to record stores'],
];
// LookPart private fields reached through any name (part._owners, p._write, look.fog._params ...): the engine-prefix pattern above misses an alias
const REACH = /\b(?:e|engine|this\.engine|this\.e)(?:\?)?\.(?:(\w+)\??\.)?(_\w+)/g;
// Another module held in a local first (const inv = e.inventory; inv._containers): the alias is followed within the file. Why: net reached
// inventory._containers this way and the engine-prefix pattern alone never saw it (review 0.4 E)
const ALIAS = /\b(?:const|let)\s+(\w+)\s*=\s*(?:e|engine|this\.engine|this\.e)\??\.(\w+)\s*(?=[;,)\n]|$)/gm;

export default {
  id: 'R25', title: 'No reaching into another module\'s private members',
  run() {
    const out = [];
    for (const f of walk(P.MODULES_REL)) {
      const folder = f.slice(P.MODULES_REL.length + 1).split('/')[0];
      const text = read(f), aliases = [...text.split('\n').map(codeOnly).join('\n').matchAll(ALIAS)].filter(([, , owner]) => owner !== folder);
      text.split('\n').forEach((raw, i) => {
        for (const [, name, owner] of aliases) for (const m of codeOnly(raw).matchAll(new RegExp(`\\b${name}\\??\\.(_\\w+)`, 'g'))) {
          if (ALLOW.some(([fo, mem]) => (fo === '*' || fo === folder) && mem === `${owner}.${m[1]}`)) continue;
          out.push({ level: 'error', file: f, line: i + 1, msg: `module folder ${folder} reaches into engine.${owner}'s private ${m[1]} through ${name} (${m[0]})`,
            fix: 'call a public method of the owner (add a small documented one when none fits); or add [folder, member, reason] to ALLOW in this file' });
        }
        for (const m of codeOnly(raw).matchAll(REACH)) {
          const [, owner, priv] = m, member = owner ? `${owner}.${priv}` : priv;
          if (owner === folder) continue;   // its own module (folder name = module name: world, nav, collision...)
          if (ALLOW.some(([fo, mem]) => (fo === '*' || fo === folder) && mem === member)) continue;
          out.push({ level: 'error', file: f, line: i + 1, msg: `module folder ${folder} reaches into ${owner ? `engine.${owner}` : 'the engine'}'s private ${priv} (${m[0]})`,
            fix: 'add a small documented method or getter to the owner (an @internal one is fine when only modules need it) and call that; or add [folder, member, reason] to ALLOW in this file' });
        }
      });
    }
    out.note = `${ALLOW.length} allowlisted members`;
    return out;
  },
};

// R25 cross-module private access → error: a module reads or writes another module's (or the engine's) underscore members.
// Why: `_x` members are internal and carry no type; another folder that uses one breaks silently when it is renamed. What a module genuinely shares
// gets a small documented method (collision.walkableAt, nav.revision, world.buildingId, character.syncRecord...); `_` stays for use inside its own folder.
// Detection: in packages/engine/modules/<A>/**, `e | engine | this.engine | this.e` followed by `._name` (an engine private), or by `.<module>._name`
// where <module> is installed by another folder or is a core service (ops, saves, world...). Lines are matched as text with strings and comments removed.
// Limits: an alias (const W = e.world; W._x) and members reached through a returned object are not followed. The allowlist names what other passes still own.
import { walk, read, codeOnly, P } from './_lib.mjs';

// [folder, member, reason]; folder '*' = any folder
const ALLOW = [
  ['net', 'ops._client', 'net routing hooks kept in core Ops.js; net is deferred (user decision), experimental'],
  ['net', 'ops._route', 'net routing hooks kept in core Ops.js; net is deferred (user decision), experimental'],
  ['net', 'ops._log', 'host logs refused peer requests into the op history; net is deferred (user decision)'],
  ['net', 'world._s', 'client switches off world simulation; net is deferred (user decision)'],
  ['net', 'inventory._containers', 'container sync; net is deferred (user decision)'],
];
const REACH = /\b(?:e|engine|this\.engine|this\.e)(?:\?)?\.(?:(\w+)\??\.)?(_\w+)/g;

export default {
  id: 'R25', title: 'No reaching into another module\'s private members',
  run() {
    const out = [];
    for (const f of walk(P.MODULES_REL)) {
      const folder = f.slice(P.MODULES_REL.length + 1).split('/')[0];
      read(f).split('\n').forEach((raw, i) => {
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

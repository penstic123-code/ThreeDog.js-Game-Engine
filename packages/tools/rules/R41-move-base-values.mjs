// R41 engine modules never write a character's base movement values (docs/plans/done/2026-11-02-gameplay-architecture.md §2.6).
// speed / runSpeed / gravity / jumpSpeed on a character are the game's base values: player.speed = 6 is always fine in a game. An engine module that
// changes them (stamina, a status effect, mud) adds a modifier instead, engine.mod('move.speed', { owner, id, mul }), so effects from several systems
// end in any order and the game's own write is never undone.
// Detection: error on code (not comments or strings) under packages/engine/modules that assigns (=, +=, -=, *=, /=) .speed / .runSpeed / .gravity /
// .jumpSpeed on anything but `this` (an object's own field, set by its own class: Character's constructor, the physics world's gravity).
// Known limits: Object.assign(c, { speed }) and destructured writes are not seen; a receiver that is not a character (vehicle.speed) is flagged too
// and goes in ALLOW with its reason. Games are not scanned: the base values are theirs.
import { walk, lines, codeOnly, P } from './_lib.mjs';

// [file relative to packages/engine/modules, receiver.field, reason]
const ALLOW = [];

const RE = /([\w$.\]\)]+)\.(speed|runSpeed|gravity|jumpSpeed)\s*(?:[-+*/])?=(?!=)/g;
/** The base-field writes on one source line: [{ receiver, field, text }] (comments, strings and this.<field> left out) */
export const baseWrites = raw => /^\s*\*/.test(raw) ? [] : [...codeOnly(raw).matchAll(RE)].filter(m => m[1] !== 'this').map(m => ({ receiver: m[1], field: m[2], text: m[0].trim() }));

export default {
  id: 'R41', title: 'Engine modules change move stats through engine.mod, never the base fields',
  run() {
    const out = [];
    for (const f of walk(P.MODULES_REL)) {
      const base = f.slice(P.MODULES_REL.length + 1);
      lines(f).forEach((raw, i) => {
        for (const w of baseWrites(raw)) {
          if (ALLOW.some(([file, what]) => file === base && what === `${w.receiver}.${w.field}`)) continue;
          out.push({ level: 'error', file: f, line: i + 1, msg: `an engine module writes the base ${w.field} (${w.text})`,
            fix: `add a modifier instead: engine.mod('move.${w.field}', { owner: '<module>', id, mul | add | set }) (the base belongs to the game); not a character? add [file, receiver.field, reason] to ALLOW in R41` });
        }
      });
    }
    out.note = `allowlist: ${ALLOW.length}`;
    return out;
  },
};

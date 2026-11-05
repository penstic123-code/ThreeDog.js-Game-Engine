// R17 "who acts" read straight from the player: `player?.position ?? …focus` / `player ? player.position : focus` in packages/engine/modules → warning.
// Why: interactions, trigger zones, markers and ops measure from engine.actor (core/ops/actor.js). A module that reads engine.player on its own
// breaks as soon as a game hands control to a vehicle, another squad member or a selected unit, and each module would grow its own fallback.
// Fix: engine.actorPosition() (the player by default, engine.focus without one). Code that really means the player's own body
// (its physics capsule, its model) ends the line with // player-body.
import { engineFiles, lines, codeOnly, lineTag, reE } from './_lib.mjs';

const BAD = /player\?\.position\s*\?\?[^;]*focus|player\s*\?\s*[\w.]*player\.position\s*:\s*[\w.]*focus/;

export default {
  id: 'R17', title: 'Modules read the acting character through engine.actorPosition()',
  run() {
    const out = [];
    for (const f of engineFiles().filter(f => reE('modules\\/').test(f))) {
      lines(f).forEach((raw, i) => {
        if (!BAD.test(codeOnly(raw)) || lineTag(f, i + 1, ['player-body'])) return;
        out.push({ level: 'warn', file: f, line: i + 1, msg: `reads the player directly as "who acts": ${raw.trim().slice(0, 80)}`,
          fix: "use engine.actorPosition() (follows engine.actor); if it really is the player's own body, end the line with // player-body" });
      });
    }
    return out;
  },
};

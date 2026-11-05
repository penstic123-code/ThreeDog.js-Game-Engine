// The "Already here" table of a new game's CLAUDE.md is not written twice: it is cut from AI.md (the one task table) at new-game time.
// KEYS picks the rows by the start of their first cell, chosen from what real games write (docs/testing/api-count.md "Daily surface").
// A key that matches no row (AI.md renamed it) is a `check` error (R22), so the two cannot drift apart silently.
const KEYS = ['Third-person start', 'Save game', 'New game / continue', 'Keys, gamepad', 'Camera: follow', 'Player, characters', 'NPCs and what', 'Press E on a mesh',
  'Quests, objective', 'Items, chests', 'UI, menus, HUD', 'Sound, music'];

/** The table rows of AI.md as [to-do, use, recipe] */
function aiRows(aiText) {
  return aiText.split(/\r?\n/).filter(l => /^\| /.test(l) && !/^\|[-| ]+\|$/.test(l)).map(l => l.slice(1, l.lastIndexOf('|')).split(/ \| /).map(c => c.trim())).filter(r => r.length === 3);
}

/** { table, missing }: the markdown table for CLAUDE.md, and the keys no AI.md row starts with */
export function defaultLayer(aiText) {
  const rows = aiRows(aiText), missing = [], out = ['| Needs | Use | Recipe |', '|---|---|---|'];
  for (const k of KEYS) {
    const r = rows.find(x => x[0].startsWith(k));
    if (r) out.push(`| ${r.join(' | ')} |`); else missing.push(k);
  }
  return { table: out.join('\n'), missing };
}

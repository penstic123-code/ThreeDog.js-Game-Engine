// GAMEMAP quest section (called by gamemap.mjs): one line per quest, then its steps; a parallel step lists its goals.

/** Lines for content/quests.js. describeCond / describeEffect use the game's vocabulary, pos prints a position */
export function questLines(c, describeCond, describeEffect, pos) {
  const ql = [];
  const tgt = t => (t.npc ? `NPC ${t.npc}` : t.nearest ? `nearest ${t.nearest}` : typeof t === 'string' ? t : pos(t));
  const line = (s, n) => `${n} ${s.optional ? '(optional) ' : ''}${s.text} ⟶ ${describeCond(s.done)}`
    + (s.target !== undefined ? ` (target: ${tgt(s.target)})` : '');
  for (const [id, q] of Object.entries(c.quests || {})) {
    ql.push(`- **${id}** ${q.title}${q.startOn ? ` (starts on ${q.startOn})` : ''}${q.reward ? `, reward: ${describeEffect(q.reward)}` : ''}`
      + (q.fail ? `, fails if ${describeCond(q.fail)}` : ''));
    q.steps.forEach((s, i) => ql.push(...s.all ? [`  ${i + 1}. all of${s.text ? ` "${s.text}"` : ''}:`, ...s.all.map(p => line(p, '     -'))]
      : [line(s, `  ${i + 1}.`)]));
  }
  return ql;
}

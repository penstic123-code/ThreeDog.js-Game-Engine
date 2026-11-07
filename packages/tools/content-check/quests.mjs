// Part of content validation (called by content-check.mjs): quests. ctx holds the helper functions of the main file.

/** ctx: { c, items, npcs, code, err, warn, checkRefs, checkPos, isObj, known, CONDITIONS, EFFECTS } */
export function checkQuests({ c, items, npcs, code, err, warn, checkRefs, checkPos, isObj, known, CONDITIONS, EFFECTS }) {
  const quests = c.quests || {};
  // one goal: a plain step, or a part of a parallel step
  const goal = (g, w, part) => {
    if (!g.text) err('quests', `${w} has no text (the displayed description)`);
    if (!g.done) err('quests', `${w} has no done (the completion condition)`);
    if (g.optional !== undefined && !part) err('quests', `${w} has optional, which only works on a part inside all: [...] (parallel goals); a plain step always has to be done`);
    checkRefs('quests', w, g.done, CONDITIONS, 'completion condition done');
    if (g.target === undefined) return;
    if (isObj(g.target) && (g.target.npc !== undefined || g.target.nearest !== undefined)) { /* an NPC / item target: its existence is the quests section's own references, checked once in content-check.mjs */ }
    else checkPos('quests', `target of ${w}`, typeof g.target === 'string' ? { place: g.target } : g.target);
  };
  for (const [id, q] of Object.entries(quests)) {
    const where = `quest ${id}`;
    if (!q?.title) err('quests', `${where} has no title`);
    if (!Array.isArray(q?.steps) || !q.steps.length) { err('quests', `${where} has no steps (at least one)`); continue; }
    q.steps.forEach((s, i) => {
      const w = `step #${i + 1} of ${where}`;
      if (s?.all === undefined) return goal(s || {}, w, false);
      if (!Array.isArray(s.all) || !s.all.length) return err('quests', `all of ${w} must be a list of goals [{ text, done }, …]`);
      if (s.all.every(p => p?.optional)) err('quests', `${w} has only optional goals, so it would finish at once: make at least one goal required`);
      s.all.forEach((p, k) => goal(p || {}, `goal #${k + 1} of ${w}`, true));
    });
    checkRefs('quests', `reward of ${where}`, q.reward, EFFECTS, 'reward');
    checkRefs('quests', `fail of ${where}`, q.fail, CONDITIONS, 'fail condition');
    checkRefs('quests', `onFail of ${where}`, q.onFail, EFFECTS, 'onFail');
    if (q.onFail && !q.fail) warn('quests', `${where} has onFail but no fail condition, so it never runs`);
    if (!q.startOn && !code.includes(`'${id}'`) && !JSON.stringify(c).includes(`"startQuest":"${id}"`)) warn('quests',
      `${where} has no startOn and nothing starts it (startQuest or quests.start in code), so the player can never get it`);
  }
}

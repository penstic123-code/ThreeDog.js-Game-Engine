// Content entries of the wrong shape, taken out at the door of the map (gamemap.mjs). Why here, once, and not a check at each line that reads a field: the map reads these
// kinds in a dozen places across four files, and it runs before the content check. The map shows what is there and names what it left out; saying what is wrong and how
// to write it stays with threedog check, the one owner of those rules.
const plain = x => !!x && typeof x === 'object' && !Array.isArray(x);
const stepSound = s => plain(s) && (s.all === undefined || (Array.isArray(s.all) && s.all.every(plain)));
/** The kinds the map reads field by field, with what an entry needs beyond being an object */
const KINDS = { quests: q => Array.isArray(q.steps) && q.steps.every(stepSound), actions: a => Array.isArray(a.keys), triggers: null, vegetation: null, templates: null, items: null, npcs: null, dialogues: null, props: null, pickups: null };
const LISTS = new Set(['props', 'pickups']);

/** @param {any} c loaded content @returns {{ c: any, holes: string[] }} the content without the bad entries, and their names (quests.a, props[3]) */
export function soundContent(c) {
  const out = { ...c }, holes = [];
  for (const [kind, needs] of Object.entries(KINDS)) {
    const value = c[kind], sound = e => plain(e) && (!needs || needs(e));
    if (value === undefined) continue;
    if (Array.isArray(value)) out[kind] = value.filter((e, i) => sound(e) || !holes.push(`${kind}[${i}]`));
    else if (plain(value) && !LISTS.has(kind)) out[kind] = Object.fromEntries(Object.entries(value).filter(([id, e]) => sound(e) || !holes.push(`${kind}.${id}`)));
    else { holes.push(kind); out[kind] = LISTS.has(kind) ? [] : {}; }
  }
  return { c: out, holes };
}

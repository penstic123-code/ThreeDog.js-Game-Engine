// The chaos plan: which actions exist, how often each is drawn, and the seeded draw itself. Pure data with no browser name in it: the page (driver.js) and
// the Node spec (tests/specs/chaos.mjs) both read this file. A plan is a list drawn from the seed alone and never from the state of the game, so a seed
// gives the same list on every machine, and any sub-list of it can still run: that is what lets a failure shrink by deleting actions.
// One action: { a: name, p: [numbers...], bg?: true }. bg: the driver does not wait for it, so the next action lands in the middle of this one.

/** mulberry32: small, seedable, the same in Node and the page */
export function rng(seed) {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: n => Math.floor(next() * n) };
}

/** What each action draws. w: weight. p: its numbers. bg: chance that it runs under the next action (only where it has something in flight) */
export const ACTIONS = {
  // replaceable modules: index into MODS (game.js), how: 0 replace, 1 remove, 2 reinstall
  mod: { w: 14, p: r => [r.int(8), r.int(3)] },
  save: { w: 6, p: r => [r.int(3)], bg: 0.2 },
  load: { w: 5, p: r => [r.int(3)], bg: 0.2 },
  sessionLoad: { w: 4, p: r => [r.int(3)], bg: 0.2 },
  newGame: { w: 3, p: () => [], bg: 0.2 },
  quit: { w: 1, p: () => [] },
  contentPack: { w: 5, p: r => [r.int(3)] },
  levelLoad: { w: 4, p: r => [r.int(3)], bg: 0.5 },
  levelUnload: { w: 1, p: () => [] },
  freeze: { w: 4, p: () => [] },
  skip: { w: 2, p: r => [1 + r.int(30)], bg: 0.2 },
  timeRate: { w: 2, p: r => [r.int(4)] },
  camera: { w: 5, p: r => [r.int(5), r.int(2)] },
  shot: { w: 2, p: r => [r.int(2)] },
  enterVehicle: { w: 4, p: r => [r.int(2)] },
  exitVehicle: { w: 3, p: r => [r.int(2)] },
  ragdoll: { w: 3, p: r => [r.int(2)] },
  walkTo: { w: 7, p: r => [r.int(3), r.int(41) - 20, r.int(41) - 20], bg: 1 },
  findPath: { w: 3, p: r => [r.int(3), r.int(41) - 20, r.int(41) - 20] },
  thingSet: { w: 4, p: r => [r.int(6), r.int(31) - 15, r.int(31) - 15] },
  worldMove: { w: 4, p: r => [r.int(6), r.int(31) - 15, r.int(31) - 15] },
  undo: { w: 3, p: () => [] },
  post: { w: 4, p: r => [r.int(2)] },
  cutscene: { w: 3, p: r => [r.int(2)], bg: 1 },
  cutsceneSkip: { w: 1, p: () => [] },
  give: { w: 3, p: r => [1 + r.int(4)] },
  quest: { w: 2, p: r => [r.int(3)] },
  particles: { w: 2, p: () => [] },
  pushBody: { w: 3, p: r => [r.int(3)] },
  weather: { w: 2, p: r => [r.int(3)] },
  frames: { w: 8, p: r => [1 + r.int(40)] },
  recreate: { w: 1, p: () => [] },
};

/**
 * Named skips: an action turned off because a known bug would stop every run there. The plan keeps drawing it (a seed means the same list before and
 * after the fix); the driver logs it as skipped. Delete the row when the bug is fixed. Key: 'action' or 'action:firstNumber'. Value: the reason.
 */
export const SKIPS = {};

/** The list for a seed. A full audit goes in every `every` actions, and one ends the list */
export function plan(seed, { length = 60, every = 20 } = {}) {
  const r = rng(seed), names = Object.keys(ACTIONS), total = names.reduce((n, k) => n + ACTIONS[k].w, 0), out = [];
  for (let i = 0; i < length; i++) {
    let pick = r.next() * total, name = names[0];
    for (const k of names) { pick -= ACTIONS[k].w; if (pick < 0) { name = k; break; } }
    const d = ACTIONS[name], x = { a: name, p: d.p(r) };
    if (d.bg && r.next() < d.bg) x.bg = true;
    out.push(x);
    if ((i + 1) % every === 0 && i + 1 < length) out.push({ a: 'audit', p: [] });
  }
  out.push({ a: 'audit', p: [] });
  return out;
}

/** One action as a short log line */
export const line = x => `${x.a}(${x.p.join(', ')})${x.bg ? ' &' : ''}`;

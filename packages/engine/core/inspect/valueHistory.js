// The small, plain half of the writers tool (core/inspect/pictureWriters.js): one value's history and the words that report it.
//
// Why a short history and not only "last writer": two writers that take turns look like one writer to whoever asks at the wrong moment. Why runs of one line
// and not one row per write: a value written every frame would push everything else out in a few frames, and the older line is the one being looked for.
//
// Why every answer without a fight carries LIMIT: an open engine cannot prove two pieces of plain code never meet (docs/design.md 4.6), and an AI reads
// "no conflicts" as "safe". Only watched values are seen, a write that changes nothing is invisible, and most values are only looked at now and then.
const KEEP = 8;   // runs kept per value: enough to show two writers alternating, small enough to read in one line
export const LIMIT = 'none seen is not proof of none: only watched values are seen, and writes are sampled';

/**
 * What can be hooked inside a value: three.js changes these in place, so a hook on the property that holds them would see nothing. Quaternion and Euler keep theirs in
 * underscore fields behind prototype accessors, and those fields are what an own get / set can sit on.
 * @param {any} v @returns {string | string[] | null}
 */
export const partsOf = v => v?.isColor ? 'rgb' : v?.isVector3 ? 'xyz' : v?.isVector2 ? 'xy' : v?.isQuaternion ? ['_x', '_y', '_z', '_w'] : v?.isEuler ? ['_x', '_y', '_z'] : null;

/** Add one seen write to a history: the same line again extends its run @param {any[]} h @param {{ at: string | null, frame: number, part?: string | null, owner?: string, engine?: boolean }} w */
export function remember(h, { at, frame, part, owner, engine }) {
  const top = h[h.length - 1];
  if (top?.at === at && top?.owner === owner) { top.lastFrame = frame; top.times++; return; }
  h.push({ at, frame, lastFrame: frame, times: 1, ...(part ? { part } : {}), ...(owner ? { owner } : {}), ...(engine ? { engine } : {}) });
  if (h.length > KEEP) h.shift();
}

const run = r => `${r.at ?? 'an unknown line'}${r.owner ? ` (${r.owner})` : r.engine ? ' (engine)' : r.part ? ` (part '${r.part}')` : ''} frame ${r.frame}${r.times > 1 ? `, ${r.times} looks to frame ${r.lastFrame}` : ''}`;
/** The last runs, newest first, as one clause @param {any[]} h */
export const historyText = h => h.length ? `Seen: ${h.slice(-3).reverse().map(run).join('; ')}` : '';

/** explain's answer for a shared point: it composes, so its entries and their lines are the whole story of the point, not of what it drives @param {any} e @param {string} label @param {any[]} h */
export function sharedAnswer(e, label, h) {
  const row = e.stacks.get(label).row();
  const text = [`${label}: shared point, now ${JSON.stringify(row.value)}, led by ${row.writer}${row.at ? ` (${row.at})` : ''}${row.how ? `, ${row.how}` : ''}`, historyText(h), 'Direct writes to what it drives are not seen here'];
  return { ok: true, text: text.filter(Boolean).join('. '), detail: { ...row, history: h } };
}

// Page errors from <workspace>/.threedog/errors.log (written by vite/vite-error-relay.js) as records with an id, a time, a source and a count.
//   threedog errors                new errors since the last read (moves the read position)
//   threedog errors latest [N]     the last N records (default 3); the same ones show again on every call
//   threedog errors --since 5      records after id 5 (E5 also works); never moves the read position, so it is safe to repeat
// Ids are the order of appearance in the log (E1, E2…), restarting when the dev server restarts (the log is cleared then). The "read position" stores
// the log's first line too, so a restarted dev server does not hide its new errors behind an old position.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { hintFor } from 'threedog/error-hints';
import { oneLine } from '../lib/oneline.mjs';

const HEAD = /^\[browser ([^\]×]+?)(?: ×(\d+), (\d+) total)?\] (\d\d:\d\d:\d\d)(?: tick (\d+))?/;

/** Log text → [{ id, kind, time, tick, page, code, message, source, count, hint }] (a "same as above" line adds to the count of its record) */
export function parseErrors(text) {
  const out = [];
  for (const block of text.split(/\n(?=\[browser)/).map(s => s.trim()).filter(s => s.startsWith('[browser'))) {
    const [head, ...rest] = block.split('\n'), m = HEAD.exec(head);
    if (!m) continue;
    const [, kind, repeat, , time, tick] = m;
    if (repeat) {   // the relay's summary of repeats: "… same as above: <message> (<source>)"
      const msg = head.split('same as above: ')[1] ?? '';
      const prev = [...out].reverse().find(r => r.kind === kind && msg.startsWith(oneLine(r.message).slice(0, 100)));
      if (prev) prev.count += Number(repeat);
      continue;
    }
    const page = rest.filter(l => l.startsWith('page| ')).map(l => l.slice(6));
    const end = page.findIndex((l, i) => i > 0 && /^\s*at /.test(l)), message = page.slice(1, end < 0 ? undefined : end).join('\n');
    const h = hintFor(message.replace(/\n\s*(Possible cause|Read):.*/g, ''));
    out.push({ id: out.length + 1, kind, time, tick: tick === undefined ? null : Number(tick), page: page[0] ?? '', code: message.match(/\[([a-z][\w-]*)\]/)?.[1] ?? null,
      message, source: end < 0 ? '' : page[end].trim().replace(/^at /, ''), count: 1, hint: h ? `Possible cause: ${h.cause} Read: ${h.docs.join(', ')}` : null });
  }
  return out;
}

const logFile = dir => join(dir, '.threedog/errors.log'), cursorFile = dir => join(dir, '.threedog/errors.cursor');
const readLog = dir => existsSync(logFile(dir)) ? readFileSync(logFile(dir), 'utf8') : '';
/** Identifies one dev-server run: the log's first line holds the time it was cleared */
const epochOf = text => text.split('\n', 1)[0];

export const allErrors = dir => parseErrors(readLog(dir));
/** Records that count as errors (warnings are listed but do not fail a check) */
export const isError = r => r.kind !== 'warning';

/** Snapshot before a run: id -> count. A repeat of an old error only raises its count (no new record), so ids alone would miss it */
export const errorMark = dir => new Map(allErrors(dir).map(r => [r.id, r.count]));
/** Errors that appeared (or repeated) since errorMark */
export const errorsSince = (dir, mark) => allErrors(dir).filter(r => isError(r) && (!mark.has(r.id) || r.count > mark.get(r.id)));

/** Records after the saved read position; saves the new position */
export function newErrors(dir) {
  const text = readLog(dir), list = parseErrors(text), epoch = epochOf(text);
  let from = 0;
  try { const c = JSON.parse(readFileSync(cursorFile(dir), 'utf8')); if (c.epoch === epoch && c.id <= list.length) from = c.id; } catch { /* no position yet */ }
  if (existsSync(logFile(dir))) writeFileSync(cursorFile(dir), JSON.stringify({ id: list.length, epoch }));
  return list.filter(r => r.id > from);
}

const one = r => (`E${r.id} ${r.time}${r.tick === null ? '' : ' tick ' + r.tick}${r.count > 1 ? ` ×${r.count}` : ''} `
  + `${r.kind === 'warning' ? 'warning' : 'error'}${r.code ? ` [${r.code}]` : ''} ${r.page} ${oneLine(r.message)}${r.source ? ' (' + r.source + ')' : ''}`)
  + (r.hint ? `\n  -> ${r.hint}` : '');

/** The errors command: { ok, text, data } for the dispatcher */
export function errorsCommand(dir, rest, opt) {
  const latest = rest[0] === 'latest', all = allErrors(dir);
  let list, label;
  if (opt.since !== undefined) {
    const n = Number(String(opt.since).replace(/^E/i, ''));
    if (!Number.isInteger(n) || n < 0) throw new Error(`--since takes an error id such as 5 or E5 (the cursor printed by threedog errors), got "${opt.since}"`);
    list = all.filter(r => r.id > n); label = `since E${n}`;
  } else if (latest) {
    const n = rest[1] === undefined ? 3 : Number(rest[1]);
    if (!(n >= 1)) throw new Error('errors latest takes a count, e.g. threedog errors latest 5');
    list = all.slice(-n); label = `latest ${list.length} of ${all.length}`;
  } else { list = newErrors(dir); label = 'new'; }
  const cursor = all.length, data = { errors: list.slice(-10).map(({ message, ...r }) => ({ ...r, message: oneLine(message) })), cursor, total: all.length };
  if (!list.length) return { ok: true, data, text: opt.since !== undefined || latest ? `✓ No errors ${opt.since !== undefined ? label : 'recorded'}` : '✓ No new errors' };
  const more = list.length > 2 && !latest ? `\n…${list.length - 2} more, see .threedog/errors.log or threedog errors --since ${Math.max(0, list[0].id - 1)}` : '';
  const shown = latest ? list : list.slice(0, 2);
  // count errors and warnings apart: a run that only produced warnings is not a failure and does not say "errors"
  const nErr = list.filter(r => r.kind !== 'warning').length, nWarn = list.length - nErr;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const counts = [nErr && plural(nErr, 'error'), nWarn && plural(nWarn, 'warning')].filter(Boolean).join(', ');
  return { ok: nErr === 0, data, text: `${nErr ? '✗' : '!'} ${latest ? `${label}: ${counts}` : `${label}: ${counts}`}\n`
    + shown.map(one).join('\n') + more + `\nCursor E${cursor}: threedog errors --since ${cursor} lists only what comes after` };
}

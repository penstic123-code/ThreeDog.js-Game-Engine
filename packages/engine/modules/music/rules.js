// Music rule evaluation (helper of Music.js): which rule wins, and when to switch (debounced by `hold`, immediate on request). `m` is the Music instance.
import { reportError } from '../../core/errors.js';

export function pickTrack(m) {
  if (!m._rules) return undefined;
  let best = null;
  for (const r of m._rules) {
    let ok = false;
    try { ok = m.engine.audio.matches(r.when, m); } catch (err) { reportError(m.engine, err, 'music rule when', { soft: true }); }
    if (ok && (!best || (r.priority ?? 0) > (best.priority ?? 0))) best = r;
  }
  return best ? best.track ?? null : undefined;
}

export function evaluateRules(m, immediate = false) {
  if (m._override !== undefined) return;
  const want = pickTrack(m);
  if (want === undefined) return;                       // no rule matches: keep the current state
  const cur = m.current ?? null;
  if (want === cur) { m._candidate = undefined; m._candidateT = 0; return; }
  const hold = m._ruleOpts.hold ?? m.opts.hold;
  if (want !== m._candidate) { m._candidate = want; m._candidateT = 0; }
  if (immediate || m._candidateT >= hold) {
    m._candidate = undefined; m._candidateT = 0;
    const fade = m._ruleOpts.fade ?? m.opts.fade;
    want == null ? m.stop({ fade }) : m.play(want, { fade });
  }
}

// Test evidence for `threedog verify` / `threedog scenario`: "what did the tests prove, and what is still untested?" in two parts, both data-driven from the run itself.
//   1. Per check: the layer it reached (direct = op / describe call, simulated-input = bridge key press) and what was asserted, plus the fixed list of what
//      no scenario can prove (real pointer lock / mouse, real GPU frames, the picture, real FPS), so a green run is not read as "the game works".
//   2. Capability coverage, from engine.catalog() (else engine.ops.defs + engine.modules):
//      ops      defined vs run. A refused op (can said no) counts as exercised: the refusal is the behaviour the scenario checked.
//      modules  tested = one of its ops ran; indirect = no op ran but the run compared its describe section, changed one of its save parts, or fired
//               its events; untested = none of these. Many modules own no ops (world, sky, weather), so "no op ran" alone would call them untested forever.
// The baseline is taken after the scenario state is applied (pageMark, via runScenario's onPrepared), so loading the start state does not count as a change.


/** Page side, once the scenario state is applied and before step 1: the op-history seq, the tick, and every save part as JSON */
export function pageMark() {
  const e = window.engine, h = e.ops.recent(), parts = {};
  try { for (const [k, v] of Object.entries(e.saves.collect().parts)) parts[k] = JSON.stringify(v); } catch { /* a failing save() is reported elsewhere */ }
  // count too: a refusal identical to the previous one (same op, reason, actor) is merged into that entry (count++), with no new seq, so seq alone would miss it
  window.__verifyMark = { seq: h.length ? h.at(-1).seq : 0, count: h.length ? h.at(-1).count : 0, tick: e.time.tick, parts };
}

/** Page side: what exists (the catalog) and what the run did (op history after the mark, changed save parts, events fired) */
export function pageCoverage() {
  const e = window.engine, cat = e.catalog(), m = window.__verifyMark ?? { seq: 0, tick: 0, parts: {} };
  // engine.catalog() is a list of { id, ops: [names], saves: [keys] }, with 'core' and 'game' entries besides the modules
  const mods = cat.filter(c => c.id !== 'core' && c.id !== 'game').map(c => ({ id: c.id, ops: c.ops ?? [], saves: c.saves ?? [] }));
  // the catalog can miss ops defined late (by a test or a console call), so the live definitions are added
  const ops = [...new Set([...cat.flatMap(c => c.ops ?? []), ...e.ops.defs.keys()])];
  // every history entry after the mark, whatever its source: refused ops are logged too, and nested ops and key presses (source bridge / player) are exercised as well
  const ran = e.ops.recent().filter(h => h.seq > m.seq || (h.seq === m.seq && h.count > m.count)).map(h => ({ name: h.name, ok: h.ok, code: h.code, count: h.count, depth: h.depth, source: h.source }));
  const changedParts = [];
  try { for (const [k, v] of Object.entries(e.saves.collect().parts)) if (JSON.stringify(v) !== m.parts[k]) changedParts.push(k); } catch { /* see pageMark */ }
  const events = [...new Set(e.events.recent().filter(x => x.tick >= m.tick).map(x => x.name))];
  return { ops, modules: mods, ran, changedParts, events };
}

/** Always true of a scenario run: the bridge sends synthetic events into a headless page */
export const NOT_PROVEN = [
  'real input: pointer lock and mouse look were not exercised (key presses are synthetic bridge events; physical keyboard / mouse / gamepad never)',
  'real GPU: nothing was rendered in a real browser (no frames compared); visuals are not compared (use threedog snap)',
  'performance: no real FPS or frame time measured (steps are simulated time, not wall-clock)',
];

/** The per-check evidence rows [{ step, layer, ok, asserted }] from the check results and the layers runScenario reports */
export function checkEvidence(res, layers) {
  const layerOf = new Map(layers.map(l => [l.step, l.layer]));
  return res.map(r => {
    const step = Number(/^(\d+)\./.exec(r.label)?.[1] ?? 0);
    return { step, layer: layerOf.get(step) ?? 'direct', ok: r.ok, asserted: r.label.replace(/^\d+\.\s*/, '') };
  });
}

/**
 * Ops / modules that exist vs were exercised.
 * @param {ReturnType<typeof pageCoverage>} cov page data
 * @param {string[]} [sections] describe sections the scenario compared (root names, from verify's step list)
 */
export function coverage(cov, sections = []) {
  const ranNames = new Set(cov.ran.map(h => h.name)), refused = new Set(cov.ran.filter(h => !h.ok).map(h => h.name));
  const okNames = new Set(cov.ran.filter(h => h.ok).map(h => h.name)), prefix = n => String(n).split('.')[0], prefixes = new Set([...ranNames].map(prefix));
  const evPrefix = new Set(cov.events.map(n => String(n).split(/[:.]/)[0]));
  const tested = [], indirect = [], untested = [];
  for (const m of cov.modules) {
    const why = [m.ops.some(o => ranNames.has(o)) || prefixes.has(m.id) ? 'op' : null].filter(Boolean);
    if (why.length) { tested.push(m.id); continue; }
    const via = [sections.includes(m.id) && 'describe compared', (cov.changedParts.includes(m.id) || m.saves.some(k => cov.changedParts.includes(k))) && 'state changed',
      evPrefix.has(m.id) && 'events fired'].filter(Boolean);
    if (via.length) indirect.push({ id: m.id, via }); else untested.push(m.id);
  }
  const untestedOps = cov.ops.filter(o => !ranNames.has(o));
  return { ops: { total: cov.ops.length, ran: cov.ops.length - untestedOps.length, refused: [...refused].filter(o => !okNames.has(o)), untested: untestedOps },
    modules: { total: cov.modules.length, tested, indirect, untested, exercised: tested.length + indirect.length },
    changedParts: cov.changedParts, events: cov.events };
}

const list = (xs, n = 8) => xs.slice(0, n).join(', ') + (xs.length > n ? ` … (+${xs.length - n} more)` : '');

/** Short text block appended to the verify / scenario report; the full lists are in --json (data.evidence.coverage) */
export function evidenceText(rows, cov, { checks = true } = {}) {
  const lines = [];
  if (checks) {
    const byLayer = {};
    for (const r of rows) (byLayer[r.layer] ??= []).push(r);
    lines.push('Evidence (per check, by layer reached):', ...Object.entries(byLayer).map(([l, rs]) => {
      const bad = rs.filter(r => !r.ok);
      return `  ${l}: ${rs.length} check${rs.length > 1 ? 's' : ''} (${bad.length ? 'FAILED at step ' + bad.map(r => r.step).join(',') + '; ' : ''}${list(rs.map(r => r.asserted), 3)})`;
    }));
    lines.push('NOT proven: ' + NOT_PROVEN.join(' · '));
  }
  const { ops, modules: m } = cov;
  lines.push(`Coverage: ops ${ops.ran}/${ops.total} ran${ops.refused.length ? ` (refused: ${list(ops.refused, 4)})` : ''} · modules ${m.tested.length} tested, ${m.indirect.length} indirect, ${m.untested.length} untested`);
  if (m.indirect.length) lines.push('  indirect: ' + list(m.indirect.map(x => `${x.id} (${x.via.join(', ')})`), 6));
  if (ops.untested.length) lines.push('  untested ops: ' + list(ops.untested, 10));
  if (m.untested.length) lines.push('  untested modules: ' + list(m.untested, 10));
  return lines.join('\n');
}

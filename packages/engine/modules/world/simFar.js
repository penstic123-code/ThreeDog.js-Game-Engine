// Far simulation in workers: world.simulate(kind, { far, worker: true }). Part of sim.js.
// Each step, the far records picked for this step (buckets and cap work exactly as without workers) are copied as one batch per kind,
// sent to engine.threads, and the results are written back FAR_LAG steps later through engine.commits:
//   arrived in time -> worker result; not yet -> the same function runs on the main thread on the same copies.
// So threads on, off, slow or crashed all give bit-identical records at every step (same V8, same recompiled source, same input).
// Write-back is a field diff against the copy: only fields far changed are written, so gameplay changing other fields during the flight is kept;
// a field both changed is won by far (it lands later). A record that turns near while in flight lands its result first (same value), then near runs.
// A record in flight is skipped by far scheduling until it lands; its time keeps accumulating and is simulated on its next turn, so no time is lost.

/** Steps between sending a batch and writing it back (4 = 67 ms): enough for a worker round trip, short enough that far records barely lag */
const FAR_LAG = 4;

/** Deep equality of plain data (records hold only plain values) */
function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!same(a[k], b[k])) return false;
  return true;
}

/** @internal */
export class FarFlights {
  /** @param {import('./sim.js').Sim} sim */
  constructor(sim) {
    this.sim = sim;
    this.open = new Map();   // simulate registration -> [[ent, dt], ...] picked this step
    this.defs = 0;
  }
  /** simulate(kind, { worker: true }): recompile far so it runs the same in a worker and here; the original closure is never called */
  register(kind, s) {
    const T = this.sim.w.engine.threads, label = `world.simulate('${kind}') far`;
    s.pure = T.pure(s.far, label);
    s.far = s.pure.call;
    s.key = kind + '#' + ++this.defs;
    if (T.size) T.pureLane().broadcast({ def: s.key, src: s.pure.src, label }, 'def:' + s.key);
  }
  /** dt: real seconds this turn covers (bookkeeping); d: the dt far gets (sim.settle) */
  add(e, s, dt, d = dt) {
    let b = this.open.get(s); if (!b) this.open.set(s, b = []);
    b.push([e, dt, d]);
  }
  /** End of the far pass: send each kind's batch */
  flush() {
    for (const [s, items] of this.open) this.send(s, items);
    this.open.clear();
  }
  send(s, items) {
    const engine = this.sim.w.engine, T = engine.threads;
    // copies taken now: what far sees is the record as of this step, whatever happens to it during the flight
    const f = { s, items, snaps: items.map(([e, , d]) => [structuredClone(e.rec), d]), results: null };
    for (const [e, dt, d] of items) e.flight = { f, from: e.last - dt, d };
    const t = engine.commits.request({ lag: FAR_LAG, apply: r => this.apply(f, r), fallback: () => f.snaps.map((_, i) => this.compute(f, i)) });
    // a failed worker run is ignored: the fallback runs the same code here at the due step and throws the same (clear) error
    if (T.size) T.pureLane().run({ call: s.key, items: f.snaps }).then(r => { f.results = r.map(x => x.args[0]); t.resolve(f.results); }, () => {});
  }
  /** Run one worker kind's far here and now (engine.skip), written back the same way as a landed result */
  now(e, s, dt) {
    const f = { s, snaps: [[structuredClone(e.rec), dt]] };
    this.write(e, f, this.compute(f, 0), 0);
  }
  compute(f, i) { const [rec, dt] = f.snaps[i], c = structuredClone(rec); f.s.pure.call(c, dt); return c; }
  apply(f, results) {
    f.items.forEach(([e], i) => { if (e.flight?.f === f) this.write(e, f, results[i], i); });
  }
  /** Near needs this record now: land its result early (worker result if it arrived, else computed here; the value is the same) */
  land(e) {
    const f = e.flight.f, i = f.items.findIndex(x => x[0] === e);
    this.write(e, f, f.results ? f.results[i] : this.compute(f, i), i);
  }
  write(e, f, res, i) {
    e.flight = null;
    if (e.dead) return;
    const rec = e.rec, snap = f.snaps[i][0];
    for (const k in res) {
      if (k === 'id' || k === 'kind' || same(res[k], snap[k])) continue;
      if (k === 'position') this.sim.w.move(rec.id, res.position); else rec[k] = res[k];
    }
    for (const k in snap) if (!(k in res)) delete rec[k];
  }
}

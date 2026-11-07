// ctx.borrow (core/engine/modules.js): what a module writes on an object it does not own goes back when it goes, unless a later write took over.
// 不许绕开: this drives the real _modCtx and the real handle table, so a borrow that skips tracking fails here, not in a game after a style switch.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';

export const name = 'ctx.borrow: tracked, restores the old value, leaves a later write alone, and refuses a bad call';

/** The few engine fields _modCtx reads; everything it does is the real code */
const host = moduleMethods => Object.assign(Object.create(moduleMethods), { _modInst: new Map([['part', { ac: new AbortController() }]]), _modTracked: new Map(), _borrowed: new WeakMap(), disposed: false });

export async function run({ check }) {
  const { moduleMethods } = await import(pathToFileURL(join(ENGINE, 'core', 'engine', 'modules.js')).href);
  const e = host(moduleMethods), ctx = e._modCtx({ name: 'part' });
  const drop = () => { for (const h of [...e._modTracked.get('part') ?? []]) h.remove(); };

  const a = { fog: null, tone: 1 };
  ctx.borrow(a, { fog: 'mine', tone: 2 });
  check('the values are written at once', a.fog === 'mine' && a.tone === 2);
  drop();
  check('the module going restores them', a.fog === null && a.tone === 1);

  ctx.borrow(a, { fog: 'mine', tone: 2 });
  a.fog = 'the game';
  drop();
  check('a later write stands, the untouched value still goes back', a.fog === 'the game' && a.tone === 1);

  const h = ctx.borrow(a, { tone: 3 });
  h.remove(); a.tone = 9; h.remove();
  check('remove() ends it early, a second remove() does nothing, and the handle leaves the table', a.tone === 9 && !e._modTracked.get('part').has(h));

  const clamped = { get v() { return this._v; }, set v(x) { this._v = Math.min(x, 5); }, _v: 1 };
  ctx.borrow(clamped, { v: 8 });
  drop();
  check('a setter that keeps something else still counts as this borrow', clamped.v === 1);

  let code = null;
  try { ctx.borrow(null, { a: 1 }); } catch (err) { code = err.code; }
  check('a bad call throws the coded error', code === 'module-handle', String(code));
}

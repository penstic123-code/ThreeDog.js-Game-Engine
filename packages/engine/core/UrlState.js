// engine.applyState: one-call scenarios.
// Reproduce a scenario in one call: engine.applyState({ time, season, weather, pos, save, wait, cutscene, view, play, state }), engine.defineState(name, params).
// In dev (or with createEngine({ urlState: true })) URL parameters are read automatically: /?time=18:30&weather=rain&pos=40,-20&cutscene=skip&wait=3&state=name
// ?play (any value) leaves the title screen the way its Start does (engine.session.newGame(), then the title part closes; flow's start state too): `shot --play`, tests
// ?at=<place> is ?play plus standing at a named place, with the game's own camera on the player: `shot --at <place>`. Every game wrote this by hand (15-20 lines), and
// a placement made before session:start is undone by it, so it happens here, after the run started. Names are a module's: its applyState hook answers { at } with
// a position, and core does the placing, so core names no module
//
// Who handles which key: core handles save (saves.load), pos and at (player.placeAt, or sets the focus without a player; then state:placed, so a rig that eases
// jumps instead of gliding across the map) and wait (advances with engine.step);
// the rest go to the module hook applyState(e, params) (written like the describe hook): calendar -> time and season (sky -> its fixed time without a calendar), weather -> weather, timeline -> cutscene.
// Two phases, both called from start():
//   early(): before modules are ready, applies save, pos, time, weather (terrain is generated directly at the new position)
//   late(): after engine:ready, play (start a run when the title is up), at, view (engine.views), cutscene ('skip' skips the opening cutscene), sets weather once more, advances wait seconds, aligns time again, then emits state:applied
// In a game, await engine.applyState({...}) at any time runs both phases back to back.
import { warnMissing } from './validate.js';
import { readParams, keysSchema } from './params.js';
import { xzOf } from './math.js';
import { unsettled } from './headlessLoad.js';
import { codedError } from './errorHints.js';

const KEYS = ['state', 'time', 'season', 'weather', 'pos', 'at', 'save', 'wait', 'cutscene', 'view', 'play'];

export class UrlState {
  constructor(engine, { fromUrl = false } = {}) {
    this.engine = engine;
    this.fromUrl = fromUrl;
    this.states = new Map();   // name -> params
    this.pending = null;       // URL parameters (used by start())
    this.applied = false;      // URL parameters are fully applied (npm run shot waits for it)
  }
  /** Returns a handle: like other registrations there is only remove() to undo; after a same-name redefinition the old handle's remove() will not delete the new one */
  define(name, params, { owner } = {}) {
    this.states.set(name, params);
    return { owner, remove: () => { if (this.states.get(name) === params) this.states.delete(name); } };
  }

  /** Expand the state name, check spelling, and turn strings from the URL into numbers */
  _expand(params) {
    let p = { ...params };
    if (p.state != null) {
      const s = this.states.get(p.state);
      if (!s) warnMissing('state', p.state, [...this.states.keys()]);
      p = { ...s, ...p };
      delete p.state;
    }
    readParams('applyState()', keysSchema(KEYS), p);
    if (typeof p.pos === 'string') { const [x, z] = p.pos.split(',').map(Number); p.pos = { x, z }; }
    if (p.wait != null) p.wait = +p.wait;
    if (p.at != null) p.play ??= true;   // a place is somewhere in the game, never on the start screen
    return p;
  }
  _hooks(p, keys) {
    const part = {}; for (const k of keys) if (p[k] != null) part[k] = p[k];
    if (!Object.keys(part).length) return [];
    return [...this.engine.modules.values()].filter(m => m.applyState).map(m => m.applyState(this.engine, part));
  }
  /** Wait for modules to be ready (terrain chunks must generate after a teleport); in headless mode advance frames ourselves */
  async _settle() {
    const e = this.engine;
    for (let i = 0; i < 600; i++) {
      if (!unsettled(e).length) return;
      // a loading frame, not a step: how many polls this loop takes depends on how fast background threads answer, so a step here made the game
      // time at the end of the setup depend on machine speed (same input, different result; review 0.4 B). Game time moves only in _late's wait
      if (e.headless) e._frameHooks(0, true);
      await new Promise(r => setTimeout(r, 16));   // main-loop: yield to the browser (background threads, Promise continuations) without advancing game time
    }
  }
  // shortcut: stands on the top surface at x, z (placeAt), so a place with a y under a roof lands on the roof; upgrade when placeAt takes a floor
  _place(pos) {
    const e = this.engine, [x, z] = xzOf(pos);
    if (e.player) e.player.placeAt({ x, z }); else e.focus.set(x, e.surface(x, z), z);
    e.events.emit('state:placed', { x, z });
  }
  async _early(p) {
    const e = this.engine;
    if (p.save != null) await e.saves.load(String(p.save));
    if (p.pos) this._place(p.pos);
    await Promise.all(this._hooks(p, ['time', 'season', 'weather']));
  }
  async _late(p) {
    const e = this.engine;
    // play: what the title's Start does (ui/defaults.js), so the game's session:start setup runs; a module with a title of its own (flow's
    // start state) leaves it in its applyState hook. Before wait, so the advanced seconds are played seconds
    if (p.play != null) {
      if (e.ui.isOpen('title')) { await e.session.newGame(); e.ui.close('title'); }
      await Promise.all(this._hooks(p, ['play']));
    }
    if (p.at != null) {
      const where = (await Promise.all(this._hooks(p, ['at']))).find(Boolean);
      if (!where) throw codedError('state-at', `applyState({ at: '${p.at}' }): no installed module knows place names`);
      this._place(where);
      await this._settle();   // the ground and models around the place, before wait and the picture
    }
    await Promise.all(this._hooks(p, ['cutscene', 'weather']));   // set weather once more: the opening auto-weather or settings in engine:ready may have changed it
    if (p.wait > 0) for (let s = p.wait; s > 1e-6; s -= 0.5) {   // advance in small slices so Promises (the next cutscene segment) and background threads continue between them
      e.step(Math.min(0.5, s), { render: false, describe: false });
      await new Promise(r => setTimeout(r, 0));   // main-loop: yield to the browser (background threads, Promise continuations) without advancing game time
    }
    await Promise.all(this._hooks(p, ['time', 'season']));         // advancing moves time and the day, so align them last
    if (p.view && e.views.list().length) e.views.show(p.view);   // a page with its own ?view= (no engine.views declared) handles it itself
    this.applied = true;
    e.events.emit('state:applied', p);
  }

  /** Apply a set of parameters (usable any time in a game; both phases run back to back) */
  apply(params) {
    const p = this._expand(params);
    this.applied = false;
    // setting up a scenario is not a gameplay action: the ops guard lets its writes through until it finishes
    return this.engine.ops.allow(async () => { await this._early(p); await this._settle(); await this._late(p); });
  }
  /** In start(), before modules are ready: read the URL parameters and apply save/pos/time/weather */
  early() {
    if (!this.fromUrl) return;
    const q = new URLSearchParams(location.search), raw = {};
    for (const k of KEYS) if (q.has(k)) raw[k] = q.get(k);
    if (!Object.keys(raw).length) return;
    this.pending = this._expand(raw);
    return this._early(this.pending);
  }
  /** In start(), after engine:ready: cutscene, wait, align time again, then emit state:applied */
  late() {
    if (!this.pending) { this.applied = true; return; }
    const p = this.pending;
    return this.engine.ops.allow(async () => { await this._settle(); await this._late(p); });
  }
}

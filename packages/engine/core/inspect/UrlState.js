// engine.applyState: one-call scenarios.
// Reproduce a scenario in one call: engine.applyState({ time, season, weather, pos, at, save, wait, cutscene, view, play, fresh, state }), engine.defineState(name, params).
// In dev (or with createEngine({ urlState: true })) URL parameters are read automatically: /?time=18:30&weather=rain&pos=40,-20&cutscene=skip&wait=3&state=name
// ?play (any value) leaves the title screen the way its Start does (engine.session.newGame(), then the title part closes; flow's start state too): `shot --play`, tests
// ?fresh (bare, or ?fresh=1; false and 0 do nothing) deletes every save of this page first, so the title offers no Continue and a key press on it starts a new run; on a running page it also ends
// the run and goes back to the title (session.quit). For repeatable script runs: Enter on a title picks Continue when a save exists, so a rerun played the last
// autosave. ?fresh&play is a clean start in play, with or without a title screen. Read from the URL in dev mode only: outside it early() drops fresh with one warning,
// even with createEngine({ urlState: true }), because a link must never delete a player's saves in a shipped game. The game's own engine.applyState({ fresh: true }) still acts
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
// In a game, await engine.applyState({...}) at any time runs both phases back to back; it resolves to { ok, refused: [{ key, value, reason }] }, because a request
// that did nothing (a weather name the game lacks, a key no module handles) must not read as done. A hook refuses with { refused: { key: reason } }; it names the
// keys it handles in its module's stateKeys (a hook without stateKeys counts for every key, so a game's own hook is never refused for it).
import { warnMissing, warnOnce, DEV } from '../base/validate.js';
import { readParams, keysSchema } from '../base/params.js';
import { xzOf, yOf } from '../base/math.js';
import { unsettled } from '../engine/headlessLoad.js';
import { codedError } from '../base/errorHints.js';

// fresh deletes saves, so it acts only on a clear yes (a bare ?fresh reads as ''); anything that is neither a yes nor a no is refused in _expand, never ignored
const FRESH_ON = [true, 1, '1', ''], FRESH_OFF = [false, 0, '0', 'false'];
const freshOn = v => FRESH_ON.includes(v);
// met without a module: play has its own core path, and skipping a cutscene in a game without any has nothing left to do
const NOTHING_NEEDED = ['play', 'cutscene'];
const KEYS = ['state', 'time', 'season', 'weather', 'pos', 'at', 'save', 'wait', 'cutscene', 'view', 'play', 'fresh'];

export class UrlState {
  constructor(engine, { fromUrl = false, dev = DEV } = {}) {
    this.engine = engine;
    this.fromUrl = fromUrl;
    this.dev = dev;
    this._ended = false;       // fresh ended a running playthrough, so play must start one even when no title is up
    this.states = new Map();   // name -> params
    this.pending = null;       // URL parameters (used by start())
    this.applied = false;      // URL parameters are fully applied (npm run shot waits for it)
    this._refused = new Map(); // key -> { key, value, reason } of the apply in progress
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
    if (p.fresh != null && !freshOn(p.fresh) && !FRESH_OFF.includes(p.fresh)) throw codedError('state-value', `applyState({ fresh: ${JSON.stringify(p.fresh)} }): fresh takes true or 1 (delete the saves), false or 0 (keep them)`);
    if (typeof p.pos === 'string') { const [x, z] = p.pos.split(',').map(Number); p.pos = { x, z }; }
    if (p.wait != null) p.wait = +p.wait;
    if (Number.isNaN(p.wait)) throw codedError('state-value', `applyState({ wait: ${JSON.stringify(params.wait)} }): wait takes seconds`);
    if (p.at != null) p.play ??= true;   // a place is somewhere in the game, never on the start screen
    return p;
  }
  _hooks(p, keys) {
    const part = {}; for (const k of keys) if (p[k] != null) part[k] = p[k];
    if (!Object.keys(part).length) return [];
    return [...this.engine.modules.values()].filter(m => m.applyState).map(m => m.applyState(this.engine, part));
  }
  _refuse(p, key, reason) { this._refused.set(key, { key, value: p[key], reason }); }
  /** Run the hooks for these keys and keep what they refused; a key no installed module handles is refused here, since nothing else would ever say so */
  async _ask(p, keys) {
    const mods = [...this.engine.modules.values()].filter(m => m.applyState);
    for (const k of keys) this._refused.delete(k);   // asked again (weather and time are, late in the setup): the last answer is the one that stands
    for (const k of keys) if (p[k] != null && !NOTHING_NEEDED.includes(k) && !mods.some(m => !m.stateKeys || m.stateKeys.includes(k))) this._refuse(p, k, `no installed module handles ${k}`);
    const out = await Promise.all(this._hooks(p, keys));
    for (const r of out) for (const [k, reason] of Object.entries(r?.refused ?? {})) this._refuse(p, k, reason);
    return out;
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
  _place(pos) {
    const e = this.engine, [x, z] = xzOf(pos);
    if (e.player) e.player.placeAt(pos); else e.focus.set(x, e.surface(x, z, yOf(pos)), z);
    e.events.emit('state:placed', { x, z });
  }
  async _fresh() {
    const e = this.engine;
    await Promise.all(e.saves.list().map(s => e.saves.remove(s.slot)));
    if (!e.ready) return;   // during start(): the title has not been drawn yet, and nothing runs to end
    if (e.ui.isOpen('title')) e.ui.close('title');   // closed first so quit draws it again, without Continue
    await e.session.quit();
    this._ended = true;
  }
  async _early(p) {
    const e = this.engine;
    if (freshOn(p.fresh)) await this._fresh();
    if (p.save != null) await e.saves.load(String(p.save));
    if (p.pos) this._place(p.pos);
    await this._ask(p, ['time', 'season', 'weather']);
  }
  async _late(p) {
    const e = this.engine;
    // play: what the title's Start does (ui/defaults.js), so the game's session:start setup runs; a module with a title of its own (flow's
    // start state) leaves it in its applyState hook. Before wait, so the advanced seconds are played seconds
    const ended = this._ended; this._ended = false;
    if (p.play != null) {
      // ended: without a title part quit leaves nothing open to press Start on, and a run that ended must still start again (session:start)
      const started = ended || e.ui.isOpen('title');
      if (started) { await e.session.newGame(); e.ui.close('title'); }
      await this._ask(p, ['play']);
      // a new run puts the player at the start, which undid the pos of _early while `state` still printed Set
      if (started && p.pos && p.at == null) { this._place(p.pos); await this._settle(); }
    }
    if (p.at != null) {
      const where = (await this._ask(p, ['at'])).find(r => r && !r.refused);
      // save, position, time and weather are already applied, so this is a refusal like its siblings, never a throw that leaves the rest undone
      if (where) { this._place(where); await this._settle(); }   // the ground and models around the place, before wait and the picture
      else if (!this._refused.has('at')) this._refuse(p, 'at', 'no installed module knows place names: install content(), or use pos=x,z');
    }
    await this._ask(p, ['cutscene', 'weather']);   // set weather once more: the opening auto-weather or settings in engine:ready may have changed it
    if (p.wait > 0) for (let s = p.wait; s > 1e-6; s -= 0.5) {   // advance in small slices so Promises (the next cutscene segment) and background threads continue between them
      e.step(Math.min(0.5, s), { render: false, describe: false });
      await new Promise(r => setTimeout(r, 0));   // main-loop: yield to the browser (background threads, Promise continuations) without advancing game time
    }
    await this._ask(p, ['time', 'season']);         // advancing moves time and the day, so align them last
    if (p.view && e.views.list().length && e.views.show(p.view)) {   // a page with its own ?view= (no engine.views declared) handles it itself
      if (e.headless) e._frameHooks(0, true);   // one loading frame: the modules see the new focus, so _settle has something to wait for
      await this._settle();                     // a picture of the view must not be taken before the world around it has loaded
    }
    this.applied = true;
    e.events.emit('state:applied', p);
  }

  /** What the last applyState or the URL could not do: applyState hands this back, but a URL has no caller, so a tool that built one reads it here @returns {{ key: string, value: any, reason: string }[]} */
  get refused() { return [...this._refused.values()]; }

  /** Apply a set of parameters (usable any time in a game; both phases run back to back). Resolves to { ok, refused } */
  apply(params) {
    const p = this._expand(params);
    this.applied = false;
    this._refused.clear();
    // setting up a scenario is not a gameplay action: the ops guard lets its writes through until it finishes
    return this.engine.ops.allow(async () => {
      await this._early(p); await this._settle(); await this._late(p);
      const { refused } = this;
      return { ok: !refused.length, refused };
    }).finally(() => { this.applied = true; });   // a scenario that threw is over too: stateApplied must not wait for it
  }
  /** In start(), before modules are ready: read the URL parameters and apply save/pos/time/weather */
  early() {
    if (!this.fromUrl) return;
    const q = new URLSearchParams(location.search), raw = {};
    for (const k of KEYS) if (q.has(k)) raw[k] = q.get(k);
    if (!Object.keys(raw).length) return;
    this.pending = this._expand(raw);
    if (!this.dev && this.pending.fresh != null) {   // after _expand: a named ?state= can carry fresh too
      delete this.pending.fresh;
      warnOnce('?fresh is ignored outside dev mode: a link must not delete saves in a shipped game. Game code can call engine.applyState({ fresh: true }).');
    }
    return this._early(this.pending);
  }
  /** In start(), after engine:ready: cutscene, wait, align time again, then emit state:applied */
  late() {
    if (!this.pending) { this.applied = true; return; }
    const p = this.pending;
    return this.engine.ops.allow(async () => { await this._settle(); await this._late(p); });
  }
}

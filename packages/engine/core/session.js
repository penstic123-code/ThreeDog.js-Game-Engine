// engine.session: one playthrough, from "new game" or "load" until the next one. Starting a playthrough leaves nothing of the previous one behind.
//   engine.session.newGame()             // the state right after start() (world, containers, vars, quests, clock, sky, weather, random...), as if the page had just opened
//   await engine.session.load('slot1')    // continue, or retry from a checkpoint: the new-game state with the save on top (a part the save lacks gets its new-game state)
//   engine.session.quit()                // back to the title screen with a clean slate (the title's Start calls newGame)
//   engine.session.track(handle)          // a listener / timer / hook the game adds during play: removed when the playthrough ends
// Versus engine.saves.load(slot): that applies a save onto the running playthrough (quick load) and keeps what the game added during play.
// Deleting a save is engine.saves.remove(slot); none of these touch stored saves.
//
// What ending a playthrough clears: handles passed to track(), clock function timers added after start() (boot-time ones come back with their original delay),
// a running engine.skip (cancelled), background results not yet applied (commits: worker / job results requested in the old playthrough never land), and every
// save part (the state captured when start() finished is applied). Modules end their own part on 'session:end' (a cutscene is skipped, the music stops),
// and the camera starts over on 'session:start'. Listeners and hooks the game registered at boot stay: they belong to the game, not the playthrough.
// Events: 'session:end' (before the reset; flow returns to its start state), 'session:start' { kind: 'new' | 'load', slot? } (after; flow goes to 'playing').
import { codedError } from './errorHints.js';

const DEV = {
  early: 'engine.session.{fn}() was called before engine.start() finished: the new-game state is captured when loading completes. Call it from a button or after `await engine.start()`.',
  badHandle: 'engine.session.track(handle): handle must have remove(), like the result of engine.events.on / onFixed / clock.after. Got {got}.',
};

/**
 * The fixed-step hook behind saves.autosave: saves 'auto' every `every` fixed seconds of play; outside play (session.playing false, or a gameplay error) it counts from zero again.
 * @param {any} saves
 * @param {number} every  fixed seconds
 * @param {() => void} onRemove
 * @returns {{ remove(): void }}
 * @internal
 */
export function autosaveHook(saves, every, onRemove) {
  const e = saves.engine;
  let t = 0;
  const tick = e.onFixed(dt => {
    if (!e.session.playing || e.error) { t = 0; return; }   // nothing of a playthrough to keep: start counting again once one runs
    if ((t += dt) < every) return;
    t = 0; saves.save('auto');
  });
  return { remove: () => { tick.remove(); onRemove(); } };
}

/** engine.session: new game / continue / back to title, each from a clean slate. */
export class Session {
  /** @internal */
  constructor(engine) {
    /** @internal */ this.engine = engine;
    /** @internal JSON of the state when start() finished */ this._base = null;
    /** @internal clock function timers at that moment, with their remaining delay */ this._timers = [];
    /** @internal */ this._tracked = new Set();
    /** @internal true while newGame / load / quit replace the state */ this._busy = false;
  }

  /**
   * True while a playthrough runs: start() has finished, no newGame / load / quit is replacing the state, and the title screen is not up.
   * Autosave and other "only during play" work check it.
   * @type {boolean}
   */
  get playing() { return !!this._base && !this._busy && !this.engine.ui.isOpen('title'); }

  /** @internal Called by start() once the world is ready: what newGame returns to */
  _capture() {
    this._base = JSON.stringify(this.engine.saves.collect());
    this._timers = this.engine.clock.snapshotFnTimers();
  }

  /** @internal A save part registered after start() (engine.use later): its state now is its new-game state, so newGame resets it too */
  _late(key) {
    if (!this._base) return;
    const base = JSON.parse(this._base), p = this.engine.saves.providers.get(key);
    if (key in base.parts) return;
    try { base.parts[key] = p.save(); base.versions[key] = p.version; } catch { return; }   // its save() cannot run yet: newGame leaves this part as it is
    this._base = JSON.stringify(base);
  }

  /**
   * Keep a handle only for this playthrough: newGame / load / quit call handle.remove(). Returns the handle.
   * @template {{ remove(): void }} H
   * @param {H} handle
   * @returns {H}
   * @example
   * // a quest's helper listener lives only as long as this playthrough
   * engine.session.track(engine.events.on('npc:talk', ({ id }) => { if (id === 'baker') engine.vars.setFlag('metBaker'); }));
   */
  track(handle) {
    if (typeof handle?.remove !== 'function') throw codedError('session-handle', DEV.badHandle.replace('{got}', String(handle)));
    this._tracked.add(handle);
    return handle;
  }

  /**
   * Start a new playthrough from the state the game had right after start(). Returns Promise<boolean> (false only if a save part failed to load; the game is then rolled back).
   * @returns {Promise<boolean>}
   * @example
   * // a "Restart" button in a game-over screen
   * restartBtn.onclick = () => engine.session.newGame();
   */
  newGame() { return this._begin('newGame', () => this.engine.saves.apply(this._baseData(), '(new game)'), { kind: 'new' }); }

  /**
   * Continue from a save (or retry from a checkpoint) with nothing of the current playthrough left over: the new-game state with the save on top,
   * so a part the save does not have (a module added in a later version of the game) starts from its new-game state.
   * A save that cannot be read (missing, corrupt, from a newer build) is refused before anything changes: returns false, the current game and the save stay as they were.
   * @param {string} [slot]
   * @returns {Promise<boolean>}
   * @example
   * engine.events.on('player:dead', () => engine.session.load('checkpoint'));   // retry; the checkpoint was saved with engine.saves.save('checkpoint')
   */
  async load(slot = 'auto') {
    const S = this.engine.saves, bad = S.check(slot);
    if (bad) return bad === 'missing' ? false : S.load(slot);   // load shows the message and changes nothing
    return this._begin('load', () => S._load(slot, this._baseData()), { kind: 'load', slot });
  }

  /**
   * End the playthrough and show the title screen (the title part when the game turned it on; flow returns to its start state).
   * The state behind the title is the new-game state, so nothing from the old playthrough runs while the title is up.
   * @returns {Promise<boolean>}
   * @example settingsBackToTitle.onclick = () => engine.session.quit();
   */
  async quit() {
    const ok = await this._reset('quit', () => this.engine.saves.apply(this._baseData(), '(new game)'));
    this.engine.ui.open('title');
    return ok;
  }

  /** @internal the new-game state as save data */
  _baseData() {
    if (!this._base) throw codedError('session-early', DEV.early.replace('{fn}', 'newGame / load'));
    return JSON.parse(this._base);
  }

  /** @internal end the playthrough, apply, then announce the new one */
  async _begin(fn, apply, info) {
    const ok = await this._reset(fn, apply);
    this.engine.events.emit('session:start', info);
    return ok;
  }

  /** @internal */
  async _reset(fn, apply) {
    const e = this.engine;
    if (!this._base) throw codedError('session-early', DEV.early.replace('{fn}', fn));
    this._busy = true;
    try {
      e.events.emit('session:end');   // modules end their part: a running engine.skip is cancelled, a cutscene skipped, the music stopped
      for (const h of this._tracked) h.remove();
      this._tracked.clear();
      await new Promise(r => setTimeout(r, 0));   // main-loop: one macrotask, so what session:end listeners started (a skipped cutscene's last steps) settles first
      e.commits.invalidate();   // apply invalidates too, but a refused apply must not let old results land either
      const ok = await apply();
      e.clock.restoreFnTimers(this._timers);   // event timers came back with the save; function timers are exactly the boot-time ones, each with its original delay
      return ok;
    } finally { this._busy = false; }
  }

  /** @internal for describe */
  describe() { return { tracked: this._tracked.size, playing: this.playing }; }
}

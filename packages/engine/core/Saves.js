// Saves: each module registers "how to save and load", and saving collects them all. Supports multiple slots, autosave, and export / import (text, file).
//
// engine.saves.register('garden', { version: 2, migrate: { 1: d => ({ ...d, beds: [] }) }, save, load });   // shape changed: raise version, add the step
// if (await engine.saves.save('slot1')) toast(engine, 'Saved');   await engine.saves.load('slot1');   // both return Promise<boolean>
// Text export / import and .json files (with attachments): saveFiles.js. Applying a save (checks, rollback): saveApply.js. Format: recipe 20 "Save format".
// Failure paths never lose data: a part whose save() throws, or a failed write, keeps the previous save (false + toast); a corrupt / newer / unmigratable
// save is refused before anything changes; a part whose load() throws rolls the game back to before the load.
// Storage: IndexedDB (SaveStore.js; localStorage fallback with a one-time warning). Every save is read into memory before start(), so list / check /
// export are synchronous; save / remove change memory first, then queue the disk write.
/** @import { SaveProvider } from '../types/core' */
import { SaveStore } from './SaveStore.js';
import { toast } from '../ui/UI.js';
import { warnOnce, checkOptions, fmt } from './validate.js';
import { reportError } from './errors.js';
import { codedError, coded } from './errorHints.js';
import { FORMAT, checkPartVersion, readSave } from './saveVersions.js';
import { exportSaveFile, importSaveFile, importText, SAVE_STRINGS } from './saveFiles.js';
import { applySave, loadSlot, adoptPart, afterLoad } from './saveApply.js';
import { autosaveHook } from './session.js';


// Developer messages (console text for developers, never shown in the game UI)
const DEV_STRINGS = {
  saveThrew: "save() of save part '{k}' threw ({msg}); slot '{slot}' was not written and keeps its previous save",
  noIdb: '[saves] IndexedDB is unavailable (possibly private mode); saves fall back to localStorage (about 5MB cap) and attachments (such as photos) will not be saved.',
  autosave: 'saves.autosave(minutes): minutes must be a positive number of minutes of play, got {got}',
};

/** engine.saves handles saving. Each module registers "how to save and load"; supports multiple slots, autosave and export / import. */
export class Saves {
  /** @internal */
  constructor(engine, { prefix = 'game-' } = {}) {
    /** @internal */ this.engine = engine;
    /** Save name prefix (start of the key names in the localStorage fallback, and of the IndexedDB database name) */
    this.prefix = prefix + 'save-';
    /** @internal */ this.providers = new Map();
    /** @internal */ this._auto = null;
    /** @internal Slot -> JSON text (all saves stay in memory: list / check / export are synchronous) */ this._json = new Map();
    /** @internal Slot -> savedAt */ this._meta = new Map();
    /** @internal Disk-write queue: earlier saves are written first */ this._queue = Promise.resolve();
    /** @internal Parts of the last loaded save that no registered module owns (a module not installed in this build): written back unchanged on every save */
    this._foreign = { parts: {}, versions: {} };
    engine.i18n.add(SAVE_STRINGS);
    /**
     * Storage layer: saves in the IndexedDB slots store, attachments (by group, e.g. 'photo') in the blobs store; mode 'localStorage' without IndexedDB.
     * @type {{ mode: 'idb' | 'localStorage', blobs(group?: string): Promise<{ group: string, id: string, at: number, blob: Blob, meta: any }[]>,
     *   putBlob(group: string, id: string, blob: Blob, meta?: any, at?: number): Promise<void>, deleteBlob(group: string, id: string): Promise<void> }}
     */
    this.store = /** @type {any} */ (new SaveStore(this.prefix + 'db', this.prefix));
    /** Has the save index been read into memory? (start() waits for it; game code rarely needs to care) */
    this.ready = false;
    /** Resolves once the save index is in memory; await it only to list / load before start() @type {Promise<void>} */
    this.whenReady = this._init().then(() => { this.ready = true; });
  }
  /**
   * Register "how to save and load"; key is this part's name in the save. Parts with first: true load first (the level); a load returning a Promise makes later
   * parts wait.
   * version (default 1): raise it by 1 whenever what save() returns changes shape, and add migrate[oldVersion] = data => newData; load sees only the current
   * shape.
   * A save whose part is newer than this build's version is refused as a whole (load returns false, the save is kept).
   * A part registered after a save was loaded (a module installed later) is handed its data from that save at once.
   * @param {string} key
   * @param {SaveProvider} provider
   * @example
   * engine.saves.register('garden', { save: () => garden.toJSON(), load: d => garden.fromJSON(d) });
   * // later the format gains beds: version 2, and a step that upgrades version-1 data
   * engine.saves.register('garden', { version: 2, migrate: { 1: d => ({ ...d, beds: [] }) }, save: () => garden.toJSON(), load: d => garden.fromJSON(d) });
   */
  register(key, provider) {
    checkOptions(`saves.register('${key}')`, provider, ['save', 'load', 'first', 'version', 'migrate']);
    const { save, load, first = false, version = 1, migrate = {} } = provider;
    checkPartVersion(key, version, migrate);
    this.providers.set(key, { save, load, first, version, migrate });
    this.engine.session._late(key);   // a part registered after start() (a module installed later) joins the new-game state as it is now
    if (key in this._foreign.parts) adoptPart(this, key);
  }
  /**
   * The save versions this build reads, per part: { world: 1, clock: 1, ... }. A save whose part is newer is refused; an older one is migrated.
   * @returns {Record<string, number>}
   */
  get versions() { return Object.fromEntries([...this.providers].map(([k, p]) => [k, p.version])); }

  // ---------- storage ----------
  /** @internal */
  async _init() {
    const idb = await this.store.open();
    if (!idb) warnOnce(coded('indexeddb', DEV_STRINGS.noIdb));
    try {
      for (const r of await this.store.slots()) if (!this._json.has(r.slot)) { this._json.set(r.slot, r.json); this._meta.set(r.slot, r.savedAt); }
    } catch (e) { this._fail(e); }
  }
  /**
   * Queue a disk write (runs in call order once storage is ready; flush waits for it; used by attachments such as photos).
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  queue(fn) {
    const p = this._queue.then(() => this.whenReady).then(fn);
    this._queue = p.catch(() => {});
    return p;
  }
  /** @internal A save failed: console (or the error tiers, for a part that threw) plus an on-screen toast, never silent */
  _fail(err, slot, report = false) {
    const why = this.engine.t('saves.failed', { why: err?.name === 'QuotaExceededError' ? 'storage full' : err?.message || String(err) });
    if (report) reportError(this.engine, err, `saves.save('${slot}')`);
    else console.error(coded('save-write', `[saves] failed to write ${slot ? `slot "${slot}"` : 'save'}`), err);
    toast(this.engine, why, { kind: 'error', ms: 5000 });
  }
  /** Wait for all queued disk writes to finish (for tests and before the page closes) @returns {Promise<void>} */
  flush() { return this._queue; }

  /** @internal Collect every part: { data, failed: [[key, error]] }. Parts of the loaded save that no module owns are carried along. */
  _collect() {
    const f = this._foreign, failed = [];
    const data = { format: FORMAT, savedAt: Date.now(), versions: { ...f.versions }, parts: { ...f.parts } };   // wall-clock: real time of the save
    for (const [k, p] of this.providers) {
      try { data.parts[k] = p.save(); data.versions[k] = p.version; } catch (e) { failed.push([k, e]); delete data.parts[k]; delete data.versions[k]; }
    }
    return { data, failed };
  }
  /**
   * Collect the data of every part (does not write to the browser): { format, savedAt, versions, parts }.
   * A part whose save() throws is left out and reported (engine.error in dev); save() instead refuses to write such a save.
   * @returns {{ format: number, savedAt: number, versions: Record<string, number>, parts: Record<string, any> }}
   */
  collect() {
    const { data, failed } = this._collect();
    for (const [k, e] of failed) reportError(this.engine, e, `save() of save part '${k}'`);
    return data;
  }
  /**
   * Can this slot be loaded? null when it can, else why not (checked without touching the game):
   * 'missing' | 'corrupt' (unreadable) | 'tooNew' (a newer save format or part) | 'migrate' (an upgrade step is missing or throws).
   * @param {string} [slot]
   * @returns {null | 'missing' | 'corrupt' | 'tooNew' | 'migrate'}
   * @example if (engine.saves.check('slot1') === 'tooNew') showUpdateHint();
   */
  check(slot = 'auto') { const r = readSave(this._json.get(slot), this.providers, slot); return 'reason' in r ? r.reason : null; }
  /**
   * Apply a save's data (an object from collect(), or save text) onto the running game. Resolves true when every part loaded.
   * Refused before anything changes (false, toast) when the data is corrupt, from a newer build or cannot be migrated.
   * After every part loaded it runs the modules' afterLoad hooks (gameplay frozen until they resolve), for saves.load, session.newGame / quit and direct calls
   * alike.
   * If a part's load throws, the game is rolled back to how it was before (every part reloads its pre-load state) and it resolves false; the error goes through
   * the error tiers.
   * The state changes synchronously unless a part's load is async; only the result is a Promise.
   * @param {any} data
   * @param {string} [slot]  for messages only
   * @returns {Promise<boolean>}
   */
  apply(data, slot = '(data)') { return applySave(this, data, slot).then(async ok => { if (ok) await afterLoad(this.engine); return ok; }); }
  /** @internal Put a save in memory and queue the disk write; returns Promise<boolean> (write succeeded) */
  _put(slot, json, savedAt) {
    const prev = this._json.get(slot), prevAt = this._meta.get(slot);
    this._json.set(slot, json); this._meta.set(slot, savedAt);
    return this.queue(() => this.store.putSlot(slot, savedAt, json)).then(() => true, e => {
      // the disk still holds the previous save, so memory goes back to it (unless a later save already replaced this one):
      // list / load / continue never offer a save that is not stored
      if (this._json.get(slot) === json) {
        if (prev == null) { this._json.delete(slot); this._meta.delete(slot); } else { this._json.set(slot, prev); this._meta.set(slot, prevAt); }
      }
      this._fail(e, slot); return false;
    });
  }
  /**
   * Save into a slot (default 'auto'). Returns Promise<boolean>
   * (resolves after the write to IndexedDB: true on success, false with a toast and console error on failure).
   * The in-memory save updates immediately, so a following load / list / export sees it at once; the 'save:written' event fires only after the write succeeds.
   * If any part's save() throws, nothing is written and the slot keeps its previous save (false). A failed write keeps the previous save too.
   * Show "saved" only after the result is true.
   * @param {string} [slot]
   * @returns {Promise<boolean>}
   * @example if (await engine.saves.save('slot1')) toast(engine, 'Saved');   // on false the engine already showed why
   */
  save(slot = 'auto') {
    let data, json;
    try {
      const r = this._collect();
      if (r.failed.length) {
        const [k, err] = r.failed[0];
        this._fail(Object.assign(codedError('save-part-threw', fmt(DEV_STRINGS.saveThrew, { k, slot, msg: err?.message ?? String(err) })), { cause: err }), slot, true);
        return Promise.resolve(false);
      }
      data = r.data; json = JSON.stringify(data);
    } catch (e) { this._fail(e, slot); return Promise.resolve(false); }
    return this._put(slot, json, data.savedAt).then(ok => { if (ok) this.engine.events.emit('save:written', slot); return ok; });
  }
  /**
   * Load a slot onto the running playthrough (a quick load: what the game added during play stays) and resolve true on success; the 'save:loaded' event fires
   * on success.
   * A missing slot resolves false; a corrupt / too new / unmigratable save resolves false with a toast and changes nothing; a part whose load throws rolls the
   * game back.
   * To continue or retry with nothing of the current playthrough left over, use engine.session.load(slot).
   * @param {string} [slot]
   * @returns {Promise<boolean>}
   * @example if (!(await engine.saves.load('quick'))) toast(engine, 'No quick save');
   */
  load(slot = 'auto') { return this._load(slot); }
  /** @internal Load a slot; with base (a collect() result) the save goes on top of it, so a part missing from the save gets base's state (session.load) */
  _load(slot, base) { return loadSlot(this, slot, base); }
  /** All slots, newest first (synchronous, reads the in-memory index) @returns {{ slot: string, savedAt: number }[]} */
  list() {
    return [...this._meta].map(([slot, savedAt]) => ({ slot, savedAt })).sort((a, b) => b.savedAt - a.savedAt);
  }
  /** Delete a slot. Returns a Promise (disk write done); awaiting is optional @param {string} slot @returns {Promise<void>} */
  remove(slot) {
    this._json.delete(slot); this._meta.delete(slot);
    return this.queue(() => this.store.deleteSlot(slot)).catch(e => this._fail(e, slot));
  }
  /** Export as a piece of text (can be copied as a backup; synchronous, without binary attachments) @param {string} [slot] @returns {string} */
  export(slot = 'auto') { try { return btoa(unescape(encodeURIComponent(this._json.get(slot) || ''))); } catch { return ''; } }
  /**
   * Import text from export() into a slot (default 'imported'); checked like importFile and written before it resolves.
   * Resolves true once stored (save:imported fires), false when the text is not a save or the write failed. It does not load the slot.
   * @param {string} text
   * @param {string} [slot]
   * @returns {Promise<boolean>}
   */
  import(text, slot = 'imported') { return importText(this, text, slot); }

  // ---------- files ----------
  /**
   * Download a save file (.json): the save plus every binary attachment (as data: text, so the file is larger; { files: false } exports the save only).
   * Restores everything when browser data is wiped on a phone. Returns Promise<boolean>.
   * @param {string} [slot]
   * @param {{ files?: boolean }} [opts]
   * @returns {Promise<boolean>}
   * @example engine.saves.exportFile('slot1');
   */
  exportFile(slot = 'auto', opts = {}) { return exportSaveFile(this, slot, opts); }
  /**
   * Restore from a save file into slot (default 'imported', so a shared file never overwrites 'auto'). file is a File / Blob; omit it to open a file picker.
   * Everything is checked first (file marker and format, the save inside, attachments must be data: URLs: nothing is fetched).
   * Returns the slot name on success, and null if cancelled, the file is invalid or the write failed (a toast was already shown). It restores the slot only and
   * does not load it.
   * @param {Blob} [file]
   * @param {string} [slot]
   * @returns {Promise<string | null>}
   */
  importFile(file, slot) { return importSaveFile(this, file, slot); }

  /**
   * Autosave into 'auto' every `minutes` minutes of play: counted in fixed seconds, so it waits while paused, frozen or in a menu that freezes the game,
   * and it never saves while no playthrough runs (the title screen, during newGame / load / quit) or after a gameplay error. Returns a handle; remove() stops
   * it.
   * Calling it again replaces the previous autosave.
   * @param {number} [minutes]
   * @returns {{ remove(): void }}
   * @example engine.saves.autosave(3);   // once at boot: it waits by itself while no playthrough runs
   */
  autosave(minutes = 3) {
    if (!(minutes > 0) || !Number.isFinite(minutes)) throw codedError('save-autosave', fmt(DEV_STRINGS.autosave, { got: JSON.stringify(minutes) }));
    this._auto?.remove();
    const h = autosaveHook(this, minutes * 60, () => { if (this._auto === h) this._auto = null; });
    return (this._auto = h);
  }
  /** @internal Stop autosave (called by engine.dispose) */
  dispose() { this._auto?.remove(); this._queue.finally(() => this.store.close()); }   // close the database only after queued writes finish
}

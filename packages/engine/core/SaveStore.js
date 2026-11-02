import { codedError } from './errorHints.js';
// Save storage layer: uses the browser's native IndexedDB (no third-party library) and falls back to localStorage when it is unavailable. Saves uses it; modules never touch it directly.
//
// Two stores in the database:
//   slots  key slot, value { slot, savedAt, json, rev }   world saves (json is JSON text, with no localStorage 5MB cap); rev names the write
//          (`<tab id>:<n>`), so a tab can tell "the save I last saw" from "a newer one another tab wrote" (cross-tab safety, Saves._put)
//   blobs  key [group, id], value { group, id, at, blob, meta }   binary attachments (group tells the purpose, e.g. photos are 'photo'), stored separately and kept out of the world save
// On the localStorage fallback: only world saves are stored (key prefix + slot); attachments are not persisted (blobs reads return empty, writes are ignored).
// Every method returns a Promise; a failed write (quota, IndexedDB error) rejects and Saves reports it in one place.

const STORES = { slots: { keyPath: 'slot' }, blobs: { keyPath: ['group', 'id'] } };

/** Turn an IDBRequest / IDBTransaction into a Promise */
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });
/** rev of a stored record: null = no record; '' = a record written before revs existed */
const revOf = r => r == null ? null : r.rev ?? '';

export class SaveStore {
  /** @param {string} name Database name (each game's saveKey differs, so they do not interfere)  @param {string} prefix Key prefix for the localStorage fallback */
  constructor(name, prefix) {
    this.name = name; this.prefix = prefix;
    /** 'idb' | 'localStorage': meaningful only after open() completes */
    this.mode = 'idb';
    this.db = null;
  }

  /** Open the database; on failure (private mode, disabled) switch to localStorage. Returns whether IndexedDB is in use. */
  async open() {
    try {
      if (typeof indexedDB === 'undefined') throw codedError('indexeddb', 'indexedDB is unavailable');
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => { for (const [n, o] of Object.entries(STORES)) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, o); };
      this.db = await req(r);
      this.db.onversionchange = () => this.db.close();   // yield when another tab wants to upgrade the database
      return true;
    } catch { this.mode = 'localStorage'; return false; }
  }

  _tx(store, mode = 'readonly') { return this.db.transaction(store, mode); }

  /** All world saves: [{ slot, savedAt, json }] */
  async slots() {
    if (this.mode === 'localStorage') {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k.startsWith(this.prefix)) continue;
        const json = localStorage.getItem(k);
        const slot = k.slice(this.prefix.length);
        try { out.push({ slot, savedAt: JSON.parse(json).savedAt, json, rev: localStorage.getItem(this._revKey(slot)) ?? '' }); } catch { /* skip corrupt saves */ }
      }
      return out;
    }
    return req(this._tx('slots').objectStore('slots').getAll());
  }
  /** localStorage fallback: the rev lives under its own key, outside the prefix (slots() must not list it as a save) */
  _revKey(slot) { return 'rev:' + this.prefix + slot; }
  /** @internal localStorage read, synchronous (putSlot checks and writes in one turn) */
  _lsGet(slot) {
    const json = localStorage.getItem(this.prefix + slot);
    if (json == null) return null;
    let savedAt = 0; try { savedAt = JSON.parse(json).savedAt; } catch { /* corrupt: readSave refuses it later */ }
    return { slot, savedAt, json, rev: localStorage.getItem(this._revKey(slot)) ?? '' };
  }
  /** One world save, { slot, savedAt, json, rev } or null */
  async getSlot(slot) {
    if (this.mode === 'localStorage') return this._lsGet(slot);
    return (await req(this._tx('slots').objectStore('slots').get(slot))) ?? null;
  }
  /**
   * Write a save, but only while the stored record is still the one this tab expects (rev `expect`; null = no record): compare and write in ONE
   * readwrite transaction, which IndexedDB runs one at a time across tabs, so two tabs can never both pass the check. A mismatch rejects with
   * { stale: stored record } and writes nothing. localStorage: get and set run in one synchronous turn, which is as atomic as it gets there.
   */
  async putSlot(slot, savedAt, json, rev, expect) {
    const stale = cur => Object.assign(new Error(`slot '${slot}' was written by another tab`), { stale: cur });
    if (this.mode === 'localStorage') {
      if (expect !== undefined) { const cur = this._lsGet(slot); if (revOf(cur) !== expect) throw stale(cur); }
      localStorage.setItem(this.prefix + slot, json); localStorage.setItem(this._revKey(slot), rev ?? ''); return;
    }
    const t = this._tx('slots', 'readwrite'), st = t.objectStore('slots');
    let cur = null;
    if (expect !== undefined) {
      const g = st.get(slot);
      g.onsuccess = () => { cur = g.result ?? null; if (revOf(cur) !== expect) t.abort(); else st.put({ slot, savedAt, json, rev }); };
    } else st.put({ slot, savedAt, json, rev });
    try { await tx(t); } catch (e) { if (expect !== undefined && revOf(cur) !== expect) throw stale(cur); throw e; }
  }
  async deleteSlot(slot) {
    if (this.mode === 'localStorage') { localStorage.removeItem(this.prefix + slot); localStorage.removeItem(this._revKey(slot)); return; }
    const t = this._tx('slots', 'readwrite');
    t.objectStore('slots').delete(slot);
    await tx(t);
  }

  /** One group of attachments, newest first: [{ group, id, at, blob, meta }]; omit group for all */
  async blobs(group) {
    if (this.mode === 'localStorage') return [];
    const all = await req(this._tx('blobs').objectStore('blobs').getAll());
    return all.filter(b => group == null || b.group === group).sort((a, b) => b.at - a.at);
  }
  async putBlob(group, id, blob, meta = null, at = Date.now()) {   // wall-clock: when the attachment was stored, used for ordering
    if (this.mode === 'localStorage') return;
    const t = this._tx('blobs', 'readwrite');
    t.objectStore('blobs').put({ group, id, at, blob, meta });
    await tx(t);
  }
  async deleteBlob(group, id) {
    if (this.mode === 'localStorage') return;
    const t = this._tx('blobs', 'readwrite');
    t.objectStore('blobs').delete([group, id]);
    await tx(t);
  }

  close() { this.db?.close(); this.db = null; }
}

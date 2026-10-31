// Save storage layer: uses the browser's native IndexedDB (no third-party library) and falls back to localStorage when it is unavailable. Saves uses it; modules never touch it directly.
//
// Two stores in the database:
//   slots  key slot, value { slot, savedAt, json }   world saves (json is JSON text, with no localStorage 5MB cap)
//   blobs  key [group, id], value { group, id, at, blob, meta }   binary attachments (group tells the purpose, e.g. photos are 'photo'), stored separately and kept out of the world save
// On the localStorage fallback: only world saves are stored (key prefix + slot); attachments are not persisted (blobs reads return empty, writes are ignored).
// Every method returns a Promise; a failed write (quota, IndexedDB error) rejects and Saves reports it in one place.

const STORES = { slots: { keyPath: 'slot' }, blobs: { keyPath: ['group', 'id'] } };

/** Turn an IDBRequest / IDBTransaction into a Promise */
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });

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
      if (typeof indexedDB === 'undefined') throw new Error('indexedDB is unavailable');
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
        try { out.push({ slot: k.slice(this.prefix.length), savedAt: JSON.parse(json).savedAt, json }); } catch { /* skip corrupt saves */ }
      }
      return out;
    }
    return req(this._tx('slots').objectStore('slots').getAll());
  }
  async putSlot(slot, savedAt, json) {
    if (this.mode === 'localStorage') { localStorage.setItem(this.prefix + slot, json); return; }
    const t = this._tx('slots', 'readwrite');
    t.objectStore('slots').put({ slot, savedAt, json });
    await tx(t);
  }
  async deleteSlot(slot) {
    if (this.mode === 'localStorage') { localStorage.removeItem(this.prefix + slot); return; }
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

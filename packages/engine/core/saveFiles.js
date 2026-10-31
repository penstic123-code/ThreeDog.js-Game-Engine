// Save files (.json download / restore), split out of Saves.js: the world save plus every binary attachment, for backups that survive wiped browser data.
// File shape: { threedog: 'save', format: FILE_FORMAT, game, slot, savedAt, data: <the save envelope>, files: [{ group, id, at, meta, type, url: 'data:...' }] }.
// Import is offline: attachments must be data: URLs and are decoded in place, never fetched.
import { toast } from '../ui/UI.js';
import { coded } from './errorHints.js';
import { fmt } from './validate.js';
import { readSave, parseSave } from './saveVersions.js';

/** Version of the export file wrapper (the save inside carries its own format) */
const FILE_FORMAT = 1;
/** Player-facing save messages (registered by Saves) */
export const SAVE_STRINGS = {
  'zh-CN': { 'saves.failed': '存档失败：{why}（之前的存档还在）', 'saves.badFile': '这不是有效的存档文件', 'saves.imported': '存档已导入到「{slot}」', 'saves.noSlot': '没有可导出的存档',
    'saves.tooNew': '这个存档来自更新版本的游戏，无法读取（存档没有改动）', 'saves.corrupt': '这个存档已损坏，无法读取（存档没有改动）',
    'saves.migrate': '这个存档的版本无法升级，无法读取（存档没有改动）' },
  en: { 'saves.failed': 'Save failed: {why} (the previous save is kept)', 'saves.badFile': 'This is not a valid save file',
    'saves.imported': 'Save imported into "{slot}"', 'saves.noSlot': 'Nothing to export',
    'saves.tooNew': 'This save is from a newer version of the game and cannot be loaded (the save is unchanged)',
    'saves.corrupt': 'This save is damaged and cannot be loaded (the save is unchanged)',
    'saves.migrate': 'This save\'s version cannot be upgraded, so it cannot be loaded (the save is unchanged)' },
};
const MAX_BYTES = 512 * 1024 * 1024;   // a bigger "save" is not one of ours; reading it would stall the tab
const STRINGS = {
  badText: '[saves] import(text): not a save ({why}); nothing was imported',
  bad: '[saves] importFile: not a save file ({why}); nothing was imported',
  attachment: '[saves] importFile: attachment {i} is not a data: URL with a string group and id; nothing was imported',
};

/** Blob -> data: URL (attachments are stored as text in the export file) */
const toDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

/** data: URL -> Blob without the network; null when it is not a data: URL */
function dataUrlBlob(url, type) {
  const m = typeof url === 'string' && /^data:([^,]*?)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const bytes = m[2] ? Uint8Array.from(atob(m[3]), c => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return new Blob([bytes], { type: typeof type === 'string' ? type : m[1].split(';')[0] });
}

/**
 * Implementation of saves.exportFile (see its JSDoc).
 * @param {any} s  the Saves instance
 * @param {string} slot
 * @param {{ files?: boolean }} opts
 * @returns {Promise<boolean>}
 * @internal
 */
export async function exportSaveFile(s, slot, { files = true } = {}) {
  const json = s._json.get(slot);
  if (!json) { toast(s.engine, s.engine.t('saves.noSlot'), { kind: 'save' }); return false; }
  await s.flush();   // wait for freshly saved attachments to finish writing
  const list = [];
  if (files) for (const b of await s.store.blobs()) list.push({ group: b.group, id: b.id, at: b.at, meta: b.meta, type: b.blob.type, url: await toDataURL(b.blob) });
  // splice the world save's JSON text in directly instead of parsing it again (halves memory at tens of MB)
  const head = `{"threedog":"save","format":${FILE_FORMAT},"game":${JSON.stringify(s.prefix)},"slot":${JSON.stringify(slot)},"savedAt":${s._meta.get(slot)},"data":`;
  const blob = new Blob([head, json, ',"files":', JSON.stringify(list), '}'], { type: 'application/json' });
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = `${s.prefix.replace(/-save-$/, '')}-${slot}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);   // presentation: release only after the browser has started the download
  return true;
}

/**
 * Implementation of saves.importFile (see its JSDoc). Everything is checked before anything is written.
 * @param {any} s  the Saves instance
 * @param {Blob} [file]
 * @param {string} [slot]
 * @returns {Promise<string | null>}
 * @internal
 */
export async function importSaveFile(s, file, slot = 'imported') {
  file ??= await pick();
  if (!file) return null;
  const refuse = why => { console.warn(coded('save-import', why)); toast(s.engine, s.engine.t('saves.badFile'), { kind: 'save' }); return null; };   // handled: the player is told, nothing changed
  if (file.size > MAX_BYTES) return refuse(STRINGS.bad.replace('{why}', `${Math.round(file.size / 1e6)} MB`));
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (e) { return refuse(STRINGS.bad.replace('{why}', e.message)); }
  if (obj?.threedog !== 'save') return refuse(STRINGS.bad.replace('{why}', 'no "threedog": "save" marker'));
  if ((obj.format ?? 1) > FILE_FORMAT) return refuse(STRINGS.bad.replace('{why}', `file format ${obj.format}, this build reads up to ${FILE_FORMAT}`));
  const blobs = [];
  for (const [i, p] of (Array.isArray(obj.files) ? obj.files : []).entries()) {
    const blob = typeof p?.group === 'string' && typeof p.id === 'string' ? dataUrlBlob(p.url, p.type) : null;
    if (!blob) return refuse(STRINGS.attachment.replace('{i}', String(i)));
    blobs.push([p, blob]);
  }
  const r = await importData(s, obj.data, slot);
  if (r !== true) return r === 'write' ? null : refuse(STRINGS.bad.replace('{why}', r));   // a failed write already showed its toast
  let ok = true;
  for (const [p, blob] of blobs) {
    try { await s.queue(() => s.store.putBlob(p.group, p.id, blob, p.meta, p.at)); } catch (e) { ok = false; s._fail(e); }
  }
  if (!ok) return null;
  s.engine.events.emit('save:imported', slot);
  toast(s.engine, s.engine.t('saves.imported', { slot }), { kind: 'save' });
  return slot;
}

/**
 * Implementation of saves.import (see its JSDoc).
 * @param {any} s  the Saves instance
 * @param {string} text
 * @param {string} slot
 * @returns {Promise<boolean>}
 * @internal
 */
export async function importText(s, text, slot) {
  let obj;
  try { obj = JSON.parse(decodeURIComponent(escape(atob(String(text).trim())))); } catch (e) { console.warn(coded('save-import', fmt(STRINGS.badText, { why: e.message }))); return false; }
  const r = await importData(s, obj, slot);
  if (r === true) { s.engine.events.emit('save:imported', slot); return true; }
  if (r !== 'write') console.warn(coded('save-import', fmt(STRINGS.badText, { why: r })));   // a failed write already showed its toast
  return false;
}
/**
 * Store an imported save object (checked like a load first): true, 'write' (the disk write failed) or the reason it is not a save.
 * @param {any} s  the Saves instance
 * @param {any} obj
 * @param {string} slot
 * @returns {Promise<true | string>}
 * @internal
 */
async function importData(s, obj, slot) {
  const r = readSave(obj, s.providers, slot);
  if (r.reason === 'corrupt' || r.reason === 'missing') return r.dev;   // too new / unmigratable saves are kept: a newer build can load them
  const data = parseSave(obj);
  return (await s._put(slot, JSON.stringify(data), data.savedAt ?? 0)) ? true : 'write';
}

/** Open a file picker; null when cancelled */
function pick() {
  return new Promise(res => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = () => res(input.files?.[0] ?? null);
    input.oncancel = () => res(null);
    input.click();
  });
}

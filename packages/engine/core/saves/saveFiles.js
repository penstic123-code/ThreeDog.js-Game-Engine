// Save files (.json download / restore), split out of Saves.js: the world save plus every binary attachment, for backups that survive wiped browser data.
// File shape: { threedog: 'save', format: FILE_FORMAT, game, slot, savedAt, data: <the save envelope>, files: [{ group, id, at, meta, type, url: 'data:...' }] }.
// Import is offline: attachments must be data: URLs and are decoded in place, never fetched.
import { toast } from '../../ui/UI.js';
import { coded } from '../base/errorHints.js';
import { fmt, warnOnce } from '../base/validate.js';
import { readSave, parseSave } from './saveVersions.js';

/** Version of the export file wrapper (the save inside carries its own format) */
const FILE_FORMAT = 1;
/** Player-facing save messages (registered by Saves) */
export const SAVE_STRINGS = {
  'zh-CN': { 'saves.failed': '存档失败：{why}（之前的存档还在）', 'saves.badFile': '这不是有效的存档文件', 'saves.imported': '存档已导入到「{slot}」', 'saves.noSlot': '没有可导出的存档',
    'saves.tooNew': '这个存档来自更新版本的游戏，无法读取（存档没有改动）', 'saves.corrupt': '这个存档已损坏，无法读取（存档没有改动）',
    'saves.migrate': '这个存档的版本无法升级，无法读取（存档没有改动）',
    'saves.otherTab': '没有存档：另一个标签页刚存过「{slot}」，为了不覆盖那边更新的进度，这里没有写入。读取它继续，或存到别的位置',
    'saves.otherTabKept': '没有删除：另一个标签页刚存过「{slot}」，那边更新的进度保留了' },
  en: { 'saves.failed': 'Save failed: {why} (the previous save is kept)', 'saves.badFile': 'This is not a valid save file',
    'saves.imported': 'Save imported into "{slot}"', 'saves.noSlot': 'Nothing to export',
    'saves.tooNew': 'This save is from a newer version of the game and cannot be loaded (the save is unchanged)',
    'saves.corrupt': 'This save is damaged and cannot be loaded (the save is unchanged)',
    'saves.migrate': 'This save\'s version cannot be upgraded, so it cannot be loaded (the save is unchanged)',
    'saves.otherTab': 'Not saved: another tab just saved "{slot}", so this one did not overwrite that newer progress. Load it to continue, or save to another slot',
    'saves.otherTabKept': 'Not deleted: another tab just saved "{slot}", so that newer progress was kept' },
};
const MAX_BYTES = 512 * 1024 * 1024;   // a bigger "save" is not one of ours; reading it would stall the tab
const STRINGS = {
  badText: '[saves] import(text): not a save ({why}); nothing was imported',
  bad: '[saves] importFile: not a save file ({why}); nothing was imported',
  damaged: "[saves] exportFile: attachment '{g}/{id}' holds no data and was left out of the file",
  attachment: '[saves] importFile: attachment {i} is not a data: URL with a string group and id; nothing was imported',
};

/** Blob -> data: URL (attachments are stored as text in the export file) */
const toDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

/** data: URL -> Blob without the network; null when it is not a readable data: URL */
function dataUrlBlob(url, type) {
  const m = typeof url === 'string' && /^data:([^,]*?)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  try {
    const bytes = m[2] ? Uint8Array.from(atob(m[3]), c => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
    return new Blob([bytes], { type: typeof type === 'string' ? type : m[1].split(';')[0] });
  } catch { return null; }   // a hand-edited file: bad base64 or a bad % escape
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
  try {
    if (files) for (const b of await s.store.blobs()) {
      // a row damaged outside the engine must not cost the player the whole backup
      if (b.blob instanceof Blob) list.push({ group: b.group, id: b.id, at: b.at, meta: b.meta, type: b.blob.type, url: await toDataURL(b.blob) });
      else warnOnce(coded('save-write', fmt(STRINGS.damaged, { g: b.group, id: b.id })));
    }
  } catch (e) { s._fail(e ?? new Error('attachment unreadable'), slot); return false; }
  // splice the world save's JSON text in directly instead of parsing it again (halves memory at tens of MB)
  const head = `{"threedog":"save","format":${FILE_FORMAT},"game":${JSON.stringify(s._prefix)},"slot":${JSON.stringify(slot)},"savedAt":${JSON.stringify(s._meta.get(slot) ?? 0)},"data":`;
  const blob = new Blob([head, json, ',"files":', JSON.stringify(list), '}'], { type: 'application/json' });
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = `${s._prefix.replace(/-save-$/, '')}-${slot}-${new Date().toISOString().slice(0, 10)}.json`;
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
  const refuse = why => { warnOnce(coded('save-import', why)); toast(s.engine, s.engine.t('saves.badFile'), { kind: 'save' }); return null; };   // handled: the player is told, nothing changed
  if (file.size > MAX_BYTES) return refuse(fmt(STRINGS.bad, { why: `${Math.round(file.size / 1e6)} MB` }));
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (e) { return refuse(fmt(STRINGS.bad, { why: e.message })); }
  if (obj?.threedog !== 'save') return refuse(fmt(STRINGS.bad, { why: 'no "threedog": "save" marker' }));
  if ((obj.format ?? 1) > FILE_FORMAT) return refuse(fmt(STRINGS.bad, { why: `file format ${obj.format}, this build reads up to ${FILE_FORMAT}` }));
  const blobs = [];
  for (const [i, p] of (Array.isArray(obj.files) ? obj.files : []).entries()) {
    const blob = typeof p?.group === 'string' && typeof p.id === 'string' ? dataUrlBlob(p.url, p.type) : null;
    if (!blob) return refuse(fmt(STRINGS.attachment, { i: String(i) }));
    blobs.push([p, blob]);
  }
  const bad = saveProblem(s, obj.data, slot);
  if (bad) return refuse(fmt(STRINGS.bad, { why: bad }));
  // attachments first and all at once: a failed write then leaves nothing, and only a stored file reaches the list
  const rows = blobs.map(([p, blob]) => ({ group: p.group, id: p.id, blob, meta: p.meta ?? null, at: Number.isFinite(p.at) ? p.at : Date.now() }));   // wall-clock: ordering, as putBlob
  try { await s._enqueue(() => s.store.putBlobs(rows)); } catch (e) { s._fail(e); return null; }
  if (!(await putImported(s, obj.data, slot))) return null;   // a failed write already showed its toast
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
  try { obj = JSON.parse(decodeURIComponent(escape(atob(String(text).trim())))); } catch (e) { warnOnce(coded('save-import', fmt(STRINGS.badText, { why: e.message }))); return false; }
  const bad = saveProblem(s, obj, slot);
  if (bad) { warnOnce(coded('save-import', fmt(STRINGS.badText, { why: bad }))); return false; }
  if (!(await putImported(s, obj, slot))) return false;   // a failed write already showed its toast
  s.engine.events.emit('save:imported', slot);
  return true;
}
/** Why an imported save object is not one (checked like a load), or null. Too new / unmigratable saves are kept: a newer build can load them @internal */
function saveProblem(s, obj, slot) {
  const r = readSave(obj, s.providers, slot);
  return r.reason === 'corrupt' || r.reason === 'missing' ? r.dev : null;
}
/** Store a checked save object; false when the write failed. savedAt comes from outside: list() sorts by it @internal */
function putImported(s, obj, slot) {
  const data = parseSave(obj);
  return s._put(slot, JSON.stringify(data), Number.isFinite(data.savedAt) ? data.savedAt : 0);
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

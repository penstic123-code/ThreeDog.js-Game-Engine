// Photo mode: while taking the shot, temporarily raise resolution and shadow precision (with the sky module) and enable bloom, then restore at once, so normal frame rate is unaffected.
//
// Taking a photo is the op photo.take (recipes/23-ops.md): the photo key, a game's shutter button, the dev bridge and tests all run it, and
// photo.canTake (true or a reason) is its can. engine.photo.take() is the low-level capture the op calls (no checks).
// const r = engine.ops.run('photo.take');   // r.value = { url, time, position, subject } or r.reason (e.g. 'noFilm')
// When the photo key's op is refused the module emits photo:denied { reason } (the game shows it; a button reads r.reason itself).
// subject is what is in the middle of the frame { name, kind, distance }: NPC (kind 'npc'), entity ('entity'), named object ('object'),
// vegetation ('vegetation'; after hitting an instanced mesh, vegetation.instanceAt looks up the kind); null when it hits the sky or an unnamed ground.
// Photo key defaults to P, gamepad RB (action 'photo'); can be changed at install: photo({ keys: ['KeyC'], padKeys: ['PadX'] }); pass keys: [] for no key
// Shutter sound: style pack style.sounds.shutter supplies a file, otherwise a synthesized fallback
import { checkOptions } from '../../core/validate.js';
import { toast } from '../../ui/UI.js';
const GROUP = 'photo';   // group name in the blobs store of engine.saves.store
const TAKE_KEYS = ['scale', 'shadowMapSize', 'bloom', 'quality', 'format'];

export class Photo {
  constructor(engine, { scale = 1.6, shadowMapSize = 4096, bloom = true, quality = 0.92, format = 'image/jpeg', maxAlbum = 50 } = {}) {
    Object.assign(this, { engine, scale, shadowMapSize, bloom, quality, format, maxAlbum });
    this.album = [];
    this._n = 0;                        // shots taken this run (photo id = shot time + sequence number)
    this.canTake = () => true;          // the op's can: a game returns false or a reason string (e.g. 'noFilm') to refuse
  }

  /** Capture a photo now, without checks (the op photo.take checks canTake and calls this). Returns { url, time, position, subject } */
  take(opts = {}) {
    checkOptions('photo.take()', opts, TAKE_KEYS);
    const o = { scale: this.scale, shadowMapSize: this.shadowMapSize, bloom: this.bloom, quality: this.quality, format: this.format, ...opts };
    const e = this.engine, r = e.renderer, sky = e.sky;
    const prevPR = r.getPixelRatio(), prevMap = sky?.shadowMapSize, prevBloom = e.post.get('bloom')?.enabled;
    const pr = Math.min(3, prevPR * o.scale);
    r.setPixelRatio(pr); e.post.setPixelRatio(pr);
    if (e.shadows && sky) sky.setShadowMapSize(o.shadowMapSize);
    e.post.enable('bloom', o.bloom);
    r.shadowMap.needsUpdate = true;     // shadows may update only every few frames (sky's shadow.updateEvery); force an update on the photo frame
    e.post.render(0);
    const url = r.domElement.toDataURL(o.format, o.quality);
    r.setPixelRatio(prevPR); e.post.setPixelRatio(prevPR);
    if (e.shadows && sky) sky.setShadowMapSize(prevMap);
    if (prevBloom !== undefined) e.post.enable('bloom', prevBloom);
    const p = e.actorPosition() ?? e.cameraRig?.target?.position;   // where whoever the user controls stands (engine.actor)
    const shot = { url, time: sky?.clock ?? '', position: p ? { x: Math.round(p.x), z: Math.round(p.z) } : null, subject: this.subject() };
    this.album.unshift(shot); if (this.album.length > this.maxAlbum) this._drop(this.album.pop());
    this._persist(shot);
    e.events.emit('photo:taken', shot);
    e.audio.sfx('shutter');
    return shot;
  }

  // ---------- photos are stored separately (Blob, not in the world save JSON) ----------
  /** Store into IndexedDB: convert the data: URL to a Blob; failures must be reported, never dropped silently.
   *  Afterwards the album keeps a blob: URL instead of the data: string (a full-size JPEG string is megabytes of JS heap; 50 of them add up) */
  async _persist(shot) {
    const id = shot.id = `${Date.now().toString(36)}-${this._n++}`;   // wall-clock: photo id
    const meta = { time: shot.time, position: shot.position, subject: shot.subject };
    const saves = this.engine.saves;
    try {
      await saves.queue(async () => {   // queued at once, so saves.flush() waits for this photo
        const blob = await (await fetch(shot.url)).blob();
        if (this.album.includes(shot)) shot.url = URL.createObjectURL(blob);   // still in the album: hold the bytes as a Blob from now on
        await saves.store.putBlob(GROUP, id, blob, meta);
      });
    } catch (err) { this._fail(err); }
  }
  /** Photos pushed out of the album: delete from storage and release the blob: URLs created at load */
  _drop(shot) {
    if (shot.url.startsWith('blob:')) URL.revokeObjectURL(shot.url);
    if (shot.id) this.engine.saves.queue(() => this.engine.saves.store.deleteBlob(GROUP, shot.id)).catch(err => this._fail(err));
  }
  /** At startup / after importing a save file, read the stored photos back into the album (newest first, merged with and de-duplicated against what is already there) */
  async restore() {
    const saves = this.engine.saves;
    await saves.whenReady;
    let rows; try { rows = await saves.store.blobs(GROUP); } catch (err) { this._fail(err); return; }
    const have = new Set(this.album.map(s => s.id));
    for (const r of rows) if (!have.has(r.id)) this.album.push({ id: r.id, url: URL.createObjectURL(r.blob), ...r.meta, at: r.at });
    this.album.sort((a, b) => (b.at ?? Infinity) - (a.at ?? Infinity) || 0);   // a just-taken shot has no `at`: goes first
    while (this.album.length > this.maxAlbum) this._drop(this.album.pop());
  }
  _fail(err) {
    console.error('[photo] failed to save photo', err);
    toast(this.engine, this.engine.t('saves.failed', { why: err?.message || String(err) }), { kind: 'error', ms: 5000 });
  }

  /** What is in the middle of the frame: { name, kind, distance } or null (usable without taking a photo) */
  subject() {
    const e = this.engine, skip = new Set([e.sky?.dome, e.player?.root].filter(Boolean));
    const hit = e.pick(0, 0, { targets: [e.scene], filter: h => !h.object.isPoints && !h.object.isSprite && !under(h.object, skip) });
    if (!hit) return null;
    const distance = Math.round(hit.distance * 10) / 10;
    if (hit.object.isInstancedMesh) {   // instanced things (vegetation): ask vegetation which kind it is
      const v = e.vegetation?.instanceAt(hit.point, { radius: 3 });
      return v ? { name: v.species, kind: 'vegetation', distance } : null;
    }
    for (let o = hit.object; o; o = o.parent) {
      const npc = e.npcs?.list.find(n => n.root === o);
      if (npc) return { name: npc.name, kind: 'npc', distance };
      if (o.userData.entity != null) return { name: e.entities?.get(o.userData.entity)?.type ?? String(o.userData.entity), kind: 'entity', distance };
      if (o.userData.name || o.name) return { name: o.userData.name ?? o.name, kind: 'object', distance };
    }
    return null;
  }
}

function under(o, set) { for (let p = o; p; p = p.parent) if (set.has(p)) return true; return false; }

const STRINGS = { 'zh-CN': { 'photo.action': '拍照' }, en: { 'photo.action': 'Take photo' } };

/** Photo module. Once installed: engine.ops.run('photo.take') takes a photo through photo.canTake; engine.photo.take() captures without checks */
export function photo(all = {}) {
  const { keys = ['KeyP'], padKeys = ['PadRB'], ...opts } = all;
  let ph = null;
  return {
    name: 'photo', label: 'Photo mode', optional: ['cameraRig', 'sky', 'vegetation', 'entities'],
    install(e) {
      checkOptions('photo()', all, ['keys', 'padKeys', 'maxAlbum', ...TAKE_KEYS]);
      e.i18n.add(STRINGS);
      if (keys.length) { e.input.define('photo', keys, 'photo.action', { pad: padKeys }); e.input.touchButton('photo', 'photo.action'); }
      e.audio.register('shutter', (audio, v, p) => { audio.noiseBurst({ dur: 0.03, type: 'highpass', freq: p.freq ?? 3000, vol: p.volume ?? 0.4 }); audio.noiseBurst({ dur: 0.05, type: 'bandpass', freq: 1800, vol: (p.volume ?? 0.4) * 0.75, delay: 0.07 }); });
      ph = new Photo(e, opts);
      ph.restore();                                  // read photos taken last time back from storage
      e.ops.define('photo.take', {
        desc: 'Take a photo (refused when photo.canTake() returns false or a reason)',
        can: () => { const r = ph.canTake(); return r === true ? true : typeof r === 'string' && r ? r : 'denied'; },
        run: () => ph.take(),
        offers: () => [{}],
        reasons: { denied: 'photo.canTake() returned false' },
      });
      e.events.on('save:imported', () => ph.restore());   // after restoring from a save file, the attachments in the file (photos) also go into the album
      return ph;
    },
    frame(dt, e) {
      if (!keys.length || !e.input.pressed('photo')) return;
      const r = e.ops.run('photo.take', {}, { source: 'player' });
      if (!r.ok && r.reason !== 'halted') e.events.emit('photo:denied', { reason: r.reason });
    },
  };
}

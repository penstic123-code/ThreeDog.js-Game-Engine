// Photo mode: a sharper shot, then restore. Resolution and the shadow maps of every casting DirectionalLight in the scene rise for the one frame, so normal
// frame rate is unaffected. Why every one: the sun is usually the game's own light.
// Bloom follows the game's post by default (bloom: null): a photo looks like the game; bloom: true / false forces it for the shot only.
//
// Taking a photo is the op photo.take (recipes/23-ops.md): the photo key, a game's shutter button, the dev bridge and tests all run it, and
// photo.canTake (true or a reason) is its can. engine.photo.take() is the low-level capture the op calls (no checks).
// const r = engine.ops.run('photo.take');   // r.value = { url, time, position, subject } or r.code (e.g. 'noFilm')
// When the photo key's op is refused the module emits photo:denied { reason } (the game shows it; a button reads r.code itself).
// subject is what is in the middle of the frame { name, kind, distance }: NPC (kind 'npc'), entity ('entity'), named object ('object'),
// vegetation ('vegetation'; after hitting an instanced mesh, vegetation.instanceAt looks up the kind); null when it hits the sky or an unnamed ground.
// The photo key (action 'photo') is the game's: engine.input.bind('photo', ['KeyC', 'PadX']), presets.bindings.photo (P / gamepad RB) or [] for no key
// Shutter sound: the game's createEngine({ audio: { sounds: { shutter } } }) supplies a file, otherwise a synthesized fallback
import { warnOnce } from '../../core/validate.js';
import { builtInSounds } from '../../core/assetManifest.js';
import { readParams, keysSchema } from '../../core/params.js';
import { toast } from '../../ui/UI.js';
import { coded } from '../../core/errorHints.js';
import { setShadowUpdate, shadowsOn } from '../../render/backend.js';
const GROUP = 'photo';   // attachment group in engine.saves
const TAKE_KEYS = ['scale', 'shadowMapSize', 'bloom', 'quality', 'format'];

export class Photo {
  constructor(engine, { scale = 1.6, shadowMapSize = 4096, bloom = null, quality = 0.92, format = 'image/jpeg', maxAlbum = 50 } = {}) {
    Object.assign(this, { engine, scale, shadowMapSize, bloom, quality, format, maxAlbum });
    this.album = [];
    this._n = 0;                        // shots taken this run (photo id = shot time + sequence number)
    this.canTake = () => true;          // the op's can: a game returns false or a reason string (e.g. 'noFilm') to refuse
  }

  /** Capture a photo now, without checks (the op photo.take checks canTake and calls this). Returns { url, time, position, subject } */
  take(opts = {}) {
    readParams('photo.take()', keysSchema(TAKE_KEYS), opts);
    const o = { scale: this.scale, shadowMapSize: this.shadowMapSize, bloom: this.bloom, quality: this.quality, format: this.format, ...opts };
    const e = this.engine, r = e.renderer;
    const prevPR = r.getPixelRatio(), prevBloom = e.post.get('bloom')?.enabled, suns = [];
    if (shadowsOn(e)) e.scene.traverse(l => { if (l.isDirectionalLight && l.castShadow && l.visible) suns.push([l, l.shadow.mapSize.x, l.shadow.mapSize.y]); });
    const pr = Math.min(3, prevPR * o.scale);
    const forceBloom = typeof o.bloom === 'boolean' && prevBloom !== undefined;
    let url, bloomHold = null;
    // restored in finally: a throw mid-shot (a failed WebGPU frame, a tainted canvas in toDataURL) must not leave the game running at the photo's
    // pixel ratio and shadow map size with photo's bloom hold still on
    try {
      r.setPixelRatio(pr);   // the post chain follows the renderer on its next draw (postWebGL.js follow)
      for (const [l] of suns) e.shadows.mapSize(l, o.shadowMapSize);
      // a hold on the system layer, removed after the shot: the game's own choice stays what it was (tests/specs/render-once.mjs); a settings restriction still wins
      bloomHold = forceBloom ? e.mod('post.bloom.enabled', { owner: 'photo', set: o.bloom, layer: 'system' }) : null;
      setShadowUpdate(r, e.scene, { now: true });     // shadows may update only every few frames (engine.shadows.budget); force an update on the photo frame
      e.renderOnce();   // the frame the player sees, post included, read below in the same task; a fresh frame on WebGPU (engine.renderOnce)
      url = r.domElement.toDataURL(o.format, o.quality);
    } finally {
      r.setPixelRatio(prevPR);
      for (const [l, w, h] of suns) e.shadows.mapSize(l, w, h);
      bloomHold?.remove();
    }
    const p = e.actorPosition() ?? e.cameraRig?.focusPoint();   // where whoever the user controls stands (engine.actor)
    const shot = { url, time: e.calendar?.clock ?? '', position: p ? { x: Math.round(p.x), z: Math.round(p.z) } : null, subject: this.subject() };
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
    try {
      await this.engine.saves.putAttachment(GROUP, id, async () => {   // a function, so saves.flush() also waits for the bytes of this photo
        const blob = await (await fetch(shot.url)).blob();
        if (this.album.includes(shot)) shot.url = URL.createObjectURL(blob);   // still in the album: hold the bytes as a Blob from now on
        return blob;
      }, meta);
    } catch (err) { this._fail(err); }
  }
  /** Photos pushed out of the album: delete from storage and release the blob: URLs created at load */
  _drop(shot) {
    if (shot.url.startsWith('blob:')) URL.revokeObjectURL(shot.url);
    if (shot.id) this.engine.saves.removeAttachment(GROUP, shot.id).catch(err => this._fail(err));
  }
  /** At startup / after importing a save file, read the stored photos back into the album (newest first, merged with and de-duplicated against what is already there) */
  async restore() {
    let rows; try { rows = await this.engine.saves.attachments(GROUP); } catch (err) { this._fail(err); return; }
    const have = new Set(this.album.map(s => s.id));
    for (const r of rows) if (!have.has(r.id)) this.album.push({ id: r.id, url: URL.createObjectURL(r.blob), ...r.meta, at: r.at });
    this.album.sort((a, b) => (b.at ?? Infinity) - (a.at ?? Infinity) || 0);   // a just-taken shot has no `at`: goes first
    while (this.album.length > this.maxAlbum) this._drop(this.album.pop());
  }
  _fail(err) {
    warnOnce(coded('save-write', `[photo] failed to save photo: ${err?.message ?? err}`));
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
    // an NPC anywhere up the chain wins over a named part on the way: character bodies name their parts ('torso', 'head'), and a photo of
    // someone is a photo of that someone, not of their torso. Only without an NPC does the nearest named object count
    const npcs = e.npcs?.list() ?? [];
    for (let o = hit.object; o; o = o.parent) { const npc = npcs.find(n => n.root === o); if (npc) return { name: npc.name, kind: 'npc', distance }; }
    for (let o = hit.object; o; o = o.parent) if (o.userData.name || o.name) return { name: o.userData.name ?? o.name, kind: 'object', distance };
    return null;
  }
}

function under(o, set) { for (let p = o; p; p = p.parent) if (set.has(p)) return true; return false; }

const STRINGS = { 'zh-CN': { 'module.photo': '拍照', 'photo.action': '拍照' }, en: { 'module.photo': 'photo', 'photo.action': 'Take photo' } };

const PHOTO_PARAMS = keysSchema(['maxAlbum', ...TAKE_KEYS]);

/** Photo module. Once installed: engine.ops.run('photo.take') takes a photo through photo.canTake; engine.photo.take() captures without checks */
export function photo(all = {}) {
  readParams('photo', PHOTO_PARAMS, all);
  const opts = all;
  let ph = null;
  return {
    name: 'photo', type: 'tool', params: PHOTO_PARAMS, options: all, label: 'Photo mode', optional: ['cameraRig', 'sky', 'calendar', 'vegetation', 'characters'],
    install(e, ctx) {
      e.i18n.add(STRINGS);
      // declared only: the game binds the key (presets.bindings.photo or its own; [] = no key), so every key in a game comes from one bindings table
      ctx.input.action('photo', { label: 'photo.action' });
      if (e.input.keysOf('photo').length) e.input.touchButton('photo', 'photo.action');
      builtInSounds(e.assets, { shutter: (audio, p, out) => {   // sound asset 'shutter', silent until audio.sounds names it
        audio.noiseBurst({ dur: 0.03, type: 'highpass', freq: p.freq ?? 3000, vol: p.volume ?? 0.4, out });
        audio.noiseBurst({ dur: 0.05, type: 'bandpass', freq: 1800, vol: (p.volume ?? 0.4) * 0.75, delay: 0.07, out }); return 0.15;
      } });
      ph = new Photo(e, opts);
      ph.restore();                                  // read photos taken last time back from storage
      e.ops.define('photo.take', {
        desc: 'Take a photo (refused when photo.canTake() returns false or a reason)',
        can: () => { const r = ph.canTake(); return r === true ? true : typeof r === 'string' && r ? r : 'denied'; },
        run: () => ph.take(),
        offers: () => [{}],
        reasons: { denied: 'photo.canTake() returned false' },
      });
      ctx.track(e.events.on('save:imported', () => ph.restore()));   // after restoring from a save file, the attachments in the file (photos) also go into the album
      return ph;
    },
    frame(dt, e) {
      if (!e.input.pressed('photo')) return;
      const r = e.ops.run('photo.take', {}, { source: 'player' });
      if (!r.ok && r.code !== 'halted') e.events.emit('photo:denied', { reason: r.code });
    },
    // "did the shot land and what was in it": album size and the newest shot's subject; whether it can be taken now is describe().actions (photo.take)
    describe(e) {
      const s = ph.album[0];
      return { album: ph.album.length, maxAlbum: ph.maxAlbum, keyBound: e.input.keysOf('photo').length > 0,
        last: s ? { time: s.time, position: s.position, subject: s.subject?.name ?? null } : null };
    },
  };
}

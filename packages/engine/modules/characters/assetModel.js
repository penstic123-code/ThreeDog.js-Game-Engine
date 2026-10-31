// Character model named by asset (Character({ model: 'hero' }) or style.character.model): construction is synchronous, loading is not.
// A model already loaded is swapped in at once (engine.assets.modelNow); otherwise the character keeps its placeholder body (style create() or the gray capsule) until engine.assets.model(name) resolves, then the copy
// (SkeletonUtils clone, so many characters share one asset) replaces the body under the same root: position, facing, state and every
// reference to the character or its root (collision, interactions, world view) stay valid. Loaded only when a string model is used.
import { warnOnce } from '../../core/validate.js';
import { fmt } from '../../core/opsCheck.js';

const STRINGS = {
  unknown: 'Character model "{name}" is not a registered model asset (registered: {list}). Fix: use one of those names, or register it first: engine.assets.manifest({ models: { {name}: \'/models/{name}.glb\' } })',
  failed: 'Character model "{name}" did not load ({why}); the character keeps its placeholder body. Registered models: {list}; engine.loading has the error',
};

/**
 * Start loading the asset model for ch; returns the promise stored as ch.whenReady (never rejects).
 * Throws at once when a manifest is registered and lacks the name (paths with / or . load as files).
 * @param {import('./Character.js').Character} ch
 * @param {string} name
 * @param {(model: any) => void} use builds the model and Animator on ch
 */
export function loadAssetModel(ch, name, use) {
  const e = ch.engine, A = e.assets;
  const names = [...A.entries].filter(([, x]) => x.type === 'model' && x.named).map(([n]) => n);
  const list = names.join(', ') || 'none; register them with engine.assets.manifest({ models })';
  if (names.length && !names.includes(name) && !/[/.]/.test(name)) throw new Error(fmt(STRINGS.unknown, { name, list }));
  const fail = why => warnOnce(fmt(STRINGS.failed, { name, why, list }));
  const swap = m => {
    if (ch._disposed || e.disposed) { e.remove(m); return; }   // removed before loading finished: never reaches the scene, the copy is released
    // a registered file that failed resolves to the assets gray box: the character's own placeholder body is the better stand-in
    if (m.name === 'placeholder' && e.loading.get(name, 'model')?.phase === 'failed') { e.remove(m); fail('load failed'); return; }
    const rig = ch._rig;   // drop the placeholder body and the joint properties it put on the character
    for (const k in rig.joints || {}) if (ch[k] === rig.joints[k]) delete ch[k];
    e.remove(rig.root);
    ch._rig = ch.hips = ch.head = null; ch.limbs = [];
    use(m);
    e.events.emit('character:model', { character: ch, model: m });
  };
  // already loaded (another NPC uses it, or this one was built before): swap now, so a character rebuilt far -> near never shows the placeholder
  const now = A.modelNow(name);
  if (now) { swap(now); return Promise.resolve(); }
  ch.ready = false;
  return A.model(name).then(swap).catch(err => { if (!ch._disposed) fail(err.message); }).finally(() => { ch.ready = true; });
}

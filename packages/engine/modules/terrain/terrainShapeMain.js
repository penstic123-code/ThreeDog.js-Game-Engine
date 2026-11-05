// Main-thread side of terrain({ shape }): checks the options and turns its functions into source text for the workers (the same rules as
// height / groundType), keeps the side material out of the worker config, and watches for things falling out of the world (terrain:void).
// The engine does not respawn anything: what falling off means (respawn, damage, a cutscene) is the game's choice.
import { readParams, keysSchema } from '../../core/base/params.js';
import { compilePure } from '../../core/threads/threadPure.js';
import { codedError } from '../../core/base/errorHints.js';

const NO_MASK = 'terrain({ shape }): mask is required, a pure (x, z, n) => number that is > 0 where there is ground, '
  + 'e.g. mask: (x, z) => 40 - Math.hypot(x, z), or a gray image { url, size: [200, 200], threshold: 0.5 }';
const src = (v, label) => (typeof v === 'function' ? compilePure(v, label).src : v);

/** Validate cfg.shape and replace it with its worker-safe form (in place). Returns side.material (main thread only) or null */
export function prepareShape(cfg) {
  const s = cfg.shape;
  readParams('terrain({ shape })', keysSchema(['mask', 'edge', 'side', 'bottom', 'voidY']), s);
  if (s.mask == null) throw codedError('terrain-option', NO_MASK);
  if (typeof s.mask === 'object') readParams('terrain({ shape: { mask } })', keysSchema(['url', 'data', 'width', 'height', 'size', 'center', 'threshold']), s.mask);
  readParams('terrain({ shape: { edge } })', keysSchema(['noise', 'size', 'jitter', 'round']), s.edge || {});
  readParams('terrain({ shape: { side } })', keysSchema(['depth', 'ground', 'material']), s.side || {});
  if (s.bottom) readParams('terrain({ shape: { bottom } })', keysSchema(['depth', 'ground']), s.bottom);
  const { material = null, ...side } = s.side || {};
  side.depth = src(side.depth, 'terrain({ shape: { side: { depth } } })');
  cfg.shape = { ...s, mask: src(s.mask, 'terrain({ shape: { mask } })'), side,
    bottom: s.bottom ? { ...s.bottom, depth: src(s.bottom.depth, 'terrain({ shape: { bottom: { depth } } })') } : null };
  return material;
}

/**
 * Each fixed step: the player gets one terrain:void event per fall below engine.terrain.voidY. Rigid bodies are reported by the physics
 * module itself (it reads engine.ground.voidY), so terrain does not reach into another module
 */
export function voidWatcher(e, w) {
  let fallen = false;
  return () => {
    const p = e.player?.position;
    if (!p) return;
    if (p.y >= w.voidY) { fallen = false; return; }   // back above (the game moved it): the next fall reports again
    if (fallen) return;
    fallen = true;
    e.events.emit('terrain:void', { who: e.player, position: { x: p.x, y: p.y, z: p.z } });
  };
}

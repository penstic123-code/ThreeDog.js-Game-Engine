// Main-thread side of terrain({ shape }): checks the options and turns its functions into source text for the workers (the same rules as
// height / groundType), keeps the side material out of the worker config, and watches for things falling out of the world (terrain:void).
// The engine does not respawn anything: what falling off means (respawn, damage, a cutscene) is the game's choice.
import { checkOptions } from '../../core/validate.js';
import { compilePure } from '../../core/threadPure.js';

const NO_MASK = 'terrain({ shape }): mask is required, a pure (x, z, n) => number that is > 0 where there is ground, '
  + 'e.g. mask: (x, z) => 40 - Math.hypot(x, z), or a gray image { url, size: [200, 200], threshold: 0.5 }';
const src = (v, label) => (typeof v === 'function' ? compilePure(v, label).src : v);

/** Validate cfg.shape and replace it with its worker-safe form (in place). Returns side.material (main thread only) or null */
export function prepareShape(cfg) {
  const s = cfg.shape;
  checkOptions('terrain({ shape })', s, ['mask', 'edge', 'side', 'bottom', 'voidY']);
  if (s.mask == null) throw new Error(NO_MASK);
  if (typeof s.mask === 'object') checkOptions('terrain({ shape: { mask } })', s.mask, ['url', 'data', 'width', 'height', 'size', 'center', 'threshold']);
  checkOptions('terrain({ shape: { edge } })', s.edge || {}, ['noise', 'size', 'jitter', 'round']);
  checkOptions('terrain({ shape: { side } })', s.side || {}, ['depth', 'ground', 'material']);
  if (s.bottom) checkOptions('terrain({ shape: { bottom } })', s.bottom, ['depth', 'ground']);
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

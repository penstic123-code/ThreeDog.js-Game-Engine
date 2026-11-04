// @ts-check
// The bloom on the lamp heads. Added but off on low-tier devices: it blurs the whole frame several times.
import { bloom } from '@threedog/post-effects';
import { BLOOM, GLARE } from './palette.js';

/** @param {any} engine @param {{ glare: boolean }} o */
export function createPost(engine, o) {
  engine.post.add(bloom({ ...(o.glare ? GLARE.bloom : BLOOM), enabled: engine.tier !== 'low' }), { name: 'bloom', slot: 'hdr' });
}

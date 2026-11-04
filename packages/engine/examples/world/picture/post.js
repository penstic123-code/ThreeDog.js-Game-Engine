// @ts-check
// The glow on the sun, the lamp and bright water. Added but off on low-tier devices: it blurs the whole frame several times, and a slow machine needs that time for the world.
import { bloom } from '@threedog/post-effects';
import { BLOOM } from './palette.js';

/** @param {any} engine */
export function createPost(engine) {
  engine.post.add(bloom({ ...BLOOM, enabled: engine.tier !== 'low' }), { name: 'bloom', slot: 'hdr' });
}

// @ts-check
// The post route: one full-screen outline for the whole frame. Objects on OUTLINE_OFF_LAYER get no lines; the other columns use it.
import { outline, OUTLINE_OFF_LAYER } from '@threedog/post-effects';
import { LINE, OUTLINE } from './palette.js';

/** @param {any} engine */
export function createPost(engine) {
  engine.post.add(outline({ color: LINE, ...OUTLINE, offLayer: OUTLINE_OFF_LAYER }), { name: 'outline', slot: 'hdr' });
  return { offLayer: OUTLINE_OFF_LAYER };
}

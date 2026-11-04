// @ts-check
// The cascades and the one pass that adds their light to the frame. 'hdr' slot: the light is linear, so it goes in before the tone curve.
import { createRadianceCascades2D } from '../rc2d.js';
import { AMBIENT, LIGHT_LAYER } from './palette.js';

/** @param {any} engine @param {{ quality: any, cascades: number | 'auto', interval: number, apply: boolean }} o apply false: the frame stays as the scene's own light draws it */
export function createPost(engine, { apply, ...options }) {
  const rc = createRadianceCascades2D(engine, { layer: LIGHT_LAYER, ambient: AMBIENT, ...options });
  const handle = apply ? engine.post.add(rc.pass, { name: 'rc2d', slot: 'hdr' }) : null;
  return { rc, remove() { handle?.remove(); rc.dispose(); } };
}

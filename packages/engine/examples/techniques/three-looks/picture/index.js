// @ts-check
// The picture of the three-looks demo: wiring only. Each look is one file holding its own materials, lights, fog and post; none reads another's values.
import { cartoon } from './cartoon.js';
import { comic } from './comic.js';
import { cinematic } from './cinematic.js';

const LOOKS = { cartoon, comic, cinematic };

/** @param {any} engine @param {string} look  Returns { materials } by model part */
export function createPicture(engine, look) {
  const make = LOOKS[/** @type {keyof typeof LOOKS} */ (look)];
  if (!make) throw new Error(`three-looks: unknown look '${look}', use ${Object.keys(LOOKS).join(' | ')}`);
  return make(engine);
}

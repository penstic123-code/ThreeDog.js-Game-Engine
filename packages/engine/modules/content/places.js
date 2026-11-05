// Places in content: named positions (a pack's places file, the places option, level markers) and the position notation { place?, x?, z?, floor?, y? }.
// api is engine.content: where and offset read a place through api.place, so a wrapped place is the one they use.
import { placeY } from '../../core/scene/ground.js';
import { codedError } from '../../core/base/errorHints.js';

/** content.load: add the packs' places, then the places option on top. A text entry in a place file waits for the option */
export function addPlaces(places, packs, given) {
  const pl = {};
  for (const p of packs) for (const [name, at] of Object.entries(p.places ?? {})) if (at && typeof at === 'object') pl[name] = at;
  Object.assign(pl, given);
  for (const [name, p] of Object.entries(pl)) if (p?.rot !== undefined && !Number.isFinite(p.rot)) throw codedError('content-place', `Place "${name}": rot must be a number of radians about Y, got ${JSON.stringify(p.rot)}`);
  Object.assign(places, pl);
}

/** content.place */
export function placeOf(e, places, name) {
  const p = places[name] ?? e.level?.marker(name)?.position;
  return p ? { x: p.x, z: p.z, ...(p.y !== undefined && { y: p.y }), ...(p.rot !== undefined && { rot: p.rot }) } : null;
}

/** content.offset */
export function offsetFrom(api, place, x, z) {
  const base = place ? api.place(place) : null, dx = x - (base?.x ?? 0), dz = z - (base?.z ?? 0), c = Math.cos(base?.rot ?? 0), s = Math.sin(base?.rot ?? 0);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** content.where */
export function whereOf(e, api, p) {
  const base = p.place ? api.place(p.place) : null;
  if (p.place && !base) throw codedError('content-place', `Place "${p.place}" not found: give its coordinates in the places of content.load, or add this marker to the level`);
  const ox = p.x ?? 0, oz = p.z ?? 0, c = Math.cos(base?.rot ?? 0), s = Math.sin(base?.rot ?? 0);
  const x = (base?.x ?? 0) + ox * c + oz * s, z = (base?.z ?? 0) - ox * s + oz * c, floor = p.floor ?? base?.y;
  if (floor === undefined && p.y === undefined) return { x, z };
  return { x, y: placeY(e, `content.where(${JSON.stringify(p.place ?? { x: p.x, z: p.z })})`, x, z, floor) + (p.y ?? 0), z };
}

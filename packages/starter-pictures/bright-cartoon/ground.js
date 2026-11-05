// @ts-check
// Ground: one mesh from your own height function. pathAt() paints paths into a vertex value, and the patch field cuts that value into a clean, wobbling
// edge. Why not a texture: a mask stored per vertex costs nothing, stays sharp up close, and the game's level code already knows where the paths are.
// A sharper or thinner path needs more segments.
import { THREE } from 'threedog';
import { attribute, color, mix, positionLocal } from 'three/tsl';
import { blotch, celMaterial, cut, patches } from './paint.js';
import { palette } from './palette.js';

/**
 * @param {{ size?: number, segments?: number, heightAt?: (x: number, z: number) => number, pathAt?: (x: number, z: number) => number, waterLevel?: number }} [o]
 *   heightAt: meters. pathAt: 0 off the path .. 1 in its middle. waterLevel: sand starts here; leave it out on dry land
 * @returns {any} a THREE.Mesh, not yet in the scene
 */
export function createGround({ size = 120, segments = 240, heightAt = () => 0, pathAt = () => 0, waterLevel = -Infinity } = {}) {
  const G = palette.ground, geo = new THREE.PlaneGeometry(size, size, segments, segments).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, paint = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    paint[i] = pathAt(x, z);
  }
  geo.setAttribute('paint', new THREE.BufferAttribute(paint, 1));
  geo.computeVertexNormals();

  const p = positionLocal, wobble = blotch(p, 1.4).mul(0.22);
  const field = patches(G, p), flecked = mix(field, color(G.fleck), cut(blotch(p, G.fleckSize), G.fleckCover));
  const path = mix(color(G.path), color(G.pathPatch), cut(blotch(p, 1.1), 0.1));
  const onPath = cut(attribute('paint', 'float').add(wobble), G.pathEdge);
  let surface = mix(flecked, path, onPath);
  if (waterLevel > -Infinity) surface = mix(color(G.sand), surface, cut(p.y.add(wobble), waterLevel + G.sandHeight));

  const mesh = new THREE.Mesh(geo, celMaterial(surface));
  mesh.name = 'ground'; mesh.receiveShadow = true;
  return mesh;
}

// @ts-check
// Ground: one mesh from your own functions. bankAt() and lushAt() are stored per vertex, then the soft field blends them. Why not a texture: a mask per vertex costs
// nothing, and the game's level code already knows where the water is. A sharper bank needs more segments.
import { THREE } from 'threedog';
import { attribute, color, mix, positionWorld } from 'three/tsl';
import { drift, fade, field, softMaterial } from './paint.js';
import { palette } from './palette.js';

/**
 * @param {{ size?: number, segments?: number, heightAt?: (x: number, z: number) => number, bankAt?: (x: number, z: number) => number, lushAt?: (x: number, z: number) => number }} [o]
 *   heightAt: meters. bankAt: 0 away from water .. 1 at its edge. lushAt: 0 open grass .. 1 under a tree group.
 * @returns {any} a THREE.Mesh, not yet in the scene
 */
export function createGround({ size = 240, segments = 480, heightAt = () => 0, bankAt = () => 0, lushAt = () => 0 } = {}) {
  const P = palette, geo = new THREE.PlaneGeometry(size, size, segments, segments).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, bank = new Float32Array(pos.count), lush = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    bank[i] = bankAt(x, z); lush[i] = lushAt(x, z);
  }
  geo.setAttribute('bank', new THREE.BufferAttribute(bank, 1));
  geo.setAttribute('lush', new THREE.BufferAttribute(lush, 1));
  geo.computeVertexNormals();

  const p = positionWorld, G = P.grass;
  // the far color rides a much wider patch than the base pair: the meadow changes slowly across the map as well as locally
  const open = mix(field(G.base, G.drift, G.size), color(G.far), fade(drift(p, G.size * 3), 0.1, 0.2));
  const grass = mix(open, color(P.lush), attribute('lush', 'float').mul(0.75));
  // the wobble keeps the bank's edge from following the water line exactly
  const edge = fade(attribute('bank', 'float').add(drift(p, 3).mul(0.28)), 1 - P.bank.reach, 0.07);
  const surface = mix(grass, field(P.bank.base, P.bank.drift, 3), edge);

  const mesh = new THREE.Mesh(geo, softMaterial(mix(color(P.bed), surface, fade(p.y, 0.02, 0.05))));
  mesh.name = 'ground'; mesh.receiveShadow = true;
  return mesh;
}

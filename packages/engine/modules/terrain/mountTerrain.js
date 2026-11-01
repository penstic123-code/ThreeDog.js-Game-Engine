// Upload a generated terrain chunk (helper of ChunkManager.js): geometry from the worker's arrays, one mesh in a group at the chunk origin, added to the scene.
// `m` is the ChunkManager; c is the chunk record it keeps.
import * as THREE from 'three';
import { mountColorMap } from './terrainTexture.js';

export function mountTerrain(m, c, t) {
  const t0 = performance.now();   // measure: the 'build' stage of engine.budget.cost
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(t.nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(t.col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(t.uv, 2));
  let mat = t.tex ? mountColorMap(m, c, t.tex, c.cx * m.T.CHUNK, c.cz * m.T.CHUNK) : m.terrainMat;   // texture shading: a material with this chunk's color map
  if (t.top != null) {   // island chunk (terrain({ shape })): vertices are top, side, bottom
    const rest = t.pos.length / 3 - t.top;
    // the color map is sampled by world xz, so it would smear down the sides: sides and bottom keep vertex colors (or the game's material)
    if (rest && (t.tex || m.sideMat)) { g.addGroup(0, t.top, 0); g.addGroup(t.top, rest, 1); mat = [mat, m.sideMat ?? m.terrainMat]; }
    c.solidCount = t.solid;   // collision takes top and sides, not the bottom
    m.lowest = Math.min(m.lowest, t.minH);
  }
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  c.group = new THREE.Group();
  c.group.userData.budgetTag = 'terrain';
  c.group.position.set(c.cx * m.T.CHUNK, 0, c.cz * m.T.CHUNK);
  c.group.add(mesh); c.terrain = mesh;
  c.group.updateMatrixWorld(true);
  c.sphere = new THREE.Sphere(new THREE.Vector3(t.sphere[0], t.sphere[1], t.sphere[2]), t.sphere[3]);
  c.state = 'ready';
  m.engine.scene.add(c.group);
  m.engine.budget.cost.end('build', t0);
}

// Upload a generated terrain chunk (helper of ChunkManager.js): geometry from the worker's arrays, one mesh in a group at the chunk origin, added to the scene.
// `m` is the ChunkManager; c is the chunk record it keeps.
import * as THREE from 'three';

export function mountTerrain(m, c, t) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(t.nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(t.col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(t.uv, 2));
  const mesh = new THREE.Mesh(g, m.terrainMat);
  mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  c.group = new THREE.Group();
  c.group.userData.budgetTag = 'terrain';
  c.group.position.set(c.cx * m.T.CHUNK, 0, c.cz * m.T.CHUNK);
  c.group.add(mesh); c.terrain = mesh;
  c.group.updateMatrixWorld(true);
  c.sphere = new THREE.Sphere(new THREE.Vector3(t.sphere[0], t.sphere[1], t.sphere[2]), t.sphere[3]);
  c.state = 'ready';
  m.engine.scene.add(c.group);
}

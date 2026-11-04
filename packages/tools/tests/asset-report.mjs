// Import report: engine.assets.report logic (core/assetReport.js) on a scene built with three in node.
// Guards: normal map lost / material replaced by a style role / clip lost / unmapped clip are flagged, wrong color spaces are flagged, output color space is checked.
import * as THREE from 'three';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';

const { reportGltf, reportText } = await import(pathToFileURL(join(ENGINE, 'core/assetReport.js')).href);

export const name = 'assets report: lost normal maps, replaced materials, clips, color spaces';

export async function run({ check }) {
  const tex = cs => { const t = new THREE.Texture(); t.colorSpace = cs; return t; };
  const mesh = (mat, n = 'part') => { const m = new THREE.Mesh(new THREE.BufferGeometry(), mat); m.name = n; return m; };
  const scene = new THREE.Group();
  const good = new THREE.MeshStandardMaterial({ name: 'wood', map: tex(THREE.SRGBColorSpace), normalMap: tex(THREE.NoColorSpace) });
  const stripped = new THREE.MeshStandardMaterial({ name: 'stone', map: tex(THREE.SRGBColorSpace) });   // the file has a normal map, the scene does not
  const styled = new THREE.MeshStandardMaterial({ name: 'cloth' }); styled.userData.purpose = 'cloth';
  scene.add(mesh(good), mesh(stripped), mesh(styled), mesh(good, 'col_wall'));
  const json = { materials: [{ name: 'wood', normalTexture: {}, pbrMetallicRoughness: { baseColorTexture: {} } }, { name: 'stone', normalTexture: {} }, { name: 'cloth' }, { name: 'gone' }],
    animations: [{ name: 'Idle' }, { name: 'Slash' }], nodes: [{ name: 'part' }, { name: 'col_wall' }, { name: 'missing node' }] };
  const gltf = { scene, animations: [new THREE.AnimationClip('Idle', 1, [])], parser: { json } };
  const r = reportGltf(gltf, { name: 'hero', opts: { animation: { states: { attack: { clip: 'Slash' }, walk: { clip: 'Walk' } } } } });
  const codes = r.issues.map(i => i.code);
  for (const c of ['normal-map-lost', 'material-replaced', 'clip-lost', 'clip-unmapped', 'node-lost']) check(`flags ${c}`, codes.includes(c));
  check(`counts ${JSON.stringify(r.counts)}`, r.counts.normalMaps === 1 && r.counts.colliders === 1 && r.counts.clips === 1);
  check('good textures raise no color-space issue', !codes.includes('color-space'));
  check('an intact normal map (NoColorSpace is the empty string) is not called lost', !r.issues.some(i => i.code === 'normal-map-lost' && /"wood"/.test(i.msg)), JSON.stringify(r.issues.map(i => i.msg)));
  check('text lists issues', reportText(r).includes('normal-map-lost'));
  const bad = new THREE.Group(); bad.add(mesh(new THREE.MeshStandardMaterial({ name: 'bad', map: tex(THREE.NoColorSpace), roughnessMap: tex(THREE.SRGBColorSpace) })));
  const b = reportGltf({ scene: bad, animations: [] }, { name: 'bad' }, undefined, { outputColorSpace: 'display-p3' });
  check('color map without srgb and data map with srgb are both flagged', b.issues.filter(i => i.code === 'color-space').length === 2);
  check('renderer output color space other than srgb is flagged', b.issues.some(i => i.code === 'output-color-space'));
  check('a model without file JSON says nothing about the file', !b.fromFile);
}

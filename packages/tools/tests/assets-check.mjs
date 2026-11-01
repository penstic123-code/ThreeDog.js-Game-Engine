// Asset check without a browser: GLBs built in code with glTF Transform go through the real read path (file on disk -> NodeIO -> manifest / review).
// Guards: marker counts of the level manifest, missing template, duplicate record id, content-check reading the glb (fromLevel trigger, places, template),
// color-space mix-ups (data texture in a color slot, one texture in both), BLEND hints, texture without UV, oversized texture.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { ROOT } from '../paths.mjs';
import { checkModel } from '../assets-check/cli.mjs';
import { checkGame } from '../content-check.mjs';

export const name = 'assets check: level manifest, material review (glb built in code)';

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
/** A PNG header that only claims a size (enough for the size reader; never decoded) */
const bigPng = w => { const b = Buffer.alloc(33); PNG_1PX.copy(b, 0, 0, 33); b.writeUInt32BE(w, 16); b.writeUInt32BE(w, 20); return b; };

export async function run({ check }) {
  const { Document, NodeIO } = createRequire(resolve(ROOT, 'package.json'))('@gltf-transform/core');
  const dir = mkdtempSync(join(tmpdir(), 'threedog-assets-'));
  try {
    const doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene();
    const tri = () => doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buf)));
    const node = (n, extras, parent = scene, mesh) => { const o = doc.createNode(n).setTranslation([1, 2, 3]); if (extras) o.setExtras(extras); if (mesh) o.setMesh(mesh); parent.addChild(o); return o; };
    node('spawn'); node('spawn_2');
    node('col_wall', null, scene, tri()); node('col_box', null, scene, tri()); node('crate', { collider: true }, scene, tri());
    node('col_empty');
    node('trigger_gate', { shape: 'box', radius: 2 }); node('npc_shop'); node('marker_chest');
    node('door_front', { template: 'door' }); node('door_back', { template: 'door' }); node('well', { template: 'well' }); node('rock', { id: true });
    node('rock', { id: true });   // same record id town/rock twice
    // materials: data texture in a color slot / one texture in two kinds of slot / BLEND / texture on a mesh without UV / huge texture
    const tex = (n, bytes = PNG_1PX) => doc.createTexture(n).setImage(new Uint8Array(bytes)).setMimeType('image/png');
    const mats = {
      wrongSlot: doc.createMaterial('wrongSlot').setBaseColorTexture(tex('rock_normal.png')),
      shared: (() => { const t = tex('mix.png'); return doc.createMaterial('shared').setBaseColorTexture(t).setNormalTexture(t); })(),
      glass: doc.createMaterial('glass').setAlphaMode('BLEND').setBaseColorFactor([1, 1, 1, 0.4]),
      pointless: doc.createMaterial('pointless').setAlphaMode('BLEND'),
      leaves: doc.createMaterial('leaves_fence').setAlphaMode('BLEND').setBaseColorTexture(tex('leaf_albedo.png')),
      big: doc.createMaterial('big').setBaseColorTexture(tex('huge_albedo.png', bigPng(4096))),
      fine: doc.createMaterial('fine').setBaseColorTexture(tex('wood_albedo.png')).setNormalTexture(tex('wood_normal.png')),
    };
    const withUv = tri(); withUv.listPrimitives()[0].setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(6)).setBuffer(buf));
    withUv.listPrimitives()[0].setMaterial(mats.fine);
    node('good_mesh', null, scene, withUv);
    const noUv = tri(); noUv.setName('noUvMesh').listPrimitives()[0].setMaterial(mats.big);
    node('big_mesh', null, scene, noUv);
    for (const m of ['wrongSlot', 'shared', 'glass', 'pointless', 'leaves']) { const mesh = tri(); mesh.listPrimitives()[0].setMaterial(mats[m]); node('m_' + m, null, scene, mesh); }

    const file = join(dir, 'art/models/town.glb');
    mkdirSync(join(dir, 'art/models'), { recursive: true });
    await new NodeIO().write(file, doc);

    const r = await checkModel(file, { templates: { door: { model: 'x' } } });
    const L = r.level, has = (list, code, re) => list.some(i => i.code === code && (!re || re.test(i.msg + (i.where || ''))));
    check('manifest counts: 2 spawns, 4 colliders (col_ x3 + collider property), 1 trigger, 1 npc, 1 marker', L.counts.spawns === 2 && L.counts.colliders === 4 && L.counts.triggers === 1 && L.counts.npcs === 1 && L.counts.markers === 1, JSON.stringify(L.counts));
    check('trigger parameters come from the custom properties', L.triggers[0].tag === 'gate' && L.triggers[0].shape === 'box' && L.triggers[0].radius === 2, JSON.stringify(L.triggers[0]));
    check('templates counted: door x2, well x1', L.templates.door === 2 && L.templates.well === 1, JSON.stringify(L.templates));
    check('template missing from content/templates.js is an error', has(L.issues, 'missing-template', /town\/well/) && !has(L.issues, 'missing-template', /door_\w+ uses/));
    check('duplicate record id is an error', has(L.issues, 'duplicate-id', /town\/rock/));
    check('collider without a mesh warns', has(L.issues, 'empty-collider', /col_empty/));
    check('model statistics: 7 materials, PNG textures', r.stats.materials === 7 && r.stats.textures.formats.join() === 'PNG', JSON.stringify(r.stats.textures.formats));
    const M = r.materials;
    check('data texture in a color slot is flagged', has(M, 'data-in-color-slot', /rock_normal/));
    check('one texture in a color slot and a data slot is flagged', has(M, 'shared-color-and-data', /shared/));
    check('correct slots are not flagged', !M.some(i => /fine/.test(i.where)));
    check('BLEND hint: translucent glass is info, opaque BLEND warns, foliage suggests MASK', M.some(i => i.code === 'blend' && /glass/.test(i.where) && i.severity === 'info') && has(M, 'blend-opaque', /pointless/) && has(M, 'blend', /MASK/));
    check('texture on a mesh without UV is flagged', has(M, 'texture-without-uv', /noUvMesh/));
    check('4096 px texture is flagged as large', has(M, 'big-texture', /huge_albedo/));

    // content-check reads the same glb: no places.js description for markers, fromLevel trigger checked against the file
    mkdirSync(join(dir, 'content'));
    writeFileSync(join(dir, 'main.js'), "import { level } from 'threedog'; level({ url: '/models/town.glb' });\n");
    writeFileSync(join(dir, 'content/templates.js'), "export default { door: { model: 'door' } };\n");
    writeFileSync(join(dir, 'content/triggers.js'), "export default { gate: { fromLevel: true, onEnter: {} }, lost: { fromLevel: true, onEnter: {} } };\n");
    writeFileSync(join(dir, 'content/pickups.js'), "export default [{ item: 'bread', place: 'marker_chest' }];\n");
    const g = await checkGame(dir), text = g.errors.join('\n');
    check('content-check: glb marker is a valid place (no description file)', !/marker_chest/.test(text), text);
    check('content-check: fromLevel trigger with no node in the glb is an error, one with a node is fine', /trigger zone lost/.test(text) && !/trigger zone gate/.test(text), text);
    check('content-check: template named in the glb but undefined is an error', /town\/well.*template "well"/.test(text), text);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

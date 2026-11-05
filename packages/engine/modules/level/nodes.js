// Level nodes that become world records: nodes tagged with the custom property template or id (Blender -> glTF extras -> userData) leave the level root
// and are placed as authored records `<level>/<node>` once the level is processed. Created per level module by levelNodes(e, getRoot, getCurrent).
import * as THREE from 'three';
import { warnOnce, fmt } from '../../core/base/validate.js';
import { codedError } from '../../core/base/errorHints.js';

const STRINGS_DEV = {
  noWorld: '[level] nodes with the custom property template or id become world records: install world() (the openWorld() preset has it); until then they stay in the level as plain scenery (ground, collision, rays like any node)',
  noContent: 'level node {id} has the custom property template: install content() and define the template in content/templates.js',
  clash: 'level node id "{id}" is already used by other data (kind {kind}): rename the node in Blender',
  notLoaded: 'level node {id}: its level is not loaded (a record of another level is built only on that level)',
};

export const MARKER_RE = /^(spawn|spawn_.*|npc_.*|trigger_.*|marker_.*)$/i;

/** @param {any} e engine  @param {() => any} getRoot current level root  @param {() => string | null} getCurrent current level path / name */
export function levelNodes(e, getRoot, getCurrent) {
  const taken = [], nodes = new Map();   // record nodes waiting to be placed; record id -> node object (levelNode records)
  let presented = null;
  /**
   * Nodes tagged with the custom property template or id (Blender custom property -> glTF extras -> userData): taken out of the level root, world transform
   * kept
   */
  function take(root) {
    taken.length = 0;
    const walk = o => {
      for (const c of [...o.children]) {
        if ((c.userData?.template == null && c.userData?.id == null) || MARKER_RE.test(c.name)) { walk(c); continue; }
        // without world() there is nowhere to put the record: leave the node as part of the level (a game that never uses records still sees its
        // whole scene) and say how to turn it into a record, instead of removing it and dropping it later
        if (!e.world) { warnOnce(STRINGS_DEV.noWorld); continue; }
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        c.matrixWorld.decompose(p, q, s);
        c.removeFromParent(); c.position.copy(p); c.quaternion.copy(q); c.scale.copy(s);
        c.userData.hlod = false;   // its model comes and goes with the record: never part of a merged far proxy
        taken.push(c);
      }
    };
    walk(root);
  }
  /** The name in node ids `<level>/<node>`: the level file name without folders and extension; a code-built scene uses its root name */
  const levelName = () => {
    const current = getCurrent();
    if (!current) return getRoot()?.name || 'level';
    const f = String(current), base = f.slice(Math.max(f.lastIndexOf('/'), f.lastIndexOf('\\')) + 1), dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
  };
  const OWN = ['template', 'id', 'name', 'hlod'];   // userData keys that are not record fields (three's glTF loader keeps the node name in userData.name)
  /** Taken nodes -> authored world records, id `<level>/<node>`: a template instance (custom property template) or the node itself (custom property id) */
  function place() {
    if (!taken.length) return;   // also without world(): take left the nodes in the level
    const level = levelName(), zone = e.world.zone;
    for (const o of taken.splice(0)) {
      const id = `${level}/${o.name}`, ud = o.userData, node = o.name, { x, y, z } = o.position;
      const fields = Object.fromEntries(Object.entries(ud).filter(([k, v]) => !OWN.includes(k) && (v == null || typeof v !== 'object' || Array.isArray(v) || v.constructor === Object)));
      if (ud.template != null) {
        if (!e.content) throw codedError('level-node', fmt(STRINGS_DEV.noContent, { id }));
        const yaw = new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ').y, state = Object.keys(e.content.template(ud.template).state ?? {});
        const own = Object.fromEntries(Object.entries(fields).filter(([k]) => state.includes(k)));
        e.content.placeNode({ template: ud.template, id, x, z, floor: y, ...(yaw && { rot: yaw }), ...(o.scale.x !== 1 && { scale: o.scale.x }), ...own }, zone, { level, node });
      } else {
        presentNodes();
        nodes.set(id, o);
        const rec = e.world.add({ ...fields, id, kind: 'levelNode', position: { x, y, z }, ...(zone != null && { zone }), level, node }, { initial: true });
        if (rec && rec.kind !== 'levelNode') throw codedError('level-node', fmt(STRINGS_DEV.clash, { id, kind: rec.kind }));
      }
      e.world.setOrigin(id, { level, node });
    }
  }
  /** How a level node record looks: the node itself (detached while far or on another level, rebuilt from the same object) */
  function presentNodes() {
    if (presented) return;
    presented = e.world.present('levelNode', {
      build(rec) {
        const o = nodes.get(rec.id);
        if (!o) throw codedError('level-node', fmt(STRINGS_DEV.notLoaded, { id: rec.id }));
        o.userData.unstatic = e.rays.addStatic(o);
        return o;
      },
      dispose(rec, o) { o.userData.unstatic?.remove(); e.detach(o); },
    });
  }
  return { take, place };
}

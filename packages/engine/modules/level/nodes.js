// Level nodes that become world records: nodes tagged with the custom property template or id (Blender -> glTF extras -> userData) leave the level root
// and are placed as authored records `<level>/<node>` once the level is processed. Created per level module by levelNodes(e, ctx, getRoot, getCurrent).
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

/** @param {any} e engine  @param {any} ctx the level module's ctx  @param {() => any} getRoot current level root  @param {() => string | null} getCurrent current level path / name */
export function levelNodes(e, ctx, getRoot, getCurrent) {
  const nodes = new Map();   // record id -> node object (levelNode records)
  const homes = new WeakMap();   // taken node -> the parent it left
  let presented = null;
  /**
   * Nodes tagged with the custom property template or id (Blender custom property -> glTF extras -> userData): taken out of the level root, world transform
   * kept. Returns them: the level being prepared holds its own list, the live one is untouched
   */
  function take(root) {
    const taken = [];
    const walk = o => {
      for (const c of [...o.children]) {
        if ((c.userData?.template == null && c.userData?.id == null) || MARKER_RE.test(c.name)) { walk(c); continue; }
        // without world() there is nowhere to put the record: leave the node as part of the level (a game that never uses records still sees its
        // whole scene) and say how to turn it into a record, instead of removing it and dropping it later
        if (!e.world) { warnOnce(STRINGS_DEV.noWorld); continue; }
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        c.matrixWorld.decompose(p, q, s);
        homes.set(c, c.parent);
        c.removeFromParent(); c.position.copy(p); c.quaternion.copy(q); c.scale.copy(s);
        c.userData.hlod = false;   // its model comes and goes with the record: never part of a merged far proxy
        taken.push(c);
      }
    };
    walk(root);
    return taken;
  }
  /** Undo take, for a code-built scene that will not become the level: it is the caller's, and may be loaded again */
  const giveBack = taken => { for (const o of taken) homes.get(o).attach(o); };
  /** The name in node ids `<level>/<node>`: the level file name without folders and extension; a code-built scene uses its root name */
  const levelName = (current, root) => {
    if (!current) return root?.name || 'level';
    const f = String(current), base = f.slice(Math.max(f.lastIndexOf('/'), f.lastIndexOf('\\')) + 1), dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
  };
  const OWN = ['template', 'id', 'name', 'hlod'];   // userData keys that are not record fields (three's glTF loader keeps the node name in userData.name)
  /** What place would refuse, asked before the commit so a level that cannot place its records never replaces the old one */
  function check(taken, current, root) {
    const level = levelName(current, root);
    for (const o of taken) {
      const id = `${level}/${o.name}`, tpl = o.userData.template;
      if (tpl != null) {
        if (!e.content) throw codedError('level-node', fmt(STRINGS_DEV.noContent, { id }));
        e.content.template(tpl);   // throws, naming the templates there are
      } else {
        const kind = e.world.get(id)?.kind;
        if (kind && kind !== 'levelNode') throw codedError('level-node', fmt(STRINGS_DEV.clash, { id, kind }));
      }
    }
  }
  /** Taken nodes -> authored world records, id `<level>/<node>`: a template instance (custom property template) or the node itself (custom property id) */
  function place(taken) {
    if (!taken.length) return;   // also without world(): take left the nodes in the level
    const level = levelName(getCurrent(), getRoot()), zone = e.world.zone;
    for (const o of taken) {
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
    presented = ctx.track(e.world.present('levelNode', {
      build(rec) {
        const o = nodes.get(rec.id);
        if (!o) throw codedError('level-node', fmt(STRINGS_DEV.notLoaded, { id: rec.id }));
        o.userData.unstatic = e.rays.addStatic(o);
        return o;
      },
      dispose(rec, o) { o.userData.unstatic?.remove(); o.removeFromParent(); },
    }));
  }
  return { take, giveBack, check, place };
}

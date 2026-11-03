// Placement preview (engine.grids.preview): picks the target cell every frame (under the pointer, in front of the player, or from
// your function), keeps a rotation turned by an input action, asks can(), and shows a see-through footprint
// (style.grid.ok / bad colors). It never changes gameplay state: place() runs the grid.place op with what it shows.
// The look is a replaceable part: look: false (no visual, the handle still answers), or (engine) => ({ update(view), hide(), dispose() }).
import * as THREE from 'three';
import { makeMaterial } from '../../render/materials.js';
import { screenToGround } from '../../core/screenToGround.js';
import { warnOnce } from '../../core/validate.js';
import { failure } from '../../core/opsFail.js';

// tool colors, not art: neutral defaults that still tell the two apart (light = can place, dark = cannot); a style may override them
const OK = 0xe0e0e0, BAD = 0x3a3a3a;
const NO_KEY = 'grids.preview(): the action "{a}" has no keys, so the preview cannot be turned by input. Bind it (engine.input.bind("{a}", ["KeyR"]) or presets.bindings.gridRotate), or pass rotate: false and call pv.rotate() from your own control';

/** Default look: a flat translucent box over the footprint @internal */
function boxLook(e) {
  const st = e.style.grid ?? {}, opacity = st.previewOpacity ?? 0.45;
  const mat = makeMaterial('decal', { transparent: true, opacity, depthWrite: false }, e);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  mesh.name = 'grid:preview'; mesh.visible = false; mesh.renderOrder = 2;
  e.add(mesh, { owner: 'engine:grid' });
  const ok = new THREE.Color(st.ok ?? OK), bad = new THREE.Color(st.bad ?? BAD), h = st.previewHeight ?? 0.08;
  return {
    update(v) {
      mesh.visible = true;
      mesh.scale.set(v.size[0] - 0.04, h, v.size[1] - 0.04);
      mesh.position.set(v.center.x, v.center.y + h / 2, v.center.z);
      mat.color.copy(v.ok ? ok : bad);
    },
    hide() { mesh.visible = false; },
    dispose() { e.remove(mesh); mesh.geometry.dispose(); mat.dispose(); },
  };
}

/** Where the target is this frame (world position) or null @internal */
function target(e, from, g) {
  if (typeof from === 'function') return from(e);
  if (from === 'front') {
    const p = e.actorPosition(); if (!p) return null;   // whoever the user controls (engine.actor)
    const body = e.actor === 'player' ? e.player : null, f = body?.facing ?? e.world?.get(e.actor)?.facing ?? 0, d = g.cell;
    return { x: p.x + Math.sin(f) * d, z: p.z + Math.cos(f) * d };
  }
  const ptr = e.input.pointer;
  return screenToGround(e, ptr.ndcX, ptr.ndcY);
}

/** Create a preview handle @internal */
export function makePreview(e, grids, opts) {
  const { grid, item, from = 'pointer', rotate = 'rotate', look } = opts;
  const g = grids._must(grid), rule = grids._rule(item);
  // declared by the preview, owned by the grid module and taken away with the preview (or the module), so nothing outlives it; the game binds
  // the key (presets.bindings.gridRotate) like every module action
  const decl = rotate ? e.input.action(rotate, { label: 'grid.rotate', owner: 'grids', optional: true }) : null;
  if (rotate && !e.input.keysOf(rotate).length) warnOnce(NO_KEY.replaceAll('{a}', rotate));
  const part = look === false ? null : typeof look === 'function' ? look(e) : boxLook(e);
  const h = {
    /** target cell or null (nothing under the pointer) */ cell: null,
    rotation: opts.rotation ?? 0,
    /** why it cannot be placed: 'noTarget' or the grid.can() code; null when ok */ ok: false, code: 'noTarget',
    /** Turn by quarter turns (the rotate action does this too) */
    rotate(n = 1) { h.rotation = (((h.rotation + n) % 4) + 4) % 4; },
    /** Run grid.place with the shown cell and rotation; returns the op result */
    place(fields) {
      if (!h.cell) return failure('noTarget');
      return e.ops.run('grid.place', { grid, item, cell: h.cell, rotation: h.rotation, ...(fields ? { fields } : {}) });
    },
    /** Remove the preview (cancel convention: safe to call again) */
    remove() { grids._previews.delete(h); decl?.remove(); part?.dispose?.(); },
    /** @internal */
    frame() {
      if (rotate && e.input.pressed(rotate)) h.rotate(1);
      const p = target(e, from, g);
      h.cell = p ? g.toCell(p) : null;
      if (!h.cell) { h.ok = false; h.code = 'noTarget'; part?.hide?.(); return; }
      const r = g.can(item, h.cell, { rotation: h.rotation });
      h.ok = r === true; h.code = r === true ? null : r;
      const [w, d] = h.rotation & 1 ? [rule.size[1], rule.size[0]] : rule.size;
      part?.update?.({ grid, item, cell: h.cell, rotation: h.rotation, cells: g.footprint(h.cell, rule.size, h.rotation),
        center: g.toWorld(h.cell, rule.size, h.rotation), size: [w * g.cell, d * g.cell], ok: h.ok, code: h.code });
    },
  };
  grids._previews.add(h);
  return h;
}

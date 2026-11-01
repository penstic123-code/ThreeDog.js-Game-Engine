// Crisp per-cell tiles for a layer (tilled soil, wet soil, a painted floor): one mesh per layer, each non-empty cell a quad
// whose four corners sit on engine.surface + lift, so tiles hug a ramp or terrain and work on any ground provider
// (procedural terrain, a Blender level, a flat greenhouse floor). One merged mesh = one draw call; it is rebuilt only when
// the layer version or the ground (level:loaded) changes.
// Look: layer option tiles.look(data, cell) -> color | null, else tiles.colors = { field: color } (call site, same shape as the style table), else the style pack table style.grid.tiles[layer] = { field: color }
// (first truthy field in the table's order wins), else neutral gray. tiles: false = off; a function = your own part.
import * as THREE from 'three';
import { makeMaterial } from '../../render/materials.js';
import { surfaceOr } from '../../core/ground.js';

const GAP = 0.03;   // fraction of a cell left between tiles: keeps tiles visibly separate (crisp edges)
const FALLBACK = 0x9a9a9a;

/** Look function from a { field: color } table: the first truthy field in the table's order wins (same table shape as style.grid.tiles[layer]; the call-site option tiles.colors wins over the style) @internal */
function tableLook(table) {
  if (!table) return null;
  const order = Object.entries(table);
  return d => { for (const [f, c] of order) if (d[f]) return c; return null; };
}

/** Look function from the style pack table (null if the style has none for this layer) @internal */
function styleLook(e, name) {
  return tableLook(e.style.grid?.tiles?.[name]);
}

/** Build the tile view of a layer, or null when off. Returns { frame(), dispose() } @internal */
export function layerTiles(e, layer) {
  const t = layer.opts.tiles, name = layer.name;
  if (t === false) return null;
  if (typeof t === 'function') return customTiles(e, layer, t(e, layer));
  const look = (t && typeof t === 'object' && (t.look || tableLook(t.colors))) || styleLook(e, name) || (t ? () => FALLBACK : null);
  if (!look) return null;   // no style table and not asked for: a pure data layer
  const lift = (t && typeof t === 'object' && t.lift) ?? e.style.grid?.tileLift ?? 0.03;
  const mat = makeMaterial('decal', { vertexColors: true }, e);
  // drawn over the ground it lies on: depth offset instead of a big lift keeps it glued to slopes
  mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
  const geo = new THREE.BufferGeometry(), mesh = new THREE.Mesh(geo, mat);
  mesh.name = `grid:${layer.grid.name}.${name}`; mesh.receiveShadow = true; mesh.frustumCulled = false;
  e.add(mesh, { owner: 'engine:grid' });
  let ver = -1, ground = 0, built = -1;
  const off = e.events.on('level:loaded', () => { ground++; });   // a new level = new ground heights
  const col = new THREE.Color(), g = layer.grid;
  function rebuild() {
    const cells = layer.query(), pos = [], clr = [], idx = [];
    let last = 0;   // height of the previous corner: a corner beyond the island borrows it instead of -Infinity
    for (const { cell, data } of cells) {
      const c = look(data, cell);
      if (c == null) continue;
      col.set(c);
      const x0 = g.origin.x + (cell[0] + GAP) * g.cell, z0 = g.origin.z + (cell[1] + GAP) * g.cell, s = g.cell * (1 - 2 * GAP), n = pos.length / 3;
      for (const [x, z] of [[x0, z0], [x0, z0 + s], [x0 + s, z0 + s], [x0 + s, z0]]) { pos.push(x, (last = surfaceOr(e, x, z, undefined, last)) + lift, z); clr.push(col.r, col.g, col.b); }
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    }
    geo.dispose();   // frees the old GPU buffers now (new attributes are uploaded on the next draw) instead of leaving them to GC
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    mesh.userData.tiles = idx.length / 6;
  }
  return {
    mesh,
    frame() {
      mesh.visible = g.zone == null || e.world?.zone == null || e.world.zone === g.zone;
      if (layer._ver !== ver || ground !== built) { ver = layer._ver; built = ground; rebuild(); }
    },
    dispose() { off.remove(); e.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}

/** A game-made tile part: called with the cell list whenever the layer changes @internal */
function customTiles(e, layer, part) {
  let ver = -1;
  return {
    mesh: null,
    frame() { if (layer._ver !== ver) { ver = layer._ver; part?.update?.(layer.query()); } },
    dispose() { part?.dispose?.(); },
  };
}

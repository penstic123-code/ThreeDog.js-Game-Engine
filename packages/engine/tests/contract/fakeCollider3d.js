// A three-axis collision provider without Rapier: the proof that rigid/collider3d.contract.js is all a caller needs. Balls only: a box counts as the ball around it,
// and a sweep walks in small steps. Enough for a contract, not for a game.
const at = p => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function fakeCollider3d() {
  const solids = new Set();
  const inside = (p, r) => [...solids].find(s => dist(p, s.c) < s.r + r) ?? null;
  return {
    addSolid({ position, size, radius }) {
      const s = { c: at(position), r: radius ?? Math.hypot(...size) / 2, remove() { solids.delete(s); } };
      solids.add(s);
      return s;
    },
    overlap: (position, radius = 0.01) => !!inside(at(position), radius),
    sweep(from, to, radius = 0.01) {
      const a = at(from), b = at(to), len = dist(a, b), n = Math.max(1, Math.ceil(len / 0.05));
      for (let i = 0; i <= n; i++) {
        const k = i / n, point = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k }, s = inside(point, radius);
        if (!s) continue;
        const d = dist(point, s.c) || 1;
        return { point, normal: { x: (point.x - s.c.x) / d, y: (point.y - s.c.y) / d, z: (point.z - s.c.z) / d }, distance: len * k };
      }
      return null;
    },
  };
}

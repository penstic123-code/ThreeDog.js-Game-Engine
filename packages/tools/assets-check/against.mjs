// threedog assets check new.glb --against old.glb: what the new export lost or moved compared with the old one (the model a game already uses).
// Compares the names the game depends on: col_ colliders, template / id nodes, spawn / trigger_ / npc_ / marker_ points, clips, and the bounding box.
const BOX_TOL = 0.15;   // relative size change that is reported (15 %)

/** @param {{ level: any, report: any }} next @param {{ level: any, report: any }} old @returns {{ severity: 'error' | 'warn', code: string, msg: string }[]} */
export function compareModels(next, old) {
  const out = [], add = (severity, code, msg) => out.push({ severity, code, msg });
  const gone = (kind, a, b, severity = 'error') => {
    const have = new Set(b), miss = [...new Set(a)].filter(n => !have.has(n));
    if (miss.length) add(severity, 'missing-' + kind.replace(/[\W_]/g, '-'), `${kind} missing in the new file: ${miss.join(', ')} (the old file has ${miss.length > 1 ? 'them' : 'it'}; the game may refer to ${miss.length > 1 ? 'them' : 'it'})`);
  };
  gone('col_ collider', old.report.colliders, next.report.colliders);
  gone('template/id node', old.level.records.map(r => r.node), next.level.records.map(r => r.node));
  for (const k of ['spawns', 'triggers', 'npcs', 'markers']) gone(k.replace(/s$/, '') + ' point', old.level[k].map(p => p.name), next.level[k].map(p => p.name));
  gone('animation clip', old.report.clips.map(c => c.name), next.report.clips.map(c => c.name), 'warn');
  gone('material', old.report.materials.map(m => m.name), next.report.materials.map(m => m.name), 'warn');
  const moved = [];
  for (const k of ['spawns', 'triggers', 'npcs', 'markers', 'records']) for (const o of old.level[k]) {
    const n = next.level[k].find(p => (p.name ?? p.node) === (o.name ?? o.node));
    if (n && n.position.some((v, i) => Math.abs(v - o.position[i]) > 0.5)) moved.push(`${o.name ?? o.node} ${o.position} -> ${n.position}`);
  }
  if (moved.length) add('warn', 'moved-point', `points moved by more than 0.5 m: ${moved.slice(0, 6).join('; ')}${moved.length > 6 ? '; ...' : ''}`);
  const a = old.report.bounds, b = next.report.bounds;
  if (a && b) {
    const size = x => x[1].map((v, i) => v - x[0][i]), sa = size(a), sb = size(b);
    const off = sa.map((v, i) => (v > 0.01 && Math.abs(sb[i] - v) / v > BOX_TOL ? `${'xyz'[i]} ${v.toFixed(2)} -> ${sb[i].toFixed(2)} m` : null)).filter(Boolean);
    if (off.length) add('warn', 'size-changed', `bounding box size changed by more than ${BOX_TOL * 100}%: ${off.join(', ')} (scale or unit mix-up? 1 unit = 1 m)`);
  } else if (a && !b) add('warn', 'no-geometry', 'the new file has no mesh bounds');
  return out;
}

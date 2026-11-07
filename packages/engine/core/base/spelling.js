// Spelling helpers with no imports: "did you mean" in the engine's runtime checks (validate.js) and in the tools (packages/tools/lib/text.mjs),
// and the node-name rule that the asset report and `threedog assets check` both apply. One copy each; a change here changes both.

/** Edit distance (case-insensitive; swapping two adjacent letters counts as 1, e.g. jupm -> jump) */
export function distance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

/**
 * The entry of list closest to name; null if too far. Without maxDist the limit scales with length (longer names tolerate more errors).
 * Too far by spelling, a name of 4+ letters that is part of exactly one entry still matches ('forward' -> 'moveForward'): AIs often drop a prefix.
 */
export function closest(name, list, maxDist) {
  name = String(name);
  const limit = maxDist ?? (name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3);
  let best = null, bd = Infinity;
  for (const c of list) { if (c === name) continue; const d = distance(name, String(c)); if (d < bd) { bd = d; best = c; } }
  if (bd <= limit) return best;
  if (maxDist != null || name.length < 4) return null;
  const low = name.toLowerCase(), part = [...list].filter(c => String(c).toLowerCase().includes(low));
  return part.length === 1 ? part[0] : null;
}

/** three's PropertyBinding.sanitizeNodeName: the name the engine sees ("door.001" -> "door001", spaces -> "_") */
export const sanitize = n => String(n ?? '').replace(/\s/g, '_').replace(/[[\].:/]/g, '');

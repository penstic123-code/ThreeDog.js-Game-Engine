// Does a version range in a package.json accept a version? Only the forms the repository uses: *, ^x.y.z and ~x.y.z (an unknown form gives null, so a
// new form cannot slip past the version-pins test or doctor). Shared by doctor (games' pins) and tests/version-pins.mjs.
export function accepts(range, version) {
  if (range === '*') return true;
  const m = /^([\^~])(\d+)\.(\d+)\.(\d+)$/.exec(range), v = version.split('.').map(Number);
  if (!m) return null;
  const [, op, ...r] = m, [a, b, c] = r.map(Number);
  const atLeast = v[0] > a || (v[0] === a && (v[1] > b || (v[1] === b && v[2] >= c)));
  // ^ on 0.x keeps the minor (npm semver), on >=1 keeps the major; ~ always keeps the minor
  const same = op === '^' && a > 0 ? v[0] === a : v[0] === a && v[1] === b;
  return atLeast && same;
}

/** The threedog / @threedog/* entries of a package.json whose range does not accept the current version (a form this file cannot read, such as file:, is left alone): [[section, name, range, version]]. current(name) → version or null */
export function stalePins(pkg, current) {
  const out = [];
  for (const n of ['dependencies', 'devDependencies']) for (const [dep, range] of Object.entries(pkg[n] ?? {})) {
    const v = (dep === 'threedog' || dep.startsWith('@threedog/')) && current(dep);
    if (v && accepts(range, v) === false) out.push([n, dep, range, v]);
  }
  return out;
}

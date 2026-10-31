// Detection: R31 one small helper, one copy. Flags a top-level one-line arrow helper (const fmt = (s, p) => s.replace(...);) whose body appears,
// under any name, in another engine file: the copies drift apart (one keeps unknown {k}, another prints "undefined"). R10 misses them (below its size).
// Level: error when every copy is in core (core shares one: e.g. fmt in validate.js), warn when a copy is in a module (move it to core or the module's common file).
// Known limits: one-line const arrow helpers only; the body is compared as written apart from whitespace.
import { engineFiles, lines, P } from './_lib.mjs';

// [file under packages/engine, helper name, reason]
const ALLOW = [
  ['core/threadPure.js', 'fmt', 'worker code: threadPure.js stays import-free'],
];
const HELPER = /^const (\w+) = (\([^)]*\)|\w+) => (.+);\s*(\/\/.*)?$/;

export default {
  id: 'R31', title: 'One copy of each small helper',
  run() {
    const seen = new Map();   // normalized "params => body" -> [{ file, line, name }]
    for (const f of engineFiles()) {
      const base = f.slice(P.ENGINE_REL.length + 1);
      lines(f).forEach((l, i) => {
        const m = HELPER.exec(l);
        if (!m || m[3].length < 20 || ALLOW.some(([file, name]) => file === base && name === m[1])) return;
        const key = (m[2] + ' => ' + m[3]).replace(/\s+/g, ' ');
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key).push({ file: f, base, line: i + 1, name: m[1] });
      });
    }
    const out = [];
    for (const list of seen.values()) {
      if (new Set(list.map(x => x.file)).size < 2) continue;
      const core = list.every(x => x.base.startsWith('core/'));
      for (const x of list.slice(1)) out.push({ level: core ? 'error' : 'warn', file: x.file, line: x.line,
        msg: `helper ${x.name} repeats ${list[0].name} of ${list[0].file}:${list[0].line}`, fix: 'import the one copy (core helpers: validate.js fmt, math.js), or move it to a shared file' });
    }
    return out;
  },
};

// R39 old names stay out of the repo: every call renamed in 0.2 (the RENAMED list in packages/engine/core/renamed.js, the same list the throwing
// stubs read) must not appear in tracked source, docs, recipes, examples or tests. One way to do each thing: the old spelling only throws renamed-api.
// Scanned: tracked .js .mjs .ts .md .html under packages/ and games/. Allowed: the list itself (core/renamed.js), the rename table in recipe 52, a line that
// is a throwing stub (contains `renamed(`) or says Renamed in 0.2, and a test file that asserts the stubs throw (it mentions renamed-api).
// Generated files (docs/api, API.md, types/generated, CODEMAP, GAMEMAP) are skipped: they are rebuilt from the stubs' JSDoc.
// Limits: RENAMED entries with find: null (views `pos`, ops `reason`) have no safe text pattern, so they are checked by the tests that exercise the traps.
import { execFileSync } from 'node:child_process';
import { ROOT, read } from './_lib.mjs';
import { RENAMED } from 'threedog/error-hints';

const EXT = /\.(js|mjs|ts|md|html)$/;
const SKIP = /(^|\/)(node_modules|docs\/api)\/|docs\/API\.md$|types\/generated\/|CODEMAP|GAMEMAP|core\/renamed\.js$|recipes\/52-look\.md$/;

export default {
  id: 'R39', title: 'old names renamed in 0.2 stay out of the repo',
  run() {
    const out = [];
    const pats = Object.entries(RENAMED).filter(([, v]) => v.find).map(([k, v]) => ({ key: k, re: new RegExp(v.find), now: v.now }));
    const tracked = execFileSync('git', ['ls-files', 'packages', 'games'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').filter(f => EXT.test(f) && !SKIP.test(f));
    for (const f of tracked) {
      let text; try { text = read(f); } catch { continue; }
      if (/renamed-api/.test(text) && /(tests?\/)/.test(f)) continue;   // a test that asserts the stubs throw
      // a local alias of the post module (`const p = engine.post, ...` / `const { post } = engine`) hides the old calls from the plain patterns above
      // (test page.evaluate strings did exactly that), so the same three calls are also checked on every alias the file makes
      const aliases = new Set([...text.matchAll(/\b(\w+)\s*=\s*[\w.?]*\bpost\s*[,;)\n]/g)].filter(m => !/\blook\??\./.test(m[0])).map(m => m[1]));
      if (/\{[^}]*\bpost\b[^}]*\}\s*=\s*[\w.]*engine\b/.test(text)) aliases.add('post');
      const aliasPats = [...aliases].flatMap(a => [['postAdd', `\\b${a}\\??\\.add\\(`], ['postEnable', `\\b${a}\\??\\.enable\\(`], ['postHandle', `\\b${a}\\??\\.get\\([^)]*\\)\\??\\.(set|enable|remove)\\(`]])
        .map(([key, src]) => ({ key, re: new RegExp(src), now: RENAMED[key].now }));
      text.split('\n').forEach((raw, i) => {
        if (/renamed\(|Renamed in 0\.2|renamed-api/.test(raw)) return;
        for (const p of aliasPats) if (p.re.test(raw)) out.push({ level: 'error', file: f, line: i + 1, msg: `old name '${p.key}' (renamed in 0.2) through a local alias of engine.post: ${raw.trim().slice(0, 90)}`, fix: `use: ${p.now}` });
        for (const p of pats) if (p.re.test(raw)) out.push({ level: 'error', file: f, line: i + 1, msg: `old name '${p.key}' (renamed in 0.2): ${raw.trim().slice(0, 90)}`, fix: `use: ${p.now}` });
      });
    }
    return out;
  },
};

// Answer first, details on request: every AI-facing bridge command's DEFAULT output on the world example stays under a byte budget, so it cannot
// creep back. Why: scene printed ~15 KB (46 KB as an MCP result), catalog 50 lines of "ops: — · saves: —", and the describeText summary cut the
// game's own describe.add sections off the end. Sizes before / after: docs/testing/tool-output-sizes.md.
// One dev server on the engine package (headless page), commands run through execute() as the CLI and the MCP server do.
import { createServer } from 'vite';
import { ENGINE, viteOptions } from '../paths.mjs';
import { execute } from '../threedog/dispatch.mjs';
import { bridgeDriver } from '../threedog/connect.mjs';
import { shortData, DATA_MAX } from '../threedog/mcp-extra.mjs';
import { errorsCommand } from '../threedog/errorlog.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const name = 'tool output sizes: each AI-facing command\'s default output on the world example stays under its byte budget (text and MCP result)';

// command line → text budget in bytes. ~4 KB is the general ceiling ("fits in ~40 lines"); the small ones get a tighter one so a 3-line answer
// that grows to 30 is caught too. The MCP result (text + structuredContent after shortData) gets text + DATA_MAX + a little for the envelope.
const BUDGET = {
  'describe': 800, 'describe --full': 4000, 'inspect': 800, 'inspect materials': 2600, 'inspect perf': 1500, 'ops': 1000,
  'errors latest 20': 4000, 'loading': 600, 'scene': 4000, 'pick 480,270': 800, 'catalog': 2000, 'thing player': 1000,
  'explain quest first-light': 800, 'catalog inventory': 4000, 'snap size-guard --no-look': 800,
  'status': 600,   // last: before the first page command the headless page may not be open yet
};

export async function run({ check }) {
  // shortData: a big MCP payload keeps its small fields and names the --json call; a small one passes untouched
  const big = { counts: { total: 3 }, items: Array.from({ length: 200 }, (_, i) => ({ name: 'x' + i, why: 'outside the view'.repeat(3) })) };
  const sd = shortData(big, 'scene');
  check('[guard] shortData: a payload over DATA_MAX keeps small fields, notes the big ones, names threedog <cmd> --json; a small one is unchanged',
    sd.counts.total === 3 && sd.items === '[200 items]' && /threedog scene --json/.test(sd.omitted) && JSON.stringify(sd).length < DATA_MAX
    && shortData({ a: 1 }, 'x').a === 1, JSON.stringify(sd));

  const server = await createServer(await viteOptions(ENGINE, { server: { port: 0, host: 'localhost' }, logLevel: 'error' }));
  await server.listen();
  try {
    const over = [], sizes = [];
    for (const [line, max] of Object.entries(BUDGET)) {
      const [cmd, ...args] = line.split(' ');
      const r = await execute(ENGINE, cmd, args), bytes = Buffer.byteLength(r.text);
      const { text, ...st } = r, mcp = Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text }], structuredContent: { ...st, data: shortData(st.data, cmd) } }));
      sizes.push(`${line} ${bytes}/${mcp}`);
      // a command that could not run is short, which would pass by accident; "blocked" (ran, found a problem: a stuck quest) is a real answer
      if (!['ok', 'blocked'].includes(r.code)) over.push(`${line}: did not run (${r.code}: ${r.text.split('\n')[0]})`);
      if (bytes > max) over.push(`${line}: text ${bytes} > ${max}`);
      if (mcp > max + DATA_MAX + 1500) over.push(`${line}: MCP result ${mcp} > ${max + DATA_MAX + 1500}`);
    }
    check(`[guard] every command's default text and MCP result are within budget (${Object.keys(BUDGET).length} commands)`, !over.length, over.join(' · ') || sizes.join(' · '));
    // describeText on the world page (its 30-line summary is full: some module lines are cut): a describe.add section survives the cut, the cut
    // modules are named, the engine tables are one count line
    const dt = await execute(ENGINE, 'eval', ['const h = engine.describe.add("sizeGuard", () => ({ points: 7 })); const t = engine.describeText(); h.remove(); return t', '--max', '9000']);
    const txt = String(JSON.parse(dt.text.replace(/^✓ /, ''))), tl = txt.split('\n');
    check('[guard] describeText summary: a describe.add section is kept (before module lines), cut modules are named, engine tables are one count line',
      tl.length <= 30 && tl.includes('sizeGuard: points=7') && /more modules: /.test(txt) && /Engine tables .*shared \d+/.test(txt) && !/^shared:/m.test(txt), txt);
    const sc = await execute(ENGINE, 'scene', []);
    check('scene: says the reason counts over all undrawn objects and how to get more', /Not drawn because: /.test(sc.text) && /--limit N/.test(sc.text), sc.text.slice(0, 300));
    const cat = await execute(ENGINE, 'catalog', ['--full']), catShort = await execute(ENGINE, 'catalog', []);
    check('catalog --full keeps one line per module; the default names the rest on one line per kind', cat.text.split('\n').length > catShort.text.split('\n').length
      && /look parts: /.test(catShort.text), catShort.text.slice(0, 300));
    const only = await execute(ENGINE, 'eval', ['JSON.stringify([Object.keys(engine.describe("look")), Object.keys(engine.describe({ only: ["time", "nope"] }))])']);
    check('describe(name) / describe({ only }) return just those sections; an unknown name is reported, not dropped silently',
      /\[\["look"\],\["time","unknownSections","sections"\]\]/.test(only.text.replace(/\\"/g, '"')), only.text);
    // describe({ only }) builds just those sections: each one equals the same section of the whole object (one synchronous eval: same tick).
    // A module's own section, a section hooks write into (time, player, camera, nearby) and engine tables (look, shared: hooks skipped)
    const same = await execute(ENGINE, 'eval', ['const all = engine.describe(), mod = [...engine.modules.values()].find(m => m.describe && all[m.name] !== undefined)?.name; '
      + 'const ks = ["look", "shared", "slots", "time", "player", "camera", "nearby", "ui", mod]; '
      + 'return JSON.stringify({ mod, diff: ks.filter(k => JSON.stringify(engine.describe(k)[k]) !== JSON.stringify(all[k])), '
      + 'pair: JSON.stringify(engine.describe({ only: ["look", "time"] })) === JSON.stringify({ look: all.look, time: all.time }) })']);
    const sm = JSON.parse(JSON.parse(same.text.replace(/^✓ /, '')));
    check('describe({ only }): every asked section equals the same section of the full describe()', sm.mod && !sm.diff.length && sm.pair, same.text);
    const mat = await execute(ENGINE, 'eval', ['const r = engine.inspect.materials(), lines = r.text.split("\\n").slice(1 + r.issues.length).filter(l => !l.startsWith("…")); '
      + 'return JSON.stringify({ n: r.count, lines: lines.length, alike: lines.filter(l => / · ×\\d+ materials alike$/.test(l)).length, dup: lines.length - new Set(lines).size, '
      + 'sum: lines.reduce((s, l) => s + Number(/×(\\d+) materials alike$/.exec(l)?.[1] ?? 1), 0) + Number(/^… (\\d+) more/m.exec(r.text)?.[1] ?? 0) })']);
    const mr = JSON.parse(JSON.parse(mat.text.replace(/^✓ /, '')));
    check('inspect materials: materials that read the same are one line with ×N; the lines (and "… N more") add up to every material', !mr.dup && mr.sum === mr.n, mat.text);
    // errors: the same error repeated as several records is one line with its first and last id / time and the summed count
    const ws = mkdtempSync(join(tmpdir(), 'td-errors-')), blk = (t, tick, msg) => `[browser error] ${t} tick ${tick}\npage| /index.html\npage| ${msg}\npage|     at f (main.js:3:4)\n`;
    mkdirSync(join(ws, '.threedog'));
    writeFileSync(join(ws, '.threedog/errors.log'), 'cleared\n' + blk('12:00:01', 5, 'boom') + blk('12:00:02', 6, 'other') + blk('12:00:03', 7, 'boom') + blk('12:00:09', 80, 'boom'));
    const el = errorsCommand(ws, ['latest', '20'], {}).text;
    rmSync(ws, { recursive: true, force: true });
    check('errors latest: repeats of one error are one line "E1 … E4 ×3" with first and last time; different errors keep their own line',
      /^✗ latest 4 of 4: 4 errors \(2 different\)$/m.test(el) && /^E1 12:00:01 tick 5 … E4 12:00:09 tick 80 ×3 error .*boom/m.test(el) && /^E2 12:00:02 tick 6 error .*other/m.test(el)
      && el.split('\n').length === 4, el);
  } finally {
    await bridgeDriver(ENGINE, {}).closeHeadless().catch(() => {});
    await server.close();
  }
}

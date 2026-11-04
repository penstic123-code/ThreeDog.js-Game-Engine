// MCP tool definitions that sit next to the per-command ones in mcp.mjs: play, status, verify, the static how / check, and the "does it move time" label put in front of every tool
// description (the first words are what a client shows when it lists tools, so the rule that matters most goes first).
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIME } from './runtime.mjs';

const str = description => ({ type: 'string', description });

const LABEL = [
  [TIME.advances, 'ADVANCES GAME TIME.'],
  [TIME.frozenTimeSafe, 'No game time.'],
  [TIME.observes, 'Observes only.'],
];
/** Tool name (underscore form) → label for the front of its description */
export const label = name => LABEL.find(([cmds]) => cmds.includes(name.replace('_', '-')))?.[1] ?? '';

/** engine.runState.state values, copied from core/holds.js (tests/run-state-enum.mjs keeps the two equal) */
export const RUN_STATES = ['loading', 'title-frozen', 'test-paused', 'paused', 'running'];
/**
 * The shape every tool result has (structuredContent), explained once at the front of the server instructions. The time sentence is generated
 * from TIME. Why here and not in each tool's outputSchema: the tool list is loaded into every session, and the full schema repeated on all 29
 * tools was 72% of it (35.7 of 49.6 KB)
 */
export const RESULT_SHAPE = 'Every result has text plus structuredContent { ok, code, summary, runtime: { ready, mode: running|paused|frozen|null, tick, headless, ' +
  `blockedBy[], run: { state: ${RUN_STATES.join('|')}, owners[], blockedBy[] } }, data (short, command-specific; a large one keeps its small fields and names the CLI --json call for the rest) }. ` +
  'code: ok; blocked = ran and was refused or found a problem; not-ready = page not ready; no-server|starting|page-error|no-bridge = cannot reach the game; ' +
  'command-error = bad arguments or a page exception. runtime.blockedBy: input contexts (win-<id>, ui-<part>, dialogue, cutscene...), error, loading. ' +
  'The text ends with one line on the game state and how to get back to normal play. ' +
  `${TIME.advances.join(' / ')} advance game time; ${TIME.frozenTimeSafe.join(', ')} do not; everything else only observes.`;

/** Bytes of structuredContent.data a tool result carries as is; a larger payload is shortened by shortData */
export const DATA_MAX = 3000;
/**
 * A large data payload in an MCP result → its small fields kept, each large one replaced by a size note, plus where the whole payload is.
 * Why: a client may hand structuredContent to the model next to the text, every call; scene / catalog data was 6–45 KB repeating what the text
 * already summarized. The text stays complete for its purpose; the whole payload is one CLI call away (threedog <cmd> --json).
 */
export function shortData(data, cmd) {
  if (data == null || Buffer.byteLength(JSON.stringify(data)) <= DATA_MAX) return data;
  const note = v => Array.isArray(v) ? `[${v.length} items]` : `{${Object.keys(v).length} keys}`;
  const out = Array.isArray(data) ? { count: data.length } : Object.fromEntries(Object.entries(data).map(([k, v]) =>
    [k, v && typeof v === 'object' && JSON.stringify(v).length > 300 ? note(v) : v]));
  return { ...out, omitted: `shortened for the tool result; the whole data: threedog ${cmd} --json` };
}

/** Declared on every tool, kept minimal (the protocol only needs an object schema; the fields are described once in RESULT_SHAPE) */
export const OUTPUT_SCHEMA = { type: 'object', required: ['ok', 'code', 'summary', 'runtime'] };

// Descriptions stay short (they are sent every turn): what it does and when to use it; the details live in the schema field descriptions.
export const EXTRA_TOOLS = {
  play: {
    description: 'Start the game and connect: starts the dev server if none runs, waits for bridge and engine, returns the page address. Call first when nothing runs.',
    schema: { type: 'object', properties: { stop: { type: 'boolean', description: 'Stop the dev server that play started' } }, required: [] },
    args: a => a.stop ? ['--stop'] : [],
  },
  status: {
    description: 'Is the engine ready, loading done, any page errors, running / paused / frozen? If the bridge cannot answer, names the cause and the next step.',
    schema: { type: 'object', properties: {}, required: [] },
    args: () => [],
  },
  scene: {
    description: 'The mesh exists but is not drawn: lists every Mesh / Points / Line / Sprite and, for each undrawn one, why (visibility, layers, material, scale, fog, view). Use first.',
    schema: { type: 'object', properties: { hidden: { type: 'boolean', description: 'List only the objects that are not drawn' },
      limit: { type: 'number', description: 'How many objects to list (default 6, undrawn and surprising ones first; counts and the reasons line always cover everything)' } }, required: [] },
    args: a => [...(a.hidden ? ['--hidden'] : []), ...(a.limit ? ['--limit', String(a.limit)] : [])],
  },
  verify: {
    description: 'Run a scenario file and report pass or fail plus what it tested and never touched, related tests, and the re-run command. A page error fails it.',
    schema: { type: 'object', properties: { name: str('Scenario file name without .json (tests/scenarios/<name>.json)') }, required: ['name'] },
    args: a => [a.name],
  },
};

// Static tools: answered from the files alone (no dev server, no page). run(dir, input) → { ok, text, data }; mcp.mjs wraps it in the result shape.
const HERE = dirname(fileURLToPath(import.meta.url));
/** Keep the ✗ / ! lines and the count lines of a check run, capped (the full run is `npm run check` in a terminal) */
const checkDigest = (out, max) => {
  const lines = out.split('\n').map(l => l.trimEnd()).filter(Boolean);
  const keep = lines.filter(l => /^\s*[✗!]|errors?,|warnings?|FAILED|passed/.test(l));
  const text = (keep.length ? keep : lines.slice(-20)).join('\n');
  return text.length > max ? text.slice(0, max - 40) + `\n… (${text.length - max + 40} more characters)` : text;
};
export const STATIC_TOOLS = {
  how: {
    description: 'Which API, recipe or plain three.js way answers a task, from the docs alone (no game needed). Ask before building a system or a picture; plain three.js hits come first.',
    schema: { type: 'object', properties: { task: str('The task in English words, e.g. "tone mapping", "save game", "rain"') }, required: ['task'] },
    run: async (dir, a) => {
      // the same answer as `threedog how`: no match or a weak one says which typed words the docs never use and what to try (how.mjs tryNext)
      const { search, format, tryNext } = await import('../how.mjs'), { ENGINE } = await import('../paths.mjs');
      const q = String(a.task ?? '').trim(), hits = search(join(ENGINE, 'docs'), q);
      if (!hits.length) return { ok: true, text: `No match for "${q}". ${tryNext(hits)}`, data: [] };
      const weak = hits.weak ? `No good match for "${q}": the closest hits below cover less than a third of it. ${tryNext(hits)}\n\n` : '';
      return { ok: true, text: weak + hits.map(format).join('\n'), data: hits };
    },
  },
  // read-only on purpose: copying writes into the game and can need --force, so it stays a command the user (or AI) runs on purpose (threedog art copy)
  art_list: {
    description: 'What a source of art code offers before `threedog art copy`: modules, exported generator functions with their first JSDoc line, asset files. Source: a game folder, local path or package.',
    schema: { type: 'object', properties: { source: str('Path relative to the game folder (e.g. "../my-earlier-game") or a package name') }, required: ['source'] },
    run: async (dir, a) => {
      const { listArt } = await import('../art.mjs'), r = listArt(String(a.source ?? ''), dir);
      const lines = [`${r.modules.length} module(s), ${r.assets.length} asset file(s) in ${r.root}`,
        ...r.modules.flatMap(m => [m.file, ...m.exports.map(e => `  ${e.name}${e.doc ? '  ' + e.doc : ''}`)]), ...r.assets];
      return { ok: true, text: lines.join('\n'), data: r };
    },
  },
  // read-only on purpose, like art_list: adding and pulling write files and stay commands (threedog lib add / pull)
  lib_list: {
    description: 'Your own art library from earlier games (~/.threedog/library): name, kind, summary, backends, use line. Check before writing an effect.',
    schema: { type: 'object', properties: { query: str('Words that must all match (optional)') }, required: [] },
    run: async (dir, a) => {
      const { listEntries, libraryDir, readLibrary, brokenLine } = await import('../lib.mjs'), lib = libraryDir(), list = listEntries(lib, String(a.query ?? '').split(/\s+/));
      const broken = brokenLine(readLibrary(lib).broken);
      const text = (list.length ? list.map(e => `${e.name} [${e.kind}] ${e.summary} (${(e.backends ?? []).join(', ')})\n  use: ${e.use}`).join('\n') : `No entry${a.query ? ` matches "${a.query}"` : ''} in ${lib}`)
        + (broken ? `\n${broken}` : '');
      return { ok: !broken, text, data: list.map(({ dir: _dir, ...e }) => e) };
    },
  },
  check: {
    description: 'Run npm run check on this game (rules R*, content, types, GAMEMAP up to date) from the files alone (no game needed); errors and counts.',
    schema: { type: 'object', properties: { rule: str('Optional: only these rules, e.g. "R33,R18"'), max: { type: 'number', description: 'Output cap in characters (default 2000)' } }, required: [] },
    run: (dir, a) => new Promise(res => {
      const args = [join(HERE, '..', 'check.mjs'), ...(a.rule ? ['--rule', String(a.rule)] : [])];
      const c = spawn(process.execPath, args, { cwd: dir });
      let out = '';
      c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
      c.on('close', code => res({ ok: code === 0, text: (code === 0 ? '✓ check passed\n' : '✗ check failed\n') + checkDigest(out, a.max > 0 ? a.max : 2000), data: { exit: code } }));
    }),
  },
};

/** The "When something happens: which tool" section of recipe 16 as one compact line (backticks dropped): the server instructions carry it, so the list
 *  has one source (the test compares the two). '' when the recipe is not found (a project without the engine docs). */
export function situationGuide(recipePath) {
  let text;
  try { text = readFileSync(recipePath, 'utf8'); } catch { return ''; }
  const sec = text.split(/^## /m).find(s => /^(\d+\.\s*)?When something happens/.test(s));
  if (!sec) return '';
  const rows = sec.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).replaceAll('`', '').replace(/\.$/, '').trim());
  return rows.length ? 'When something happens -> which tool: ' + rows.join('; ') + '.' : '';
}

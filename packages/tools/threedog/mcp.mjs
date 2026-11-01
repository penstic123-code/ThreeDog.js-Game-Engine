// threedog mcp: an MCP (Model Context Protocol) server over stdio that wraps the dev bridge, so MCP clients (Claude Code, Cursor...) drive the running game
// natively.
//   claude mcp add threedog -- npx threedog mcp          (see recipes/16-dev-bridge.md section 10)
//   threedog mcp [-w game] [--page /tests/city/index.html] [--allow-js]
// One tool per bridge command; each runs the same commands.mjs code as the command line, so output and errors are identical.
// Transport: newline-delimited JSON-RPC 2.0 on stdin / stdout (the small subset MCP needs: initialize, ping, tools/list, tools/call).
//   Hand-written instead of @modelcontextprotocol/sdk, which pulls in express, hono, ajv, zod and more (several MB) for what is ~100 lines here.
// Security: this process only talks to the bridge as a local client (token from .threedog/dev.json, no Origin header); it opens no listener.
//   The js tool (arbitrary code in the page) exists only with --allow-js.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pickWorkspace } from '../paths.mjs';
import { execute } from './dispatch.mjs';
import { EXTRA_TOOLS, label, RESULT_SHAPE, OUTPUT_SCHEMA } from './mcp-extra.mjs';

// stdout carries protocol messages only: anything else that prints goes to stderr
console.log = console.info = console.warn = console.error;

const argv = process.argv.slice(2);
const flag = f => { const i = argv.indexOf(f); return i >= 0 && argv.splice(i, 1).length > 0; };
const value = f => { const i = argv.indexOf(f); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
const allowJs = flag('--allow-js'), pagePath = value('--page');
let dir;
try { ({ dir } = pickWorkspace(argv)); } catch (e) { console.error('threedog mcp: ' + e.message); process.exit(1); }
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// ── Tools ─────────────────────────────────────────────
const str = description => ({ type: 'string', description });
const num = description => ({ type: 'number', description });
const obj = (properties = {}, required = [], extra = {}) => ({ type: 'object', properties, required, ...extra });
const MAX = num('Output cap in characters (default 500)');
/** op arguments object → key=value strings; commands.mjs converts them back by the op's args shape */
const pairs = args => Object.entries(args
  || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v !== null && typeof v === 'object' ? JSON.stringify(v) : v}`);
const opt = (name, v) => v === undefined || v === null || v === '' ? [] : [name, String(v)];

/** name → { description, schema, args(input) → command line args, cmd? (bridge command, default the name) } */
const TOOLS = {
  describe: {
    description: 'Look at the running game: what is going on now. No arguments: a 3-line summary (player position, time and weather, nearby things, ' +
      'quest). path: one field of engine.describe() as JSON (e.g. "player.position", "quests.active", "nearby", "ui", or a game\'s own describe.add ' +
      'name). full: the whole text description (thousands of characters). Use this first, before screenshots, to check logic.',
    schema: obj({ path: str('Dotted path into engine.describe(), e.g. "player.position" or "time.clock"'),
      full: { type: 'boolean', description: 'The text summary (describeText, at most 30 lines)' },
      all: { type: 'boolean', description: 'Everything (describeText({ full: true })); large' }, max: MAX }),
    args: a => [...(a.full ? ['--full'] : []), ...(a.all ? ['--all'] : []), ...(a.path ? [a.path] : []), ...opt('--max', a.max)],
  },
  step: {
    description: 'Advance game time by N seconds, deterministically (a real browser page is paused first; call resume afterwards). Returns the new ' +
      'summary. Changes only this session (and its saves), never the level: to change the level, edit content/*.js and reload.',
    schema: obj({ seconds: num('Game seconds to advance (default 1)') }),
    args: a => [String(a.seconds ?? 1)],
  },
  press: {
    description: 'Press an input action or key once, like a real keyboard: an action name ("interact", "jump", "menu") or a key code ("KeyE", "Space", ' +
      '"Escape", "e"). Advances about 0.117 game seconds (0.1 s held + one frame); "for" shortens the hold. Pauses a real page.',
    schema: obj({ key: str('Action name or key code'), for: num('Hold time in seconds (default 0.1, minimum one frame)') }, ['key']),
    args: a => [a.key, ...opt('--for', a.for)],
  },
  hold: {
    description: 'Hold an input action or key for N game seconds (e.g. "moveForward" for 1.5 to walk). Pauses a real page.',
    schema: obj({ key: str('Action name or key code'), seconds: num('How long to hold, in game seconds (default 1)') }, ['key']),
    args: a => [a.key, String(a.seconds ?? 1)],
  },
  state: {
    description: 'Jump the scene to a state (same as URL parameters): time "18:30", weather "rain", player pos "x,z", plus wait, cutscene "skip", save, ' +
      'or a named state. For setting up a test situation, not for gameplay actions (use op).',
    schema: obj({ time: str('Clock time, e.g. "18:30"'), weather: str('Weather name, e.g. "rain"'), pos: str('Player position "x,z", e.g. "40,-20"'),
      wait: str('Game seconds to wait after applying'), cutscene: str('"skip" to skip cutscenes'), save: str('Save slot to load'),
        state: str('A named state (engine.defineState)') },
    [], { additionalProperties: { type: 'string' } }),
    args: a => Object.entries(a).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`),
  },
  ops: {
    description: 'List what the player can do right now: every op offer checked with its can() rule, ✓ runnable / ✗ with the reason, plus ops that take ' +
      'free-form arguments. Use before op.',
    schema: obj(),
    args: () => [],
  },
  op: {
    description: 'Run a game op (a gameplay action such as shop.buy) as source "bridge", without advancing time. This is the right way to change game ' +
      'state; values are converted by the op\'s args shape. Returns ✓ with the value and bag, or ✗ with the reason. ops lists what exists. Runtime ops ' +
      'change only the current session and its saves; to change the level itself, edit the content files (content/*.js, content/templates.js) or the ' +
      'level model, then reload.',
    schema: obj({ name: str('Op name, e.g. "shop.buy"'),
      args: { type: 'object', description: 'Op arguments, e.g. { "shop": "bakery", "item": "bread", "n": 2 }; positions as [x, y, z]',
      additionalProperties: true } }, ['name']),
    args: a => [a.name, ...pairs(a.args)],
  },
  inspect: {
    description: 'What is around the player (or around an actor id / a spot) and which ops can run there now, with reasons why not.',
    schema: obj({ target: str('Optional: an actor id such as "npc_3", or a spot "x,z" such as "10,-4"') }),
    args: a => a.target ? [String(a.target)] : [],
  },
  pick: {
    description: 'What is at a screen point: the world record under pixel (x, y) from the canvas top-left, with its id, kind, template, where it is ' +
      'defined (content file:line) and its fields. Use it to find which content entry to edit for something you see.',
    schema: obj({ x: num('Pixels from the left edge of the game canvas'), y: num('Pixels from the top edge of the game canvas') }, ['x', 'y']),
    args: a => [`${a.x},${a.y}`],
  },
  explain: {
    description: 'Explain why: about "op" says whether an op can run now and its last attempts; about "quest" (or another key a module explains) says ' +
      'where it is stuck.',
    schema: obj({ about: str('"op", "quest", or another key a module explains'), name: str('The op name or the quest id'),
      args: { type: 'object', description: 'Op arguments (about "op" only)', additionalProperties: true } }, ['about', 'name']),
    args: a => [a.about, a.name, ...(a.about === 'op' ? pairs(a.args) : [])],
  },
  errors: {
    description: 'Page errors with id, time, tick, source and count (known error classes come with the likely cause and the doc page to read). Default: new ' +
      'since the last call. latest: the last N, readable again and again. since: errors after an id (the cursor a result prints), never moves the read position. ' +
      'Check this after a change or when something looks wrong.',
    schema: obj({ latest: num('Show the last N errors (e.g. 3); the same ones show again on the next call'), since: str('Error id such as "E5" or "5": list only what came after') }),
    args: a => a.latest ? ['latest', String(a.latest)] : a.since ? ['--since', String(a.since)] : [],
  },
  loading: {
    description: 'Loading status: what the game is waiting for, which assets failed (file, HTTP status, fallback) and whether startup is blocked. Works ' +
      'while start() is stuck. name: one task with its manifest and path.',
    schema: obj({ name: str('Optional: an asset, module or track() name') }),
    args: a => a.name ? [a.name] : [],
  },
  snap: {
    description: 'Screenshot of the game, returned as an image (also saved to .threedog/shots/<name>.png). Only for what needs eyes (looks, animation, ' +
      'UI overlap); use describe for logic.',
    schema: obj({ name: str('File name without extension (default "snap")') }),
    args: a => a.name ? [a.name] : [],
  },
  snap_describe: {
    cmd: 'snap-describe',
    description: 'Describe snapshot instead of a screenshot: "save" stores the gameplay part of describe() as a baseline ' +
      '(tests/snapshots/<name>.describe.json); "diff" lists what changed since, as text.',
    schema: obj({ mode: { type: 'string', enum: ['save', 'diff'], description: 'save or diff' }, name: str('Baseline name'),
      only: { type: 'array', items: { type: 'string' }, description: 'Compare only these fields (dotted paths); use the same list for save and diff' },
      ignore: { type: 'array', items: { type: 'string' }, description: 'Extra fields to skip' }, tolerance: num('Number tolerance (default 0.5)') },
        ['mode', 'name']),
    args: a => [a.mode, a.name, ...opt('--only', a.only?.join(',')), ...opt('--ignore', a.ignore?.join(',')), ...opt('--tolerance', a.tolerance)],
  },
  scenario: {
    description: 'Run one scenario test file (tests/scenarios/<name>.json) on the running page; returns the failed checks or a pass count. Leaves the ' +
      'page paused.',
    schema: obj({ name: str('Scenario file name without .json') }, ['name']),
    args: a => [a.name],
  },
  reload: {
    description: 'Reload the game page (back to its initial state).',
    schema: obj(),
    args: () => [],
  },
  resume: {
    description: 'Resume real-time running of a browser page paused by step, press, hold or scenario.',
    schema: obj(),
    args: () => [],
  },
};
Object.assign(TOOLS, EXTRA_TOOLS);
if (allowJs) TOOLS.js = {
  description: 'DEV ONLY, DANGEROUS: run arbitrary JavaScript in the game page (engine is in scope, await works; statements need their own return). Last ' +
    'resort for reading something describe cannot show. Never change game state with it (use op): writes bypass the op log.',
  schema: obj({ code: str('An expression ("engine.sky.timeOfDay") or statements with return'), max: MAX }, ['code']),
  args: a => [a.code, ...opt('--max', a.max)],
};

const list = () => Object.entries(TOOLS).map(([name, t]) => ({ name, description: `${label(t.cmd || name)} ${t.description}`.trim(), inputSchema: t.schema, outputSchema: OUTPUT_SCHEMA }));

/** Run one tool → MCP CallToolResult. Bridge failures (no dev server, page error, ✗ results) come back as isError with the CLI's text */
async function callTool(name, input = {}) {
  const t = TOOLS[name];
  if (!t) return { content: [{ type: 'text',
    text: `No tool "${name}". Available: ${Object.keys(TOOLS).join(', ')}${name === 'js' ? ' (js needs threedog mcp --allow-js)' : ''}` }],
    structuredContent: { ok: false, code: 'command-error', summary: `No tool "${name}"`, runtime: { ready: false, mode: null, tick: null, blockedBy: [] }, data: null }, isError: true };
  let png;
  try {
    const { text, ...structured } = await execute(dir, t.cmd || name, t.args(input), { page: pagePath, onShot: b => { png = b; } });
    const content = [{ type: 'text', text }];
    if (png) content.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
    return { content, structuredContent: structured, isError: !structured.ok };
  } catch (e) {
    return { content: [{ type: 'text', text: '✗ ' + e.message }], structuredContent: { ok: false, code: 'command-error', summary: e.message, runtime: { ready: false, mode: null, tick: null, blockedBy: [] }, data: null }, isError: true };
  }
}

// ── JSON-RPC over stdio ───────────────────────────────
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const INSTRUCTIONS = RESULT_SHAPE + ' Drives the threedog game running under `npm run dev` (the dev bridge). No game running: call play. Then status or describe; change state with op (ops lists what ' +
  'is possible); step / press / hold advance game time and pause a real page (resume restores it); errors reads new page errors. If a tool cannot reach the game it ' +
  'names the cause and the next step (play starts the server).';

let queue = Promise.resolve();   // tool calls run one at a time, in order: they drive one shared game
async function handle(m) {
  const reply = result => m.id !== undefined && send({ id: m.id, result });
  switch (m.method) {
    case 'initialize': return reply({ protocolVersion: PROTOCOLS.includes(m.params?.protocolVersion) ? m.params.protocolVersion : PROTOCOLS[0],
      capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'threedog', version: VERSION }, instructions: INSTRUCTIONS });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: list() });
    case 'tools/call': queue = queue.then(async () => reply(await callTool(m.params?.name, m.params?.arguments))); return queue;
    default:
      if (m.id !== undefined && m.method) send({ id: m.id,
        error: { code: -32601, message: `Method not found: ${m.method}` } });   // notifications (no id) are ignored
  }
}

createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  let m;
  try { m = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'Parse error' } }); }
  for (const one of Array.isArray(m) ? m : [m]) handle(one).catch(e => one.id !== undefined
    && send({ id: one.id, error: { code: -32603, message: String(e.message || e) } }));
}).on('close', () => queue.then(() => process.exit(0)));

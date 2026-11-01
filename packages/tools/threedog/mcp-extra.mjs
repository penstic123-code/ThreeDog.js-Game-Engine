// MCP tool definitions that sit next to the per-command ones in mcp.mjs: play, status, verify, and the "does it move time" label put in front of every tool
// description (the first words are what a client shows when it lists tools, so the rule that matters most goes first).
import { readFileSync } from 'node:fs';
import { TIME } from './runtime.mjs';

const str = description => ({ type: 'string', description });

const LABEL = [
  [TIME.advances, 'ADVANCES GAME TIME.'],
  [TIME.frozenTimeSafe, 'No game time.'],
  [TIME.observes, 'Observes only.'],
];
/** Tool name (underscore form) → label for the front of its description */
export const label = name => LABEL.find(([cmds]) => cmds.includes(name.replace('_', '-')))?.[1] ?? '';

/** The shape every tool result has (structuredContent), explained once at the front of the server instructions. The time sentence is generated from TIME */
export const RESULT_SHAPE = 'Every result has text plus structuredContent { ok, code, summary, runtime: { ready, mode: running|paused|frozen|null, tick, headless, ' +
  'blockedBy[] }, data }. The text ends with one line on the game state and how to get back to normal play. ' +
  `${TIME.advances.join(' / ')} advance game time; ${TIME.frozenTimeSafe.join(', ')} do not; everything else only observes.`;

/** Declared for every tool: the same object comes back as structuredContent. data stays short; ask a narrower command for detail */
export const OUTPUT_SCHEMA = { type: 'object', required: ['ok', 'code', 'summary', 'runtime'], properties: {
  ok: { type: 'boolean' },
  code: { type: 'string', enum: ['ok', 'blocked', 'not-ready', 'no-server', 'starting', 'page-error', 'no-bridge', 'command-error'],
    description: 'blocked = the command ran and was refused or found a problem; not-ready = the page is not ready; no-server / starting / page-error / no-bridge = the tool cannot reach the game; command-error = bad arguments or an exception in the page' },
  summary: { type: 'string' },
  runtime: { type: 'object', required: ['ready', 'mode', 'tick', 'blockedBy'], properties: { ready: { type: 'boolean' }, mode: { enum: ['running', 'paused', 'frozen', null] },
    tick: { type: ['number', 'null'] }, headless: { type: 'boolean' }, blockedBy: { type: 'array', items: { type: 'string' }, description: 'engine.runState.blockedBy: opaque input contexts (win-<id>, ui-<part>, dialogue, cutscene...), error, loading' },
    // copied from engine.runState (core/holds.js); keep the state list in step with its JSDoc
    run: { type: ['object', 'null'], properties: { state: { enum: ['loading', 'title-frozen', 'test-paused', 'paused', 'running'] }, by: { type: 'array', items: { type: 'string' } },
      blockedBy: { type: 'array', items: { type: 'string' } } } } } },
  data: { description: 'Short, command-specific; null when the text says it all' } } };

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
      limit: { type: 'number', description: 'How many objects to list (default 40; counts always cover everything)' } }, required: [] },
    args: a => [...(a.hidden ? ['--hidden'] : []), ...(a.limit ? ['--limit', String(a.limit)] : [])],
  },
  verify: {
    description: 'Run a scenario file and report pass or fail plus what it tested and never touched, related tests, and the re-run command. A page error fails it.',
    schema: { type: 'object', properties: { name: str('Scenario file name without .json (tests/scenarios/<name>.json)') }, required: ['name'] },
    args: a => [a.name],
  },
};

/** The "When something happens -> which tool" section of the engine's AI.md as one compact line (backticks dropped): the server instructions carry it, so the table
 *  has one source (the test compares the two). '' when AI.md is not found (a project without the engine docs). */
export function situationGuide(aiMdPath) {
  let text;
  try { text = readFileSync(aiMdPath, 'utf8'); } catch { return ''; }
  const sec = text.split(/^## /m).find(s => s.startsWith('When something happens'));
  if (!sec) return '';
  const rows = sec.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).replaceAll('`', '').replace(/\.$/, '').trim());
  return rows.length ? 'When something happens -> which tool: ' + rows.join('; ') + '.' : '';
}
